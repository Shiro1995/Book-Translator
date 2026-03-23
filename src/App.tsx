import { type ChangeEvent, useEffect, useState } from "react";
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

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [settings, setSettings] = useState<TranslationSettings>({
    sourceLang: "English",
    targetLang: "Vietnamese",
    style: "natural",
    glossary: "",
    instructions: "",
  });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

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
    } catch (error) {
      console.error(error);
      alert("Không thể đọc file");
    }
  };

  const translatePage = async (idx: number) => {
    if (!book) {
      return;
    }

    const page = book.pages[idx];
    if (page.status === "completed" && !confirm("Trang này đã dịch rồi. Dịch lại?")) {
      return;
    }

    const newPages = [...book.pages];
    newPages[idx] = { ...page, status: "translating", error: undefined };
    setBook({ ...book, pages: newPages });

    try {
      const result = await translationService.translatePage(page.originalText, settings);
      newPages[idx] = {
        ...newPages[idx],
        translatedText: result,
        status: "completed",
        versionHistory: [result, ...newPages[idx].versionHistory],
      };
      setBook({ ...book, pages: newPages });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dịch thất bại";
      newPages[idx] = { ...newPages[idx], status: "error", error: message };
      setBook({ ...book, pages: newPages });
      throw error;
    }
  };

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!isAutoTranslating || !book) {
        return;
      }

      for (let i = 0; i < book.pages.length; i += 1) {
        if (!active || !isAutoTranslating) {
          break;
        }
        if (book.pages[i].status === "completed") {
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
  }, [isAutoTranslating]);

  const exportPDF = (mode: "translated" | "bilingual") => {
    if (!book) {
      return;
    }

    const doc = new jsPDF();

    doc.setFontSize(24);
    doc.text("BAN DICH TAI LIEU", 105, 60, { align: "center" });
    doc.setFontSize(16);
    doc.text(book.name, 105, 80, { align: "center" });
    doc.setFontSize(12);
    doc.text(`Ngon ngu: ${settings.sourceLang} -> ${settings.targetLang}`, 105, 100, {
      align: "center",
    });
    doc.text(`Ngay xuat: ${new Date().toLocaleDateString("vi-VN")}`, 105, 110, {
      align: "center",
    });

    book.pages.forEach((page, i) => {
      doc.addPage();
      doc.setFontSize(10);
      doc.text(`Trang ${i + 1}`, 105, 10, { align: "center" });

      if (mode === "bilingual") {
        doc.setFontSize(12);
        doc.text("Original:", 10, 20);
        const originalLines = doc.splitTextToSize(page.originalText, 180);
        doc.text(originalLines, 10, 30);

        doc.addPage();
        doc.text("Translation:", 10, 20);
        const translatedLines = doc.splitTextToSize(page.translatedText || "(Chua dich)", 180);
        doc.text(translatedLines, 10, 30);
      } else {
        const translatedLines = doc.splitTextToSize(page.translatedText || "(Chua dich)", 180);
        doc.text(translatedLines, 10, 20);
      }
    });

    doc.save(`${book.name}_translated.pdf`);
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

          {!book ? (
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
                onClick={() => exportPDF("translated")}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900"
              >
                <Download size={16} />
                Xuất PDF
              </button>
              <button
                onClick={() => setBook(null)}
                className="px-2 text-sm text-red-500 hover:underline"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex h-[calc(100vh-64px)] overflow-hidden">
        {!book ? (
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
                }}
                className="mt-4 text-sm text-zinc-500 underline hover:text-emerald-500"
              >
                Dùng dữ liệu mẫu để thử nghiệm
              </button>

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

            <aside className="w-80 overflow-y-auto border-l border-black/10 bg-white/50 p-6 dark:border-white/10 dark:bg-zinc-900/50">
              <div className="mb-8 flex items-center gap-2 opacity-50">
                <Settings size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Cấu hình dịch</h3>
              </div>

              <div className="space-y-6">
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
          </>
        )}
      </main>
    </div>
  );
}
