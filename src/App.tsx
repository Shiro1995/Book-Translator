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
} from "lucide-react";
import { motion } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { type Book, type TranslationSettings } from "./types";
import { parseDOCX, parsePDF } from "./services/fileService";
import { translationService } from "./services/translationService";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DRAFT_BOOK_STORAGE_KEY = "book-translator:draft-book";
const DRAFT_UI_STORAGE_KEY = "book-translator:draft-ui";

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [autoStartPage, setAutoStartPage] = useState(1);
  const [settings, setSettings] = useState<TranslationSettings>({
    model: "gemini-3-flash-preview",
    sourceLang: "English",
    targetLang: "Vietnamese",
    style: "natural",
    glossary: "",
    instructions: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const bookRef = useRef<Book | null>(book);
  const settingsRef = useRef(settings);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    settingsRef.current = settings;
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
      const savedBook = localStorage.getItem(DRAFT_BOOK_STORAGE_KEY);
      if (savedBook) {
        setBook(JSON.parse(savedBook) as Book);
      }

      const savedUi = localStorage.getItem(DRAFT_UI_STORAGE_KEY);
      if (savedUi) {
        const parsed = JSON.parse(savedUi) as { currentPageIdx?: number };
        if (typeof parsed.currentPageIdx === "number" && parsed.currentPageIdx >= 0) {
          setCurrentPageIdx(parsed.currentPageIdx);
        }
      }
    } catch (error) {
      console.error("Failed to restore draft state", error);
    }
  }, []);

  useEffect(() => {
    if (!book) {
      localStorage.removeItem(DRAFT_BOOK_STORAGE_KEY);
      return;
    }

    localStorage.setItem(DRAFT_BOOK_STORAGE_KEY, JSON.stringify(book));
  }, [book]);

  useEffect(() => {
    localStorage.setItem(
      DRAFT_UI_STORAGE_KEY,
      JSON.stringify({
        currentPageIdx,
      }),
    );
  }, [currentPageIdx]);

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

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
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
        return;
      }

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
    }
  };

  const translatePage = async (idx: number) => {
    const currentBook = bookRef.current;
    if (!currentBook) {
      return;
    }

    const page = currentBook.pages[idx];
    if (!page) {
      return;
    }
    if (page.status === "completed" && !confirm("Trang này đã dịch rồi. Dịch lại?")) {
      return;
    }

    setBook((prev) => {
      if (!prev?.pages[idx]) {
        return prev;
      }

      const newPages = [...prev.pages];
      newPages[idx] = { ...newPages[idx], status: "translating", error: undefined };
      return { ...prev, pages: newPages };
    });

    try {
      const result = await translationService.translatePage(page.originalText, settingsRef.current);
      setBook((prev) => {
        if (!prev?.pages[idx]) {
          return prev;
        }

        const newPages = [...prev.pages];
        newPages[idx] = {
          ...newPages[idx],
          translatedText: result,
          status: "completed",
          error: undefined,
          versionHistory: [result, ...newPages[idx].versionHistory],
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

    const run = async () => {
      if (!isAutoTranslating || !bookRef.current || !isReaderOpen) {
        return;
      }

      const totalPages = bookRef.current?.pages.length ?? 0;
      const startIdx = Math.max(0, Math.min(autoStartPage - 1, Math.max(0, totalPages - 1)));

      for (let i = startIdx; i < totalPages; i += 1) {
        if (!active || !isAutoTranslating) {
          break;
        }

        const currentBook = bookRef.current;
        if (!currentBook?.pages[i]) {
          continue;
        }

        const currentPage = currentBook.pages[i];
        const alreadyTranslated =
          currentPage.status === "completed" || currentPage.translatedText.trim().length > 0;
        if (alreadyTranslated) {
          continue;
        }

        try {
          await translatePage(i);
        } catch (error) {
          console.error(`Error at page ${i + 1}`, error);
        }
      }

      setIsAutoTranslating(false);
    };

    void run();

    return () => {
      active = false;
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
    if (!needle) {
      return true;
    }

    return (
      `${idx + 1}`.includes(needle) ||
      page.originalText.toLowerCase().includes(needle) ||
      page.translatedText.toLowerCase().includes(needle)
    );
  });

  const hasDraftSession = Boolean(book);

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] transition-colors duration-300 dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-black/10 bg-inherit px-6 backdrop-blur-md dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white">
            L
          </div>
          <h1 className="serif text-xl font-semibold italic tracking-tight">Book Translator</h1>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="rounded-full p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {!book || !isReaderOpen ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-900/20 transition-all hover:bg-emerald-700">
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
            <div className="flex items-center gap-2">
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
                Đóng
              </button>
            </div>
          )}
          {hasDraftSession && !isReaderOpen && (
            <button
              onClick={() => setIsReaderOpen(true)}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900"
            >
              Quay lại bản đang dịch
            </button>
          )}
        </div>
      </header>

      <main className="flex h-[calc(100vh-64px)] overflow-hidden">
        {!book || !isReaderOpen ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl"
            >
              <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
                <FileText size={40} />
              </div>
              <h2 className="serif mb-4 text-4xl font-light italic">
                Dịch sách để đọc và chỉnh sửa từng trang
              </h2>
              <p className="mb-8 leading-relaxed text-zinc-500 dark:text-zinc-400">
                Hỗ trợ PDF và DOCX. Văn bản được tách thành từng trang, gửi sang n8n
                webhook để xử lý bản dịch, sau đó trả về giao diện để bạn xem và sửa.
              </p>
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-2xl bg-[#141414] px-8 py-4 font-medium text-white shadow-2xl transition-transform hover:scale-105 dark:bg-[#E4E3E0] dark:text-black">
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
                className="mt-4 text-sm text-zinc-500 underline hover:text-emerald-500"
              >
                Dùng dữ liệu mẫu để thử nghiệm
              </button>

              {hasDraftSession && (
                <div className="mt-6 rounded-2xl border border-black/10 bg-black/5 p-4 text-left dark:border-white/10 dark:bg-white/5">
                  <p className="text-sm font-semibold">Phiên dịch đang lưu</p>
                  <p className="mt-1 text-xs opacity-70">{book?.name}</p>
                  <button
                    onClick={() => setIsReaderOpen(true)}
                    className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                  >
                    Quay lại màn dịch
                  </button>
                </div>
              )}

              <div className="mt-12 grid grid-cols-3 gap-6 text-sm opacity-60">
                <div>
                  <div className="mb-1 font-bold">Webhook</div>
                  n8n workflow
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
            <aside className="flex w-72 flex-col border-r border-black/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/50">
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
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {filteredPages?.map((page) => {
                  const idx = book.pages.findIndex((item) => item.id === page.id);

                  return (
                    <button
                      key={page.id}
                      onClick={() => setCurrentPageIdx(idx)}
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
                      {page.status === "completed" && (
                        <CheckCircle2
                          size={14}
                          className={currentPageIdx === idx ? "text-white" : "text-emerald-500"}
                        />
                      )}
                      {page.status === "translating" && (
                        <Loader2 size={14} className="animate-spin" />
                      )}
                      {page.status === "error" && (
                        <AlertCircle size={14} className="text-red-500" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>Tiến độ dịch</span>
                  <span>
                    {book.pages.filter((page) => page.status === "completed").length} /{" "}
                    {book.totalPages} trang
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{
                      width: `${(book.pages.filter((page) => page.status === "completed").length /
                        book.totalPages) *
                        100
                        }%`,
                    }}
                  />
                </div>
              </div>
            </aside>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-14 items-center justify-between border-b border-black/10 bg-white/30 px-6 dark:border-white/10 dark:bg-zinc-900/30">
                <div className="flex items-center gap-4">
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

                <div className="flex items-center gap-2">
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
                    {isSettingsOpen ? "Ẩn setting" : "Hiện setting"}
                  </button>
                </div>
              </div>

              <div className="flex flex-1 gap-6 overflow-hidden p-6">
                <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/5 dark:bg-zinc-900">
                  <div className="border-b border-black/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest opacity-50 dark:border-white/5">
                    Bản gốc ({settings.sourceLang})
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 font-serif text-lg leading-relaxed">
                    {currentPage?.originalText}
                  </div>
                </div>

                <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/5 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-black/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest opacity-50 dark:border-white/5">
                    <span>Bản dịch ({settings.targetLang})</span>
                    {currentPage?.status === "completed" && (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 size={10} />
                        Đã dịch
                      </span>
                    )}
                  </div>
                  <div className="relative flex-1 overflow-y-auto p-8 font-serif text-lg leading-relaxed">
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

                    {!currentPage?.translatedText && currentPage?.status === "idle" && (
                      <div className="flex h-full flex-col items-center justify-center italic opacity-20">
                        <Edit3 size={48} className="mb-4" />
                        Chưa có bản dịch cho trang này
                      </div>
                    )}

                    {currentPage?.translatedText && (
                      <textarea
                        className="h-full w-full resize-none bg-transparent outline-none focus:ring-0"
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
              <aside className="w-80 overflow-y-auto border-l border-black/10 bg-white/50 p-6 dark:border-white/10 dark:bg-zinc-900/50">
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
                        Bản dịch hiện được gửi qua n8n webhook. Nếu workflow chưa active hoặc
                        test webhook chưa được Execute, trang sẽ báo lỗi ở bước dịch.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </>
        )}
      </main>
    </div>
  );
}
