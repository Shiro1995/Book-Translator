import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { type Book, type Page, type PromptPreset, type TranslationSettings } from "./types";
import { parseDOCX, parsePDF } from "./services/fileService";
import { translationService } from "./services/translationService";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DRAFT_BOOK_STORAGE_KEY = "book-translator:draft-book";
const DRAFT_UI_STORAGE_KEY = "book-translator:draft-ui";
const DRAFT_SESSIONS_STORAGE_KEY = "book-translator:draft-sessions";
const MAX_DRAFT_SESSIONS = 3;
const AUTO_TRANSLATE_PARALLEL_LIMIT = 3;
const AUTO_TRANSLATE_INITIAL_STAGGER_MS = 5_000;
const PAGE_FILTER_OPTIONS = ["all", "idle", "error", "completed", "edited"] as const;

type PageFilter = (typeof PAGE_FILTER_OPTIONS)[number];

const PROMPT_PRESETS: Record<
  PromptPreset,
  {
    label: string;
    description: string;
    instructions: string;
  }
> = {
  custom: {
    label: "Tùy chỉnh",
    description: "Chỉ dùng glossary và hướng dẫn bạn tự nhập.",
    instructions: "",
  },
  reader: {
    label: "Dễ đọc",
    description: "Ưu tiên câu văn mượt, tự nhiên, dễ đọc liền mạch.",
    instructions:
      "Translate into fluent, natural prose for readers. Preserve the original meaning, names, and paragraph structure.",
  },
  literary: {
    label: "Văn học",
    description: "Giữ giọng văn, sắc thái, nhịp điệu và hình ảnh.",
    instructions:
      "Preserve tone, voice, and imagery. Favor elegant literary Vietnamese while staying faithful to the source text.",
  },
  technical: {
    label: "Kỹ thuật",
    description: "Ưu tiên thuật ngữ ổn định, rõ nghĩa, nhất quán.",
    instructions:
      "Use consistent terminology, keep technical accuracy, and preserve proper nouns or source terms when needed for clarity.",
  },
  study: {
    label: "Học thuật",
    description: "Rõ ràng, chặt chẽ, giữ cấu trúc và ý nghĩa học thuật.",
    instructions:
      "Use precise academic Vietnamese, preserve logical structure, and avoid over-simplifying specialized concepts.",
  },
};

interface DraftSession {
  book: Book;
  currentPageIdx: number;
  updatedAt: number;
}

function clampPageIndex(book: Book, pageIdx: number) {
  return Math.min(Math.max(pageIdx, 0), Math.max(book.pages.length - 1, 0));
}

function upsertDraftSession(
  sessions: DraftSession[],
  nextBook: Book,
  nextPageIdx: number,
): DraftSession[] {
  const nextSession: DraftSession = {
    book: nextBook,
    currentPageIdx: clampPageIndex(nextBook, nextPageIdx),
    updatedAt: Date.now(),
  };

  return [nextSession, ...sessions.filter((session) => session.book.id !== nextBook.id)].slice(
    0,
    MAX_DRAFT_SESSIONS,
  );
}

function isPageEdited(page: Page) {
  const translated = page.translatedText.trim();
  if (!translated) {
    return false;
  }

  if (page.versionHistory.length === 0) {
    return true;
  }

  return translated !== page.versionHistory[0].trim();
}

function isPageAlreadyTranslated(page: Page) {
  return page.status === "completed" || page.translatedText.trim().length > 0;
}

function matchesPageFilter(page: Page, filter: PageFilter) {
  switch (filter) {
    case "idle":
      return page.status === "idle" && page.translatedText.trim().length === 0;
    case "error":
      return page.status === "error";
    case "completed":
      return page.status === "completed" || page.translatedText.trim().length > 0;
    case "edited":
      return isPageEdited(page);
    default:
      return true;
  }
}

function buildEffectiveSettings(settings: TranslationSettings): TranslationSettings {
  const presetInstructions = PROMPT_PRESETS[settings.promptPreset].instructions.trim();
  const customInstructions = settings.instructions.trim();

  return {
    ...settings,
    instructions: [presetInstructions, customInstructions].filter(Boolean).join("\n\n"),
  };
}

function getSettingsFromBook(book: Book): TranslationSettings {
  return {
    model: book.model,
    sourceLang: book.sourceLang,
    targetLang: book.targetLang,
    style: book.style,
    promptPreset: book.promptPreset ?? "reader",
    glossary: book.glossary,
    instructions: book.instructions,
  };
}

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isMobilePagesOpen, setIsMobilePagesOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [retranslateConfirmIdx, setRetranslateConfirmIdx] = useState<number | null>(null);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [autoStartPage, setAutoStartPage] = useState(1);
  const [settings, setSettings] = useState<TranslationSettings>({
    model: "gemini-3-flash-preview",
    sourceLang: "English",
    targetLang: "Vietnamese",
    style: "natural",
    promptPreset: "reader",
    glossary: "",
    instructions: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const bookRef = useRef<Book | null>(book);
  const settingsRef = useRef(settings);
  const autoTranslateHadFailureRef = useRef(false);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    autoTranslateHadFailureRef.current = book?.pages.some((page) => page.status === "error") ?? false;
  }, [book?.id]);

  useEffect(() => {
    if (book?.pages.some((page) => page.status === "error")) {
      autoTranslateHadFailureRef.current = true;
    }
  }, [book]);

  useEffect(() => {
    setBook((prev) => {
      if (!prev) {
        return prev;
      }

      const nextBook = {
        ...prev,
        ...settings,
      };

      if (
        prev.model === nextBook.model &&
        prev.sourceLang === nextBook.sourceLang &&
        prev.targetLang === nextBook.targetLang &&
        prev.style === nextBook.style &&
        prev.promptPreset === nextBook.promptPreset &&
        prev.glossary === nextBook.glossary &&
        prev.instructions === nextBook.instructions
      ) {
        return prev;
      }

      return nextBook;
    });
  }, [settings]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      const savedSessionsRaw = localStorage.getItem(DRAFT_SESSIONS_STORAGE_KEY);
      const savedSessions = savedSessionsRaw
        ? (JSON.parse(savedSessionsRaw) as DraftSession[])
        : [];

      const normalizedSessions = savedSessions
        .filter((session) => session?.book?.id)
        .map((session) => ({
          ...session,
          book: {
            ...session.book,
            promptPreset: session.book.promptPreset ?? "reader",
          },
          currentPageIdx: clampPageIndex(session.book, session.currentPageIdx ?? 0),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_DRAFT_SESSIONS);

      if (normalizedSessions.length > 0) {
        setDraftSessions(normalizedSessions);
        setBook(normalizedSessions[0].book);
        setSettings(getSettingsFromBook(normalizedSessions[0].book));
        setCurrentPageIdx(normalizedSessions[0].currentPageIdx);
        return;
      }

      const savedBook = localStorage.getItem(DRAFT_BOOK_STORAGE_KEY);
      const savedUi = localStorage.getItem(DRAFT_UI_STORAGE_KEY);

      if (savedBook) {
        const parsedBook = JSON.parse(savedBook) as Book;
        const parsedUi = savedUi ? (JSON.parse(savedUi) as { currentPageIdx?: number }) : undefined;
        const migratedSessions = upsertDraftSession(
          [],
          parsedBook,
          typeof parsedUi?.currentPageIdx === "number" ? parsedUi.currentPageIdx : 0,
        );

        setDraftSessions(migratedSessions);
        setBook(migratedSessions[0].book);
        setSettings(getSettingsFromBook(migratedSessions[0].book));
        setCurrentPageIdx(migratedSessions[0].currentPageIdx);
      }
    } catch (error) {
      console.error("Failed to restore draft state", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAFT_SESSIONS_STORAGE_KEY, JSON.stringify(draftSessions));
  }, [draftSessions]);

  useEffect(() => {
    localStorage.removeItem(DRAFT_BOOK_STORAGE_KEY);
    localStorage.removeItem(DRAFT_UI_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!book) {
      return;
    }

    setDraftSessions((prev) => upsertDraftSession(prev, book, currentPageIdx));
  }, [book, currentPageIdx]);

  useEffect(() => {
    if (!book) {
      return;
    }

    if (currentPageIdx > book.pages.length - 1) {
      setCurrentPageIdx(Math.max(book.pages.length - 1, 0));
    }
  }, [book, currentPageIdx]);

  useEffect(() => {
    if (!book) {
      setAutoStartPage(1);
      return;
    }

    setAutoStartPage((prev) => {
      const maxPage = Math.max(1, book.pages.length);
      return Math.min(Math.max(prev, 1), maxPage);
    });
  }, [book]);

  useEffect(() => {
    if (isReaderOpen) {
      return;
    }

    setIsMobilePagesOpen(false);
    setIsMobileSettingsOpen(false);
    setRetranslateConfirmIdx(null);
  }, [isReaderOpen]);

  useEffect(() => {
    setRetranslateConfirmIdx(null);
  }, [currentPageIdx]);

  const openDraftSession = (session: DraftSession) => {
    setUploadNotice(null);
    setBook(session.book);
    setSettings(getSettingsFromBook(session.book));
    setCurrentPageIdx(clampPageIndex(session.book, session.currentPageIdx));
    setAutoStartPage(1);
    setIsReaderOpen(true);
  };

  const removeDraftSession = (bookId: string) => {
    setDraftSessions((prev) => {
      const nextSessions = prev.filter((session) => session.book.id !== bookId);

      if (book?.id === bookId) {
        const fallbackSession = nextSessions[0];
        setBook(fallbackSession?.book ?? null);
        if (fallbackSession?.book) {
          setSettings(getSettingsFromBook(fallbackSession.book));
        }
        setCurrentPageIdx(fallbackSession?.currentPageIdx ?? 0);
        setIsReaderOpen(false);
      }

      return nextSessions;
    });
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const existingSession = draftSessions.find(
      (session) => session.book.name === file.name && session.book.size === file.size,
    );
    if (existingSession) {
      setUploadNotice(`File "${file.name}" đã được tải lên rồi.`);
      setBook(existingSession.book);
      setCurrentPageIdx(existingSession.currentPageIdx);
      e.target.value = "";
      return;
    }

    try {
      let result;

      if (file.name.endsWith(".pdf")) {
        result = await parsePDF(file);
      } else if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
        result = await parseDOCX(file);
      } else {
        alert("Định dạng file chưa được hỗ trợ");
        e.target.value = "";
        return;
      }

      setUploadNotice(null);
      setBook({
        id: Math.random().toString(36).slice(2, 11),
        name: result.name,
        size: result.size,
        totalPages: result.pages.length,
        pages: result.pages.map((page: any) => ({ ...page, versionHistory: [] })),
        ...settings,
      });
      setCurrentPageIdx(0);
      setAutoStartPage(1);
      setIsReaderOpen(true);
    } catch (error) {
      console.error(error);
      alert("Không thể đọc file");
    } finally {
      e.target.value = "";
    }
  };

  const translatePage = async (idx: number, options?: { force?: boolean }) => {
    const currentBook = bookRef.current;
    if (!currentBook) {
      return;
    }

    const page = currentBook.pages[idx];
    if (!page || page.status === "translating") {
      return;
    }

    const needsRetranslateConfirm =
      !options?.force &&
      page.status !== "translating" &&
      (page.status === "completed" || page.translatedText.trim().length > 0);

    if (needsRetranslateConfirm) {
      setRetranslateConfirmIdx(idx);
      return;
    }

    setRetranslateConfirmIdx(null);
    setBook((prev) => {
      if (!prev?.pages[idx]) {
        return prev;
      }

      const newPages = [...prev.pages];
      newPages[idx] = { ...newPages[idx], status: "translating", error: undefined };
      return { ...prev, pages: newPages };
    });

    try {
      const syncModel = (model: string) => {
        if (settingsRef.current.model === model) {
          return;
        }

        settingsRef.current = { ...settingsRef.current, model };
        setSettings((prev) => (prev.model === model ? prev : { ...prev, model }));
        setBook((prev) => (prev && prev.model !== model ? { ...prev, model } : prev));
      };

      const result = await translationService.translatePage(
        page.originalText,
        buildEffectiveSettings(settingsRef.current),
        {
          onModelChange: syncModel,
        },
      );

      syncModel(result.usedModel);

      setBook((prev) => {
        if (!prev?.pages[idx]) {
          return prev;
        }

        const newPages = [...prev.pages];
        newPages[idx] = {
          ...newPages[idx],
          translatedText: result.translatedText,
          status: "completed",
          error: undefined,
          versionHistory: [result.translatedText, ...newPages[idx].versionHistory],
        };
        return { ...prev, pages: newPages };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dịch thất bại";
      setBook((prev) => {
        if (!prev?.pages[idx]) {
          return prev;
        }

        const newPages = [...prev.pages];
        newPages[idx] = { ...newPages[idx], status: "error", error: message };
        return { ...prev, pages: newPages };
      });
      throw error;
    }
  };

  useEffect(() => {
    let active = true;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (!isAutoTranslating || !bookRef.current || !isReaderOpen) {
        return;
      }

      const totalPages = bookRef.current.pages.length;
      let nextIdx = Math.max(0, Math.min(autoStartPage - 1, Math.max(0, totalPages - 1)));
      let shouldTranslateSequentially = autoTranslateHadFailureRef.current;
      let launchedCount = 0;
      const inFlight = new Set<Promise<boolean>>();

      const waitBeforeNextLaunch = async () => {
        if (
          shouldTranslateSequentially ||
          launchedCount === 0 ||
          launchedCount >= AUTO_TRANSLATE_PARALLEL_LIMIT
        ) {
          return;
        }

        await new Promise<void>((resolve) => {
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            resolve();
          }, AUTO_TRANSLATE_INITIAL_STAGGER_MS);
        });
      };

      const getNextPageIndex = () => {
        while (nextIdx < totalPages) {
          const pageIdx = nextIdx;
          const currentPage = bookRef.current?.pages[pageIdx];
          nextIdx += 1;

          if (!currentPage || currentPage.status === "translating" || isPageAlreadyTranslated(currentPage)) {
            continue;
          }

          return pageIdx;
        }

        return null;
      };

      const launchTranslation = (pageIdx: number) => {
        const task = translatePage(pageIdx)
          .then(() => true)
          .catch((error) => {
            console.error(`Error at page ${pageIdx + 1}`, error);
            return false;
          })
          .then((success) => {
            if (!success) {
              shouldTranslateSequentially = true;
              autoTranslateHadFailureRef.current = true;
            }

            return success;
          });

        inFlight.add(task);
        void task.finally(() => {
          inFlight.delete(task);
        });
      };

      while (active && nextIdx < totalPages) {
        const batchSize = shouldTranslateSequentially ? 1 : AUTO_TRANSLATE_PARALLEL_LIMIT;
        let startedNewTask = false;

        while (active && inFlight.size < batchSize) {
          const pageIdx = getNextPageIndex();
          if (pageIdx === null) {
            break;
          }

          await waitBeforeNextLaunch();
          if (!active) {
            break;
          }

          launchTranslation(pageIdx);
          launchedCount += 1;
          startedNewTask = true;
        }

        if (!active) {
          break;
        }

        if (inFlight.size === 0) {
          break;
        }

        if (startedNewTask && inFlight.size < batchSize && nextIdx >= totalPages) {
          continue;
        }

        await Promise.race(Array.from(inFlight));
      }

      while (active && inFlight.size > 0) {
        await Promise.race(Array.from(inFlight));
      }

      if (active) {
        setIsAutoTranslating(false);
      }
    };

    void run();

    return () => {
      active = false;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
    };
  }, [isAutoTranslating, isReaderOpen, autoStartPage]);

  const exportPDF = async (mode: "translated" | "bilingual") => {
    if (!book || isExporting) {
      return;
    }

    setIsExporting(true);

    const escapeHtml = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const repairLikelyMojibake = (value: string) => {
      if (!/(Ã.|Â.|Æ.|áº|á»|Ä.|Å.)/.test(value)) {
        return value;
      }

      try {
        const bytes = Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff);
        const recovered = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        return recovered.includes("\uFFFD") ? value : recovered;
      } catch {
        return value;
      }
    };

    const normalizeForPdf = (value: string) => repairLikelyMojibake(value).normalize("NFC");
    const pagesToExport = book.pages.filter(
      (page) => normalizeForPdf(page.translatedText ?? "").trim().length > 0,
    );

    try {
      if (pagesToExport.length === 0) {
        alert("Chưa có trang nào đã dịch để xuất PDF.");
        return;
      }

      type Block = {
        kind: "title" | "body";
        text: string;
      };

      const PAGE_WIDTH_PX = 794;
      const PAGE_HEIGHT_PX = 1123;
      const PAGE_PADDING_Y_PX = 32;
      const PAGE_PADDING_X_PX = 36;
      const CONTENT_MAX_HEIGHT_PX = PAGE_HEIGHT_PX - PAGE_PADDING_Y_PX * 2;

      const basePageStyle =
        "width: 794px; height: 1123px; padding: 32px 36px; box-sizing: border-box; background: #ffffff; color: #111827; font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.65; white-space: normal; word-break: break-word; overflow: hidden;";
      const contentStyle = "height: 100%; overflow: hidden;";

      const blockToHtml = (block: Block) => {
        if (block.kind === "title") {
          return `<h1 style="margin: 0 0 8px; font-size: 28px; line-height: 1.3;">${escapeHtml(block.text)}</h1>`;
        }
        return `<p style="margin: 0 0 14px; white-space: pre-wrap;">${escapeHtml(block.text).replaceAll("\n", "<br />")}</p>`;
      };

      const blocks: Block[] = [
        { kind: "title", text: "BẢN DỊCH TÀI LIỆU" },
        { kind: "body", text: normalizeForPdf(book.name) },
        {
          kind: "body",
          text: `Ngôn ngữ: ${settings.sourceLang} -> ${settings.targetLang}`,
        },
        {
          kind: "body",
          text: `Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}`,
        },
      ];

      for (let i = 0; i < pagesToExport.length; i += 1) {
        const page = pagesToExport[i];
        const translated = normalizeForPdf(page.translatedText || "(chưa dịch)");
        const original = normalizeForPdf(page.originalText || "(trống)");

        if (mode === "bilingual") {
          blocks.push({ kind: "body", text: `Bản gốc:\n${original}` });
          blocks.push({ kind: "body", text: "" });
        }

        blocks.push({ kind: "body", text: mode === "bilingual" ? `Bản dịch:\n${translated}` : translated });
        blocks.push({ kind: "body", text: "" });
      }

      const measureRoot = document.createElement("div");
      measureRoot.style.position = "fixed";
      measureRoot.style.left = "-10000px";
      measureRoot.style.top = "0";
      measureRoot.style.width = `${PAGE_WIDTH_PX}px`;
      measureRoot.style.height = `${PAGE_HEIGHT_PX}px`;
      measureRoot.style.pointerEvents = "none";
      measureRoot.innerHTML = `<div style="${basePageStyle}"><div id="pdf-content" style="${contentStyle}"></div></div>`;
      document.body.appendChild(measureRoot);

      const measureContent = measureRoot.querySelector("#pdf-content") as HTMLDivElement;
      const pageHtmlList: string[] = [];
      let currentParts: string[] = [];
      const hasVisibleText = (html: string) =>
        html
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, "")
          .length > 0;

      const fitsCurrentPage = (parts: string[]) => {
        measureContent.innerHTML = parts.join("");
        return measureContent.scrollHeight <= CONTENT_MAX_HEIGHT_PX;
      };

      const pushCurrentPage = () => {
        if (currentParts.length === 0) {
          return;
        }
        const merged = currentParts.join("");
        if (!hasVisibleText(merged)) {
          currentParts = [];
          return;
        }
        pageHtmlList.push(`<div style="${basePageStyle}"><div style="${contentStyle}">${merged}</div></div>`);
        currentParts = [];
      };

      const splitBodyToFit = (text: string) => {
        const tokens = text.match(/\S+\s*/g) ?? [text];
        let low = 1;
        let high = tokens.length;
        let best = 0;

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidate = tokens.slice(0, mid).join("");
          const candidateHtml = blockToHtml({ kind: "body", text: candidate });

          if (fitsCurrentPage([...currentParts, candidateHtml])) {
            best = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }

        const safeBest = best === 0 ? 1 : best;
        const headRaw = tokens.slice(0, safeBest).join("");
        const tailRaw = tokens.slice(safeBest).join("");
        const head = headRaw.length > 0 ? headRaw.trimEnd() : text.slice(0, 1);
        const tail = headRaw.length > 0 ? tailRaw.trimStart() : text.slice(1);
        return { head, tail };
      };

      try {
        for (const block of blocks) {
          if (block.kind !== "body") {
            const html = blockToHtml(block);
            const candidate = [...currentParts, html];
            if (fitsCurrentPage(candidate)) {
              currentParts = candidate;
              continue;
            }

            pushCurrentPage();
            currentParts = [html];
            continue;
          }

          let remaining = block.text;

          while (remaining.length > 0) {
            if (remaining.trim().length === 0) {
              break;
            }
            const html = blockToHtml({ kind: "body", text: remaining });
            const candidate = [...currentParts, html];

            if (fitsCurrentPage(candidate)) {
              currentParts = candidate;
              remaining = "";
              continue;
            }

            if (currentParts.length > 0) {
              pushCurrentPage();
              continue;
            }

            const { head, tail } = splitBodyToFit(remaining);
            currentParts = [blockToHtml({ kind: "body", text: head })];
            pushCurrentPage();
            remaining = tail;
          }
        }

        pushCurrentPage();
      } finally {
        measureRoot.remove();
      }

      const doc = new jsPDF({
        unit: "pt",
        format: "a4",
        compress: true,
      });
      const pageWidthPt = doc.internal.pageSize.getWidth();
      const pageHeightPt = doc.internal.pageSize.getHeight();

      for (let i = 0; i < pageHtmlList.length; i += 1) {
        const pageRoot = document.createElement("div");
        pageRoot.style.position = "fixed";
        pageRoot.style.left = "-10000px";
        pageRoot.style.top = "0";
        pageRoot.style.width = `${PAGE_WIDTH_PX}px`;
        pageRoot.style.height = `${PAGE_HEIGHT_PX}px`;
        pageRoot.style.pointerEvents = "none";
        pageRoot.innerHTML = pageHtmlList[i];
        document.body.appendChild(pageRoot);

        try {
          const pageCanvas = await html2canvas(pageRoot, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
          });
          const pageData = pageCanvas.toDataURL("image/jpeg", 0.95);

          if (i > 0) {
            doc.addPage();
          }

          doc.addImage(pageData, "JPEG", 0, 0, pageWidthPt, pageHeightPt, undefined, "FAST");
        } finally {
          pageRoot.remove();
        }
      }

      doc.save(`${book.name}_translated.pdf`);
    } catch (error) {
      console.error("Export PDF failed", error);
      alert("Không thể xuất PDF. Vui lòng thử lại.");
    } finally {
      setIsExporting(false);
    }
  };

  const currentPage = book?.pages[currentPageIdx];
  const filteredPages = book?.pages.filter((page, idx) => {
    const needle = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !needle ||
      `${idx + 1}`.includes(needle) ||
      page.originalText.toLowerCase().includes(needle) ||
      page.translatedText.toLowerCase().includes(needle);

    return matchesSearch && matchesPageFilter(page, pageFilter);
  });
  const pageFilterCounts = book
    ? {
        all: book.pages.length,
        idle: book.pages.filter((page) => matchesPageFilter(page, "idle")).length,
        error: book.pages.filter((page) => matchesPageFilter(page, "error")).length,
        completed: book.pages.filter((page) => matchesPageFilter(page, "completed")).length,
        edited: book.pages.filter((page) => matchesPageFilter(page, "edited")).length,
      }
    : null;

  const hasDraftSession = draftSessions.length > 0;
  const activeDraftSession =
    draftSessions.find((session) => session.book.id === book?.id) ?? draftSessions[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F0] text-[#141414] transition-colors duration-300 dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <header className="sticky top-0 z-50 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-inherit px-4 py-3 backdrop-blur-md dark:border-white/10 md:h-16 md:flex-nowrap md:px-6 md:py-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white">
            L
          </div>
          <h1 className="serif text-xl font-semibold italic tracking-tight">Book Translator</h1>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-4">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="rounded-full p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {!book || !isReaderOpen ? (
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-900/20 transition-all hover:bg-emerald-700 sm:w-auto">
              <Upload size={16} />
              Tải sách lên
              <input
                type="file"
                className="hidden"
                onChange={handleFileUpload}
                accept=".pdf,.docx,.doc"
              />
            </label>
          ) : (
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <button
                onClick={() => void exportPDF("translated")}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900"
              >
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {isExporting ? "Đang xuất..." : "Xuất PDF"}
              </button>
              <button
                onClick={() => {
                  setIsAutoTranslating(false);
                  setIsReaderOpen(false);
                }}
                className="px-2 text-sm text-red-500 hover:underline"
              >
                Quay lại
              </button>
            </div>
          )}
          {hasDraftSession && !isReaderOpen && (
            <button
              onClick={() => activeDraftSession && openDraftSession(activeDraftSession)}
              className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 sm:w-auto dark:border-white/10 dark:bg-zinc-900"
            >
              Quay lại bản đang dịch
            </button>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {!book || !isReaderOpen ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center md:p-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xl"
            >
              <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
                <FileText size={40} />
              </div>
              <h2 className="serif mb-4 text-3xl font-light italic md:text-4xl">
                Dịch sách để đọc và chỉnh sửa từng trang
              </h2>
              <p className="mb-8 leading-relaxed text-zinc-500 dark:text-zinc-400">
                Hỗ trợ PDF và DOCX. Văn bản được tách thành từng trang để xử lý bản dịch, sau đó trả về giao diện để bạn xem và sửa.
              </p>
              <label className="inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-[#141414] px-8 py-4 font-medium text-white shadow-2xl transition-transform hover:scale-[1.02] sm:w-auto sm:hover:scale-105 dark:bg-[#E4E3E0] dark:text-black">
                <Upload size={20} />
                Chọn tài liệu để bắt đầu
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept=".pdf,.docx,.doc"
                />
              </label>

              <button
                onClick={() => {
                  setUploadNotice(null);
                  setBook({
                    id: "mock",
                    name: "Sách mẫu - Đắc Nhân Tâm.pdf",
                    size: 1024 * 1024,
                    totalPages: 3,
                    pages: [
                      {
                        id: 1,
                        originalText:
                          "Chapter 1: Fundamental Techniques in Handling People. If you want to gather honey, don't kick over the beehive.",
                        translatedText: "",
                        status: "idle",
                        versionHistory: [],
                      },
                      {
                        id: 2,
                        originalText:
                          "Chapter 2: Six Ways to Make People Like You. Become genuinely interested in other people.",
                        translatedText: "",
                        status: "idle",
                        versionHistory: [],
                      },
                      {
                        id: 3,
                        originalText:
                          "Chapter 3: How to Win People to Your Way of Thinking. The only way to get the best of an argument is to avoid it.",
                        translatedText: "",
                        status: "idle",
                        versionHistory: [],
                      },
                    ],
                    ...settings,
                  });
                  setCurrentPageIdx(0);
                  setAutoStartPage(1);
                  setIsReaderOpen(true);
                }}
                className="mt-4 ml-4 text-sm text-zinc-500 underline hover:text-emerald-500"
              >
                Dùng dữ liệu mẫu để thử nghiệm
              </button>

              {uploadNotice && (
                <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-50 p-4 text-left text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="text-sm font-semibold">{uploadNotice}</p>
                </div>
              )}

              {hasDraftSession && (
                <div className="mt-6 rounded-2xl border border-black/10 bg-black/5 p-4 text-left dark:border-white/10 dark:bg-white/5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">Phiên dịch đang lưu</p>
                    <p className="text-xs opacity-60">Tối đa 3 file</p>
                  </div>

                  <div className="space-y-3">
                    {draftSessions.map((session) => {
                      const completedPages = session.book.pages.filter(
                        (page) => page.status === "completed" || page.translatedText.trim().length > 0,
                      ).length;

                      return (
                        <div
                          key={session.book.id}
                          className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-zinc-900/70"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{session.book.name}</p>
                              <p className="mt-1 text-xs opacity-70">
                                {completedPages}/{session.book.totalPages} trang đã dịch
                              </p>
                            </div>
                            <button
                              onClick={() => removeDraftSession(session.book.id)}
                              className="rounded-lg p-1 text-zinc-500 hover:bg-black/5 hover:text-red-500 dark:hover:bg-white/5"
                              aria-label={`Xóa session ${session.book.name}`}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <button
                            onClick={() => openDraftSession(session)}
                            className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                          >
                            Quay lại màn dịch
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-12 grid grid-cols-1 gap-6 text-sm opacity-60 sm:grid-cols-3">
                <div>
                  <div className="mb-1 font-bold">Webhook</div>
                  Auto FLow
                </div>
                <div>
                  <div className="mb-1 font-bold">Bilingual</div>
                  Xem song song
                </div>
                <div>
                  <div className="mb-1 font-bold">Export</div>
                  PDF đã dịch
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <>
            <aside className="hidden md:flex md:w-72 flex-col border-r border-black/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/50">
              <div className="border-b border-black/10 p-4 dark:border-white/10">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                    size={14}
                  />
                  <input
                    type="text"
                    placeholder="Tìm trang..."
                    className="w-full rounded-lg bg-black/5 py-2 pl-9 pr-4 text-sm outline-none ring-emerald-500 focus:ring-1 dark:bg-white/5"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PAGE_FILTER_OPTIONS.map((filter) => (
                    <button
                      key={`desktop-filter-${filter}`}
                      onClick={() => setPageFilter(filter)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        pageFilter === filter
                          ? "bg-emerald-600 text-white"
                          : "bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10",
                      )}
                    >
                      {filter === "all" && "Tất cả"}
                      {filter === "idle" && "Chưa dịch"}
                      {filter === "error" && "Lỗi"}
                      {filter === "completed" && "Đã dịch"}
                      {filter === "edited" && "Đã sửa tay"}
                      {pageFilterCounts && (
                        <span className="ml-1 opacity-70">
                          {pageFilterCounts[filter]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {filteredPages?.length ? (
                  filteredPages.map((page) => {
                    const idx = book.pages.findIndex((item) => item.id === page.id);

                    return (
                      <button
                        key={page.id}
                        onClick={() => {
                          setCurrentPageIdx(idx);
                          setIsMobilePagesOpen(false);
                        }}
                        className={cn(
                          "group flex w-full items-center justify-between rounded-xl p-3 text-sm transition-all",
                          currentPageIdx === idx
                            ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
                            : "hover:bg-black/5 dark:hover:bg-white/5",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] opacity-50">{idx + 1}</span>
                          <span className="max-w-[140px] truncate">
                            {page.originalText.substring(0, 20)}...
                          </span>
                        </div>
                        {page.status === "translating" && (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        {page.status !== "error" &&
                          page.status !== "translating" &&
                          isPageEdited(page) && (
                            <Edit3
                              size={14}
                              className={currentPageIdx === idx ? "text-white" : "text-amber-500"}
                            />
                          )}
                        {page.status !== "error" &&
                          page.status !== "translating" &&
                          !isPageEdited(page) &&
                          page.status === "completed" && (
                            <CheckCircle2
                              size={14}
                              className={currentPageIdx === idx ? "text-white" : "text-emerald-500"}
                            />
                          )}
                        {page.status === "error" && (
                          <AlertCircle size={14} className="text-red-500" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-sm opacity-50">
                    Không có trang nào khớp bộ lọc hiện tại.
                  </div>
                )}
              </div>

              <div className="border-t border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>Tiến độ dịch</span>
                  <span>
                    {book.pages.filter((page) => matchesPageFilter(page, "completed")).length} /{" "}
                    {book.totalPages} trang
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{
                      width: `${(book.pages.filter((page) => matchesPageFilter(page, "completed")).length /
                        book.totalPages) *
                        100
                        }%`,
                    }}
                  />
                </div>
              </div>
            </aside>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-white/30 px-3 py-2 dark:border-white/10 dark:bg-zinc-900/30 md:h-14 md:flex-nowrap md:px-6 md:py-0">
                <div className="flex items-center gap-2 md:gap-4">
                  <button
                    onClick={() => setIsMobilePagesOpen(true)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 md:hidden dark:border-white/10 dark:bg-zinc-900"
                  >
                    Trang
                  </button>
                  <button
                    onClick={() => setIsMobileSettingsOpen(true)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 md:hidden dark:border-white/10 dark:bg-zinc-900"
                  >
                    Cài đặt
                  </button>
                  <div className="flex items-center rounded-lg bg-black/5 p-1 dark:bg-white/5">
                    <button
                      onClick={() => setCurrentPageIdx(Math.max(0, currentPageIdx - 1))}
                      className="rounded-md p-1.5 transition-all hover:bg-white dark:hover:bg-zinc-800"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="px-3 text-sm font-medium">
                      Trang {currentPageIdx + 1} / {book.totalPages}
                    </div>
                    <button
                      onClick={() =>
                        setCurrentPageIdx(Math.min(book.totalPages - 1, currentPageIdx + 1))
                      }
                      className="rounded-md p-1.5 transition-all hover:bg-white dark:hover:bg-zinc-800"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
                  {isAutoTranslating ? (
                    <button
                      onClick={() => setIsAutoTranslating(false)}
                      className="flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-600 hover:bg-amber-500/20"
                    >
                      <Pause size={16} />
                      Tạm dừng dịch
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsAutoTranslating(true)}
                      className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-500/20"
                    >
                      <Play size={16} />
                      Dịch tự động
                    </button>
                  )}
                  <button
                    onClick={() => void translatePage(currentPageIdx)}
                    disabled={currentPage?.status === "translating"}
                    className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    {currentPage?.status === "translating" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                    Dịch trang này
                  </button>
                  <button
                    onClick={() => setIsSettingsOpen((prev) => !prev)}
                    className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 md:flex dark:border-white/10 dark:bg-zinc-900"
                  >
                    <Settings size={16} />
                    {isSettingsOpen ? "Ẩn setting" : "Hiện setting"}
                  </button>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3 md:gap-6 md:p-6 lg:flex-row">
                <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/5 dark:bg-zinc-900">
                  <div className="border-b border-black/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest opacity-50 dark:border-white/5">
                    Bản gốc ({settings.sourceLang})
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 font-serif text-base leading-relaxed md:p-8 md:text-lg">
                    {currentPage?.originalText}
                  </div>
                </div>

                <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/5 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-black/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest opacity-50 dark:border-white/5">
                    <span>Bản dịch ({settings.targetLang})</span>
                    {currentPage && isPageEdited(currentPage) ? (
                      <span className="flex items-center gap-1 text-amber-500">
                        <Edit3 size={10} />
                        Đã sửa tay
                      </span>
                    ) : (
                      currentPage?.status === "completed" && (
                        <span className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 size={10} />
                          Đã dịch
                        </span>
                      )
                    )}
                  </div>
                  <div className="relative flex flex-1 flex-col overflow-hidden p-4 font-serif text-base leading-relaxed md:p-8 md:text-lg">
                    {currentPage?.status === "translating" && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-zinc-900/80">
                        <Loader2 size={32} className="mb-4 animate-spin text-emerald-500" />
                        <p className="animate-pulse text-sm font-medium">
                          Đang gửi nội dung sang webhook để dịch...
                        </p>
                      </div>
                    )}

                    {currentPage?.status === "error" && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                        <AlertCircle size={40} className="mb-4 text-red-500" />
                        <h3 className="mb-2 font-bold text-red-500">Lỗi dịch thuật</h3>
                        <p className="mb-4 text-sm opacity-60">{currentPage.error}</p>
                        <button
                          onClick={() => void translatePage(currentPageIdx)}
                          className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white"
                        >
                          Thử lại
                        </button>
                      </div>
                    )}

                    {retranslateConfirmIdx === currentPageIdx &&
                      currentPage?.status !== "translating" && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/88 p-6 backdrop-blur-sm dark:bg-zinc-900/88">
                          <div className="w-full max-w-md rounded-2xl border border-amber-500/20 bg-amber-50 p-5 text-center shadow-sm dark:bg-amber-500/10">
                            <AlertCircle size={36} className="mx-auto mb-3 text-amber-600" />
                            <h3 className="mb-2 text-base font-semibold text-amber-700 dark:text-amber-300">
                              Trang này đã có bản dịch
                            </h3>
                            <p className="mb-5 text-sm text-amber-900/70 dark:text-amber-100/70">
                              Dịch lại sẽ thay bản dịch hiện tại bằng kết quả mới.
                            </p>
                            <div className="flex flex-col justify-center gap-2 sm:flex-row">
                              <button
                                onClick={() => setRetranslateConfirmIdx(null)}
                                className="rounded-lg border border-amber-600/20 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-300/20 dark:text-amber-200 dark:hover:bg-amber-400/10"
                              >
                                Giữ bản hiện tại
                              </button>
                              <button
                                onClick={() => void translatePage(currentPageIdx, { force: true })}
                                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
                              >
                                Dịch lại trang này
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                    {!currentPage?.translatedText && currentPage?.status === "idle" && (
                      <div className="flex h-full flex-col items-center justify-center italic opacity-20">
                        <Edit3 size={48} className="mb-4" />
                        Chưa có bản dịch cho trang này
                      </div>
                    )}

                    {currentPage?.translatedText && (
                      <textarea
                        className="min-h-0 flex-1 resize-none overflow-y-auto bg-transparent outline-none focus:ring-0"
                        value={currentPage.translatedText}
                        onChange={(e) => {
                          if (!book || !currentPage) {
                            return;
                          }

                          const newPages = [...book.pages];
                          newPages[currentPageIdx] = {
                            ...currentPage,
                            translatedText: e.target.value,
                          };
                          setBook({ ...book, pages: newPages });
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {isSettingsOpen && (
              <aside className="hidden overflow-y-auto border-l border-black/10 bg-white/50 p-6 dark:border-white/10 dark:bg-zinc-900/50 lg:block lg:w-80">
                <div className="mb-8 flex items-center gap-2 opacity-50">
                  <Settings size={18} />
                  <h3 className="text-sm font-bold uppercase tracking-widest">Cấu hình dịch</h3>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Model</label>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.model}
                      onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    >
                      <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">
                      Auto bắt đầu từ trang
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, book.totalPages)}
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={autoStartPage}
                      onChange={(e) => {
                        const raw = Number.parseInt(e.target.value, 10);
                        if (Number.isNaN(raw)) {
                          setAutoStartPage(1);
                          return;
                        }

                        const maxPage = Math.max(1, book.totalPages);
                        setAutoStartPage(Math.min(Math.max(raw, 1), maxPage));
                      }}
                    />
                    <p className="mt-1 text-[11px] opacity-60">
                      Trang đã dịch sẵn sẽ tự động bỏ qua.
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Văn phong</label>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.style}
                      onChange={(e) =>
                        setSettings({ ...settings, style: e.target.value as TranslationSettings["style"] })
                      }
                    >
                      <option value="natural">Tự nhiên</option>
                      <option value="literal">Sát nghĩa</option>
                      <option value="literary">Văn học</option>
                      <option value="academic">Học thuật</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Preset dịch</label>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.promptPreset}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          promptPreset: e.target.value as PromptPreset,
                        })
                      }
                    >
                      {Object.entries(PROMPT_PRESETS).map(([value, preset]) => (
                        <option key={`desktop-preset-${value}`} value={value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] opacity-60">
                      {PROMPT_PRESETS[settings.promptPreset].description}
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Ngôn ngữ đích</label>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.targetLang}
                      onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
                    >
                      <option value="Vietnamese">Tiếng Việt</option>
                      <option value="English">Tiếng Anh</option>
                      <option value="Japanese">Tiếng Nhật</option>
                      <option value="French">Tiếng Pháp</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Glossary</label>
                    <textarea
                      placeholder="Ví dụ: Harry -> Harry, Hogwarts -> Trường Hogwarts..."
                      className="h-24 w-full resize-none rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.glossary}
                      onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold opacity-60">Hướng dẫn thêm</label>
                    <textarea
                      placeholder="Ví dụ: xưng hô tôi - bạn, không dịch tên riêng..."
                      className="h-24 w-full resize-none rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.instructions}
                      onChange={(e) => setSettings({ ...settings, instructions: e.target.value })}
                    />
                  </div>

                  <div className="pt-4">
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <h4 className="mb-1 text-xs font-bold text-emerald-600">Lưu ý</h4>
                      <p className="text-[11px] leading-relaxed text-emerald-700/70">
                        Bản dịch hiện được gửi qua webhook. Nếu workflow chưa active hoặc
                        test webhook chưa được Execute, trang sẽ báo lỗi ở bước dịch.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            )}

            {isMobilePagesOpen && (
              <div className="fixed inset-0 z-[70] md:hidden">
                <button
                  onClick={() => setIsMobilePagesOpen(false)}
                  className="absolute inset-0 bg-black/40"
                  aria-label="Đóng danh sách trang"
                />
                <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-xs flex-col border-r border-black/10 bg-white p-0 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-black/10 p-4 dark:border-white/10">
                    <h3 className="text-sm font-semibold">Danh sách trang</h3>
                    <button
                      onClick={() => setIsMobilePagesOpen(false)}
                      className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="border-b border-black/10 p-4 dark:border-white/10">
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                        size={14}
                      />
                      <input
                        type="text"
                        placeholder="Tìm trang..."
                        className="w-full rounded-lg bg-black/5 py-2 pl-9 pr-4 text-sm outline-none ring-emerald-500 focus:ring-1 dark:bg-white/5"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {PAGE_FILTER_OPTIONS.map((filter) => (
                        <button
                          key={`mobile-filter-${filter}`}
                          onClick={() => setPageFilter(filter)}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                            pageFilter === filter
                              ? "bg-emerald-600 text-white"
                              : "bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10",
                          )}
                        >
                          {filter === "all" && "Tất cả"}
                          {filter === "idle" && "Chưa dịch"}
                          {filter === "error" && "Lỗi"}
                          {filter === "completed" && "Đã dịch"}
                          {filter === "edited" && "Đã sửa tay"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 space-y-1 overflow-y-auto p-2">
                    {filteredPages?.length ? (
                      filteredPages.map((page) => {
                        const idx = book.pages.findIndex((item) => item.id === page.id);

                        return (
                          <button
                            key={`mobile-page-${page.id}`}
                            onClick={() => {
                              setCurrentPageIdx(idx);
                              setIsMobilePagesOpen(false);
                            }}
                            className={cn(
                              "group flex w-full items-center justify-between rounded-xl p-3 text-sm transition-all",
                              currentPageIdx === idx
                                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
                                : "hover:bg-black/5 dark:hover:bg-white/5",
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[10px] opacity-50">{idx + 1}</span>
                              <span className="max-w-[140px] truncate">
                                {page.originalText.substring(0, 20)}...
                              </span>
                            </div>
                            {page.status === "translating" && <Loader2 size={14} className="animate-spin" />}
                            {page.status === "error" && <AlertCircle size={14} className="text-red-500" />}
                            {page.status !== "error" &&
                              page.status !== "translating" &&
                              isPageEdited(page) && (
                                <Edit3
                                  size={14}
                                  className={currentPageIdx === idx ? "text-white" : "text-amber-500"}
                                />
                              )}
                            {page.status !== "error" &&
                              page.status !== "translating" &&
                              !isPageEdited(page) &&
                              page.status === "completed" && (
                                <CheckCircle2
                                  size={14}
                                  className={currentPageIdx === idx ? "text-white" : "text-emerald-500"}
                                />
                              )}
                          </button>
                        );
                      })
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-sm opacity-50">
                        Không có trang nào khớp bộ lọc hiện tại.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span>Tiến độ dịch</span>
                      <span>
                        {book.pages.filter((page) => matchesPageFilter(page, "completed")).length} /{" "}
                        {book.totalPages} trang
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{
                          width: `${(book.pages.filter((page) => matchesPageFilter(page, "completed")).length /
                            book.totalPages) *
                            100}%`,
                        }}
                      />
                    </div>
                  </div>
                </aside>
              </div>
            )}

            {isMobileSettingsOpen && (
              <div className="fixed inset-0 z-[70] md:hidden">
                <button
                  onClick={() => setIsMobileSettingsOpen(false)}
                  className="absolute inset-0 bg-black/40"
                  aria-label="Đóng cài đặt"
                />
                <aside className="absolute inset-y-0 right-0 w-[90vw] max-w-sm overflow-y-auto border-l border-black/10 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
                  <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-widest opacity-70">Cài đặt dịch</h3>
                    <button
                      onClick={() => setIsMobileSettingsOpen(false)}
                      className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Model</label>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                      >
                        <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Auto bắt đầu từ trang</label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, book.totalPages)}
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={autoStartPage}
                        onChange={(e) => {
                          const raw = Number.parseInt(e.target.value, 10);
                          if (Number.isNaN(raw)) {
                            setAutoStartPage(1);
                            return;
                          }

                          const maxPage = Math.max(1, book.totalPages);
                          setAutoStartPage(Math.min(Math.max(raw, 1), maxPage));
                        }}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Văn phong</label>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.style}
                        onChange={(e) =>
                          setSettings({ ...settings, style: e.target.value as TranslationSettings["style"] })
                        }
                      >
                        <option value="natural">Tự nhiên</option>
                        <option value="literal">Sát nghĩa</option>
                        <option value="literary">Văn học</option>
                        <option value="academic">Học thuật</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Preset dịch</label>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.promptPreset}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            promptPreset: e.target.value as PromptPreset,
                          })
                        }
                      >
                        {Object.entries(PROMPT_PRESETS).map(([value, preset]) => (
                          <option key={`mobile-preset-${value}`} value={value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] opacity-60">
                        {PROMPT_PRESETS[settings.promptPreset].description}
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Ngôn ngữ đích</label>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.targetLang}
                        onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
                      >
                        <option value="Vietnamese">Tiếng Việt</option>
                        <option value="English">Tiếng Anh</option>
                        <option value="Japanese">Tiếng Nhật</option>
                        <option value="French">Tiếng Pháp</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Glossary</label>
                      <textarea
                        className="h-24 w-full resize-none rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.glossary}
                        onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold opacity-60">Hướng dẫn thêm</label>
                      <textarea
                        className="h-24 w-full resize-none rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.instructions}
                        onChange={(e) => setSettings({ ...settings, instructions: e.target.value })}
                      />
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
