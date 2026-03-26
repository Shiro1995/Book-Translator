import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
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
import { clsx, type ClassValue } from "clsx";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { routePaths } from "@/app/router/paths";
import { BookTranslationLanding } from "../components/BookTranslationLanding";
import {
  clearLegacyDraftState,
  clampPageIndex,
  type DraftSession,
  persistDraftSessions,
  restoreDraftSessions,
  upsertDraftSession,
} from "../draftSessions";
import {
  peekPendingBookTranslationLaunch,
  takePendingBookTranslationLaunch,
} from "../pendingUploadStore";
import { type Book, type Page, type PromptPreset, type TranslationSettings } from "../types";
import { parseDOCX, parsePDF } from "../services/fileService";
import { translationService } from "../services/translationService";
import { exportPdfService } from "../services/exportPdfService";
import { exportDocxService } from "../services/exportDocxService";
import { normalizeUserFacingText } from "../utils/text";
import { OriginalTextSelectionPane } from "../selection/components/OriginalTextSelectionPane";
import { TranslatedTextSelectionPopup } from "../selection/components/TranslatedTextSelectionPopup";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AUTO_TRANSLATE_PARALLEL_LIMIT = 3;
const AUTO_TRANSLATE_INITIAL_STAGGER_MS = 5_000;
const DESKTOP_PAGE_LIST_SIZE = 15;
const PAGE_FILTER_OPTIONS = ["all", "idle", "error", "completed", "edited"] as const;

type PageFilter = (typeof PAGE_FILTER_OPTIONS)[number];
type ExportPageRangeMode = "all" | "custom";
type ExportFileFormat = "pdf" | "docx";

type ExportPageSelection = {
  startPage: number;
  endPage: number;
};

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

const GLOSSARY_TOOLTIP_TEXT =
  "Bảng thuật ngữ là danh sách cặp thuật ngữ nguồn -> đích (ví dụ: Hogwarts -> Trường Hogwarts). Hệ thống sẽ ưu tiên các cặp này khi dịch.";

function resolveStyleFromPromptPreset(
  promptPreset: PromptPreset,
  fallbackStyle: TranslationSettings["style"] = "natural",
): TranslationSettings["style"] {
  switch (promptPreset) {
    case "reader":
      return "natural";
    case "literary":
      return "literary";
    case "technical":
      return "academic";
    case "study":
      return "academic";
    case "custom":
    default:
      return fallbackStyle;
  }
}

function GlossaryInfoTooltip() {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label="Giải thích bảng thuật ngữ"
        title={GLOSSARY_TOOLTIP_TEXT}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-current/40 text-[10px] leading-none opacity-80"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.4rem)] z-30 hidden w-64 -translate-x-1/2 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[11px] font-medium normal-case leading-relaxed tracking-normal text-zinc-600 shadow-xl group-hover:block group-focus-within:block dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
        {GLOSSARY_TOOLTIP_TEXT}
      </span>
    </span>
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
  const style = resolveStyleFromPromptPreset(settings.promptPreset, settings.style);

  return {
    ...settings,
    style,
    instructions: [presetInstructions, customInstructions].filter(Boolean).join("\n\n"),
  };
}

function getSettingsFromBook(book: Book): TranslationSettings {
  const promptPreset = book.promptPreset ?? "reader";

  return {
    model: book.model,
    targetLang: book.targetLang,
    style: resolveStyleFromPromptPreset(promptPreset, book.style),
    promptPreset,
    glossary: book.glossary,
    instructions: book.instructions,
  };
}

function isInteractiveShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

export default function App() {
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isMobilePagesOpen, setIsMobilePagesOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportFileFormat, setExportFileFormat] = useState<ExportFileFormat>("pdf");
  const [exportPageRangeMode, setExportPageRangeMode] = useState<ExportPageRangeMode>("all");
  const [exportRangeStartInput, setExportRangeStartInput] = useState("1");
  const [exportRangeEndInput, setExportRangeEndInput] = useState("1");
  const [retranslateConfirmIdx, setRetranslateConfirmIdx] = useState<number | null>(null);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [hasRestoredDraftState, setHasRestoredDraftState] = useState(false);
  const [isImportingBook, setIsImportingBook] = useState(false);
  const [importingFileName, setImportingFileName] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [autoStartPage, setAutoStartPage] = useState(1);
  const [desktopPageListPage, setDesktopPageListPage] = useState(1);
  const [isOriginalHidden, setIsOriginalHidden] = useState(false);
  const [settings, setSettings] = useState<TranslationSettings>({
    model: "gemini-3-flash-preview",
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
  const desktopPageButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const keyboardPageNavigationRef = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const isImportingBookRef = useRef(false);
  const translatedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      const hasPendingLaunch = Boolean(peekPendingBookTranslationLaunch());
      const normalizedSessions = restoreDraftSessions();

      if (normalizedSessions.length > 0) {
        setDraftSessions(normalizedSessions);
        if (!hasPendingLaunch) {
          setBook(normalizedSessions[0].book);
          setSettings(getSettingsFromBook(normalizedSessions[0].book));
          setCurrentPageIdx(normalizedSessions[0].currentPageIdx);
        }
        return;
      }
    } catch (error) {
      console.error("Failed to restore draft state", error);
    } finally {
      setHasRestoredDraftState(true);
    }
  }, []);

  useEffect(() => {
    if (!hasRestoredDraftState) {
      return;
    }

    persistDraftSessions(draftSessions);
  }, [draftSessions, hasRestoredDraftState]);

  useEffect(() => {
    clearLegacyDraftState();
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
    setIsExportMenuOpen(false);
    setRetranslateConfirmIdx(null);
  }, [isReaderOpen]);

  useEffect(() => {
    if (!book) {
      setIsExportMenuOpen(false);
      return;
    }

    setExportPageRangeMode("all");
    setExportRangeStartInput("1");
    setExportRangeEndInput(String(book.totalPages));
  }, [book?.id, book?.totalPages]);

  useEffect(() => {
    if (!isExportMenuOpen) {
      return;
    }

    const handleOutsideExportMenu = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };

    const handleEscapeExportMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideExportMenu);
    document.addEventListener("keydown", handleEscapeExportMenu);

    return () => {
      document.removeEventListener("mousedown", handleOutsideExportMenu);
      document.removeEventListener("keydown", handleEscapeExportMenu);
    };
  }, [isExportMenuOpen]);

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

  const openSampleBook = () => {
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

  const importBookFile = async (file: File, options?: { openExistingSession?: boolean }) => {
    if (isImportingBookRef.current) {
      return;
    }

    const existingSession = draftSessions.find(
      (session) => session.book.name === file.name && session.book.size === file.size,
    );
    if (existingSession) {
      setUploadNotice(`File "${file.name}" đã được tải lên rồi.`);
      if (options?.openExistingSession) {
        openDraftSession(existingSession);
        return;
      }
      setBook(existingSession.book);
      setCurrentPageIdx(existingSession.currentPageIdx);
      return;
    }

    const normalizedFileName = file.name.toLowerCase();

    if (
      !normalizedFileName.endsWith(".pdf") &&
      !normalizedFileName.endsWith(".docx") &&
      !normalizedFileName.endsWith(".doc")
    ) {
      alert("Định dạng file chưa được hỗ trợ");
      return;
    }

    isImportingBookRef.current = true;
    setIsImportingBook(true);
    setImportingFileName(file.name);
    setUploadNotice(null);

    try {
      let result;

      if (normalizedFileName.endsWith(".pdf")) {
        result = await parsePDF(file);
      } else if (normalizedFileName.endsWith(".docx") || normalizedFileName.endsWith(".doc")) {
        result = await parseDOCX(file);
      } else {
        alert("Định dạng file chưa được hỗ trợ");
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
      isImportingBookRef.current = false;
      setIsImportingBook(false);
      setImportingFileName(null);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isImportingBookRef.current) {
      e.target.value = "";
      return;
    }

    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await importBookFile(file);
    } finally {
      e.target.value = "";
    }
  };

  useEffect(() => {
    if (!hasRestoredDraftState) {
      return;
    }

    const pendingLaunch = takePendingBookTranslationLaunch();
    if (!pendingLaunch) {
      return;
    }

    if (pendingLaunch.type === "upload") {
      void importBookFile(pendingLaunch.file, { openExistingSession: true });
      return;
    }

    if (pendingLaunch.type === "sample") {
      openSampleBook();
      return;
    }

    const matchedSession =
      draftSessions.find((session) => session.book.id === pendingLaunch.bookId) ??
      restoreDraftSessions().find((session) => session.book.id === pendingLaunch.bookId);

    if (matchedSession) {
      openDraftSession(matchedSession);
      return;
    }

    setUploadNotice("Không tìm thấy phiên dịch đã chọn.");
  }, [draftSessions, hasRestoredDraftState, settings]);

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

  const exportDocument = async (selection?: ExportPageSelection) => {
    if (!book || isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      if (exportFileFormat === "docx") {
        await exportDocxService.exportBook(book, selection);
      } else {
        await exportPdfService.exportBook(book, selection);
      }
    } catch (error) {
      console.error("Export failed", error);
      const message =
        error instanceof Error && error.message
          ? normalizeUserFacingText(error.message)
          : "Không thể xuất tài liệu. Vui lòng thử lại.";
      alert(message);
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
  }) ?? [];
  const desktopPageListPageCount = Math.max(
    1,
    Math.ceil(filteredPages.length / DESKTOP_PAGE_LIST_SIZE),
  );
  const currentDesktopPageListPage = Math.min(desktopPageListPage, desktopPageListPageCount);
  const desktopPageListStart = (currentDesktopPageListPage - 1) * DESKTOP_PAGE_LIST_SIZE;
  const desktopPaginatedPages = filteredPages.slice(
    desktopPageListStart,
    desktopPageListStart + DESKTOP_PAGE_LIST_SIZE,
  );
  const filteredPageKey = filteredPages.map((page) => page.id).join(",");
  const originalText = normalizeUserFacingText(currentPage?.originalText ?? "");
  const translatedText = normalizeUserFacingText(currentPage?.translatedText ?? "");
  const hasTranslatedContent = translatedText.trim().length > 0;
  const readingFontStyle = {
    fontFamily: '"Segoe UI", Arial, "Helvetica Neue", system-ui, sans-serif',
  } as const;
  const parsedExportRangeStart = Number.parseInt(exportRangeStartInput, 10);
  const parsedExportRangeEnd = Number.parseInt(exportRangeEndInput, 10);
  const exportRangeError =
    !book || exportPageRangeMode === "all"
      ? null
      : !Number.isFinite(parsedExportRangeStart) || !Number.isFinite(parsedExportRangeEnd)
        ? "Nhập đủ số trang bắt đầu và kết thúc."
        : parsedExportRangeStart < 1 || parsedExportRangeEnd < 1
          ? "Số trang phải lớn hơn hoặc bằng 1."
          : parsedExportRangeStart > parsedExportRangeEnd
            ? "Trang bắt đầu phải nhỏ hơn hoặc bằng trang kết thúc."
            : parsedExportRangeEnd > book.totalPages
              ? `Sách hiện chỉ có ${book.totalPages} trang.`
              : null;
  const exportRangeSummary = book
    ? exportPageRangeMode === "all"
      ? `Tất cả trang (1-${book.totalPages})`
      : exportRangeError
        ? "Khoảng trang chưa hợp lệ"
        : `Trang ${parsedExportRangeStart}-${parsedExportRangeEnd}`
    : "";
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
  const canGoToPreviousPage = Boolean(book && currentPageIdx > 0);
  const canGoToNextPage = Boolean(book && currentPageIdx < book.totalPages - 1);

  const appendGlossaryEntry = (entry: string) => {
    setSettings((prev) => {
      const normalizedEntry = entry.trim();
      if (!normalizedEntry) {
        return prev;
      }

      const nextGlossary = prev.glossary.trim()
        ? `${prev.glossary.trim()}\n${normalizedEntry}`
        : normalizedEntry;

      return nextGlossary === prev.glossary ? prev : { ...prev, glossary: nextGlossary };
    });
  };

  const applySelectionTranslationToPage = (translation: string) => {
    if (!book || !currentPage) {
      return;
    }

    const normalizedTranslation = normalizeUserFacingText(translation).trim();
    if (!normalizedTranslation) {
      return;
    }

    const existing = currentPage.translatedText.trim();
    const nextTranslatedText = existing
      ? `${currentPage.translatedText.trimEnd()}\n\n${normalizedTranslation}`
      : normalizedTranslation;

    const newPages = [...book.pages];
    newPages[currentPageIdx] = {
      ...currentPage,
      translatedText: nextTranslatedText,
    };
    setBook({ ...book, pages: newPages });
  };

  const goToPreviousPage = () => {
    setCurrentPageIdx((prev) => Math.max(0, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPageIdx((prev) => Math.min((book?.totalPages ?? 1) - 1, prev + 1));
  };

  useEffect(() => {
    if (!book || !isReaderOpen) {
      return;
    }

    const handleReaderKeyboardNavigation = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isInteractiveShortcutTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowDown" && canGoToNextPage) {
        event.preventDefault();
        keyboardPageNavigationRef.current = true;
        goToNextPage();
      }

      if (event.key === "ArrowUp" && canGoToPreviousPage) {
        event.preventDefault();
        keyboardPageNavigationRef.current = true;
        goToPreviousPage();
      }
    };

    window.addEventListener("keydown", handleReaderKeyboardNavigation);

    return () => {
      window.removeEventListener("keydown", handleReaderKeyboardNavigation);
    };
  }, [book, canGoToNextPage, canGoToPreviousPage, isReaderOpen]);

  useEffect(() => {
    if (!isReaderOpen) {
      keyboardPageNavigationRef.current = false;
      return;
    }

    const activeDesktopButton = desktopPageButtonRefs.current[currentPageIdx];
    if (!activeDesktopButton) {
      return;
    }

    activeDesktopButton.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });

    if (keyboardPageNavigationRef.current) {
      activeDesktopButton.focus({ preventScroll: true });
      keyboardPageNavigationRef.current = false;
    }
  }, [currentPageIdx, currentDesktopPageListPage, isReaderOpen]);

  useEffect(() => {
    if (filteredPages.length === 0) {
      setDesktopPageListPage(1);
      return;
    }

    setDesktopPageListPage((prev) => Math.min(prev, desktopPageListPageCount));
  }, [desktopPageListPageCount, filteredPageKey]);

  useEffect(() => {
    if (filteredPages.length === 0) {
      return;
    }

    const currentFilteredIndex = filteredPages.findIndex((page) => page.id === currentPage?.id);
    if (currentFilteredIndex < 0) {
      setDesktopPageListPage(1);
      return;
    }

    const nextPage = Math.floor(currentFilteredIndex / DESKTOP_PAGE_LIST_SIZE) + 1;
    setDesktopPageListPage((prev) => (prev === nextPage ? prev : nextPage));
  }, [currentPage?.id, filteredPageKey]);

  const exitReader = () => {
    setIsAutoTranslating(false);
    setIsExportMenuOpen(false);
    navigate(routePaths.home);
  };

  const handleExportSubmit = async () => {
    if (!book || isExporting || exportRangeError) {
      return;
    }

    const selection: ExportPageSelection =
      exportPageRangeMode === "all"
        ? {
          startPage: 1,
          endPage: book.totalPages,
        }
        : {
          startPage: parsedExportRangeStart,
          endPage: parsedExportRangeEnd,
        };

    setIsExportMenuOpen(false);
    await exportDocument(selection);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F0] text-[#141414] transition-colors duration-300 dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[#F5F5F0]/92 px-4 py-3 dark:border-white/10 dark:bg-[#0A0A0A]/92 md:px-6 md:backdrop-blur-md">
        <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-3">
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
              <label
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-900/20 transition-all sm:w-auto",
                  isImportingBook
                    ? "cursor-not-allowed bg-emerald-600/70 opacity-80"
                    : "cursor-pointer bg-emerald-600 hover:bg-emerald-700",
                )}
              >
                {isImportingBook ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Tải sách lên
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept=".pdf,.docx,.doc"
                  disabled={isImportingBook}
                />
              </label>
            ) : (
              <div ref={exportMenuRef} className="relative flex w-full items-center justify-end gap-2 sm:w-auto">
                <button
                  onClick={() => setIsExportMenuOpen((prev) => !prev)}
                  disabled={isExporting}
                  className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900"
                >
                  {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {isExporting
                    ? "Đang xuất..."
                    : "Xuất bản dịch"}
                  <ChevronDown
                    size={16}
                    className={cn("transition-transform", isExportMenuOpen && "rotate-180")}
                  />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setIsExportMenuOpen((prev) => !prev)}
                    disabled={isExporting}
                    className="hidden items-center justify-center rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900"
                    aria-label="Chọn phạm vi trang để xuất file"
                  >
                    <ChevronDown
                      size={16}
                      className={cn("transition-transform", isExportMenuOpen && "rotate-180")}
                    />
                  </button>

                  {isExportMenuOpen && book && (
                    <>
                      <button
                        type="button"
                        aria-label="Đóng menu xuất file"
                        className="fixed inset-0 z-[55] bg-black/40 md:hidden"
                        onClick={() => setIsExportMenuOpen(false)}
                      />
                      <div className="fixed inset-x-3 bottom-3 z-[60] max-h-[80vh] overflow-y-auto rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-900 md:absolute md:right-0 md:top-full md:bottom-auto md:inset-x-auto md:mt-[10px] md:w-[min(calc(100vw-2rem),24rem)] md:max-h-[70vh]">
                        <div className="mb-4 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                          <p className="font-medium">
                            {exportFileFormat === "docx" ? "Xuất DOCX bản dịch" : "Xuất PDF bản dịch"}
                          </p>
                          <p className="mt-1 text-xs opacity-60">
                            Chỉ xuất nội dung tiếng Việt đã dịch.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
                            <p className="mb-2 font-medium">Định dạng</p>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                                <input
                                  type="radio"
                                  name="export-file-format"
                                  checked={exportFileFormat === "pdf"}
                                  onChange={() => setExportFileFormat("pdf")}
                                  className="h-4 w-4 border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                                />
                                <span>PDF</span>
                              </label>
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                                <input
                                  type="radio"
                                  name="export-file-format"
                                  checked={exportFileFormat === "docx"}
                                  onChange={() => setExportFileFormat("docx")}
                                  className="h-4 w-4 border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                                />
                                <span>DOCX</span>
                              </label>
                            </div>
                          </div>

                          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
                            <input
                              type="radio"
                              name="export-page-range"
                              checked={exportPageRangeMode === "all"}
                              onChange={() => setExportPageRangeMode("all")}
                              className="mt-0.5 h-4 w-4 border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                            />
                            <span>
                              <span className="block font-medium">Tất cả trang</span>
                              <span className="mt-1 block text-xs opacity-60">
                                Xuất toàn bộ sách ({`1-${book.totalPages}`}).
                              </span>
                            </span>
                          </label>

                          <label className="block rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
                            <div className="flex cursor-pointer items-start gap-3">
                              <input
                                type="radio"
                                name="export-page-range"
                                checked={exportPageRangeMode === "custom"}
                                onChange={() => setExportPageRangeMode("custom")}
                                className="mt-0.5 h-4 w-4 border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                              />
                              <span>
                                <span className="block font-medium">Khoảng trang</span>
                                <span className="mt-1 block text-xs opacity-60">
                                  Nhập số trang bắt đầu và kết thúc bạn muốn xuất.
                                </span>
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <label className="block">
                                <span className="mb-1 block text-xs font-medium opacity-60">Từ trang</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={book.totalPages}
                                  inputMode="numeric"
                                  value={exportRangeStartInput}
                                  onChange={(event) => setExportRangeStartInput(event.target.value)}
                                  onFocus={() => setExportPageRangeMode("custom")}
                                  className="w-full rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 dark:border-white/10 dark:bg-white/5"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs font-medium opacity-60">Đến trang</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={book.totalPages}
                                  inputMode="numeric"
                                  value={exportRangeEndInput}
                                  onChange={(event) => setExportRangeEndInput(event.target.value)}
                                  onFocus={() => setExportPageRangeMode("custom")}
                                  className="w-full rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 dark:border-white/10 dark:bg-white/5"
                                />
                              </label>
                            </div>
                          </label>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-h-5 text-xs">
                            {exportRangeError ? (
                              <p className="text-red-500">{exportRangeError}</p>
                            ) : (
                              <p className="opacity-60">{exportRangeSummary}</p>
                            )}
                          </div>
                          <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-row">
                            <button
                              type="button"
                              onClick={() => setIsExportMenuOpen(false)}
                              className="rounded-xl border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 md:hidden dark:border-white/10 dark:hover:bg-white/5"
                            >
                              Hủy
                            </button>
                            <button
                              onClick={() => void handleExportSubmit()}
                              disabled={Boolean(exportRangeError) || isExporting}
                              className="w-full shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                              {exportFileFormat === "docx" ? "Tải DOCX" : "Tải PDF"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={exitReader}
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
        </div>

        {book && isReaderOpen && (
          <div className="hidden w-full items-center justify-between gap-3 border-t border-black/10 pt-3 dark:border-white/10 md:flex">
            <div className="flex items-center rounded-xl bg-black/5 p-1 dark:bg-white/5">
              <button
                onClick={goToPreviousPage}
                disabled={!canGoToPreviousPage}
                className="rounded-lg p-2 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="px-4 text-sm font-medium">
                Trang {currentPageIdx + 1} / {book.totalPages}
              </div>
              <button
                onClick={goToNextPage}
                disabled={!canGoToNextPage}
                className="rounded-lg p-2 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
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
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900"
              >
                <Settings size={16} />
                {isSettingsOpen ? "Ẩn cài đặt" : "Hiển thị cài đặt"}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex flex-1 overflow-hidden md:overflow-visible">
        {!book || !isReaderOpen ? (
          <BookTranslationLanding
            draftSessions={draftSessions}
            isImportingBook={isImportingBook}
            importingFileName={importingFileName}
            uploadNotice={uploadNotice}
            onFileUpload={handleFileUpload}
            onUseSampleData={openSampleBook}
            onOpenDraftSession={openDraftSession}
            onRemoveDraftSession={removeDraftSession}
          />
        ) : (
          <>
            <aside className="hidden border-r border-black/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/50 md:sticky md:top-24 md:flex md:h-[calc(100vh-6rem)] md:w-72 md:self-start md:shrink-0 md:flex-col">
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
                <label className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isOriginalHidden}
                    onChange={(e) => setIsOriginalHidden(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                  />
                  Ẩn bản gốc
                </label>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {filteredPages.length ? (
                  desktopPaginatedPages.map((page) => {
                    const idx = book.pages.findIndex((item) => item.id === page.id);

                    return (
                      <button
                        key={page.id}
                        ref={(node) => {
                          desktopPageButtonRefs.current[idx] = node;
                        }}
                        onClick={() => {
                          setCurrentPageIdx(idx);
                          setIsMobilePagesOpen(false);
                        }}
                        className={cn(
                          "group flex w-full items-center justify-between rounded-xl border border-transparent p-3 text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                          currentPageIdx === idx
                            ? "border-black/15 bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
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

              <div className="mt-auto shrink-0">
                {filteredPages.length > DESKTOP_PAGE_LIST_SIZE && (
                  <div className="border-t border-black/10 px-4 py-3 dark:border-white/10">
                    <div className="mb-2 text-[11px] opacity-60">
                      {desktopPageListStart + 1}-
                      {Math.min(
                        desktopPageListStart + DESKTOP_PAGE_LIST_SIZE,
                        filteredPages.length,
                      )}{" "}
                      / {filteredPages.length} trang
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setDesktopPageListPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentDesktopPageListPage === 1}
                        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        Trang trước
                      </button>
                      <div className="text-xs font-medium opacity-70">
                        {currentDesktopPageListPage} / {desktopPageListPageCount}
                      </div>
                      <button
                        onClick={() =>
                          setDesktopPageListPage((prev) =>
                            Math.min(desktopPageListPageCount, prev + 1),
                          )
                        }
                        disabled={currentDesktopPageListPage === desktopPageListPageCount}
                        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        Trang sau
                      </button>
                    </div>
                  </div>
                )}

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
              </div>
            </aside>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-white/30 px-3 py-2 dark:border-white/10 dark:bg-zinc-900/30 md:hidden">
                <div className="flex items-center gap-2 md:gap-4">
                  <button
                    onClick={() => setIsMobilePagesOpen(true)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900"
                  >
                    Trang
                  </button>
                  <button
                    onClick={() => setIsMobileSettingsOpen(true)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900"
                  >
                    Cài đặt
                  </button>
                  <div className="flex items-center rounded-lg bg-black/5 p-1 dark:bg-white/5">
                    <button
                      onClick={goToPreviousPage}
                      className="rounded-md p-1.5 transition-all hover:bg-white dark:hover:bg-zinc-800"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="px-3 text-sm font-medium">
                      Trang {currentPageIdx + 1} / {book.totalPages}
                    </div>
                    <button
                      onClick={goToNextPage}
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
                {!isOriginalHidden && (
                  <OriginalTextSelectionPane
                    bookId={book.id}
                    bookName={book.name}
                    pageId={currentPage?.id ?? currentPageIdx + 1}
                    originalText={originalText}
                    currentTranslation={currentPage?.translatedText}
                    glossary={settings.glossary}
                    targetLanguage={settings.targetLang}
                    instructions={settings.instructions}
                    readingFontStyle={readingFontStyle}
                    onAppendGlossaryEntry={appendGlossaryEntry}
                    onApplyTranslation={applySelectionTranslationToPage}
                  />
                )}

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
                  <div
                    className="relative flex flex-1 flex-col overflow-hidden p-4 text-base leading-relaxed md:p-8 md:text-lg"
                    style={readingFontStyle}
                  >
                    {currentPage?.status === "translating" && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-zinc-900/80">
                        <Loader2 size={32} className="mb-4 animate-spin text-emerald-500" />
                        <p className="animate-pulse text-sm font-medium">
                          Đang gửi nội dung sang translation service...
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
                        <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-white/88 p-4 pt-6 backdrop-blur-sm dark:bg-zinc-900/88 md:p-6 md:pt-8">
                          <div className="mt-2 w-full max-w-md rounded-2xl border border-amber-500/20 bg-amber-50 p-5 text-center shadow-sm dark:bg-amber-500/10">
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

                    {!hasTranslatedContent && currentPage?.status === "idle" && (
                      <button
                        type="button"
                        onClick={() => translatedTextareaRef.current?.focus()}
                        className="mb-3 rounded-2xl border border-black/10 bg-black/[0.03] p-3 text-left transition hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                      >
                        <div className="text-sm font-medium not-italic opacity-70">
                          Chưa có bản dịch cho trang này.
                        </div>
                        <div className="mt-1 text-xs opacity-60">
                          Bấm vào vùng bên dưới để dịch tay hoặc chỉnh sửa trực tiếp.
                        </div>
                      </button>
                    )}

                    {currentPage && (
                      <textarea
                        ref={translatedTextareaRef}
                        className="min-h-0 flex-1 resize-none overflow-y-auto bg-transparent outline-none focus:ring-0"
                        value={currentPage.translatedText}
                        placeholder="Nhập bản dịch thủ công tại đây..."
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
                {currentPage && (
                  <TranslatedTextSelectionPopup
                    bookId={book.id}
                    pageId={currentPage.id}
                    translatedText={currentPage.translatedText}
                    textareaRef={translatedTextareaRef}
                  />
                )}
              </div>
            </div>

            {isSettingsOpen && (
              <aside className="hidden overflow-y-auto border-l border-black/10 bg-white/50 p-6 dark:border-white/10 dark:bg-zinc-900/50 lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-6rem)] lg:w-80 lg:self-start">
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
                    <label className="mb-2 block text-xs font-bold opacity-60">Văn phong dịch</label>
                    <select
                      className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                      value={settings.promptPreset}
                      onChange={(e) => {
                        const promptPreset = e.target.value as PromptPreset;
                        setSettings({
                          ...settings,
                          promptPreset,
                          style: resolveStyleFromPromptPreset(promptPreset, settings.style),
                        });
                      }}
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
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold opacity-60">
                      <span>Bảng thuật ngữ</span>
                      <GlossaryInfoTooltip />
                    </div>
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
                        Bản dịch hiện được gửi qua translation service. Nếu dịch vụ dịch chưa chạy
                        hoặc provider upstream không sẵn sàng, trang sẽ báo lỗi ở bước dịch.
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
                    <label className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={isOriginalHidden}
                        onChange={(e) => setIsOriginalHidden(e.target.checked)}
                        className="h-4 w-4 rounded border-black/20 text-emerald-600 focus:ring-emerald-500 dark:border-white/20"
                      />
                      Ẩn bản gốc
                    </label>
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
                      <label className="mb-2 block text-xs font-bold opacity-60">Văn phong dịch</label>
                      <select
                        className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none dark:border-white/10 dark:bg-white/5"
                        value={settings.promptPreset}
                        onChange={(e) => {
                          const promptPreset = e.target.value as PromptPreset;
                          setSettings({
                            ...settings,
                            promptPreset,
                            style: resolveStyleFromPromptPreset(promptPreset, settings.style),
                          });
                        }}
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
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold opacity-60">
                        <span>Bảng thuật ngữ</span>
                        <GlossaryInfoTooltip />
                      </div>
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
