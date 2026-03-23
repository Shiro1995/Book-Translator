import React, { useState, useEffect, useCallback } from 'react';
import { 
  Upload, FileText, Settings, Play, Pause, Square, 
  ChevronLeft, ChevronRight, Download, Edit3, RotateCcw,
  CheckCircle2, Loader2, AlertCircle, Sun, Moon, Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Book, Page, TranslationSettings } from './types';
import { parsePDF, parseDOCX } from './services/fileService';
import { translationService } from './services/translationService';
import jsPDF from 'jspdf';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [settings, setSettings] = useState<TranslationSettings>({
    sourceLang: 'English',
    targetLang: 'Vietnamese',
    style: 'natural',
    glossary: '',
    instructions: ''
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Dark mode toggle
  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let result;
      if (file.name.endsWith('.pdf')) {
        result = await parsePDF(file);
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        result = await parseDOCX(file);
      } else {
        alert("Unsupported file format");
        return;
      }

      setBook({
        id: Math.random().toString(36).substr(2, 9),
        name: result.name,
        size: result.size,
        totalPages: result.pages.length,
        pages: result.pages.map((p: any) => ({ ...p, versionHistory: [] })),
        ...settings
      });
      setCurrentPageIdx(0);
    } catch (err) {
      console.error(err);
      alert("Error parsing file");
    }
  };

  const translatePage = async (idx: number) => {
    if (!book) return;
    
    const page = book.pages[idx];
    if (page.status === 'completed' && !confirm("Page already translated. Redo?")) return;

    const newPages = [...book.pages];
    newPages[idx] = { ...page, status: 'translating', error: undefined };
    setBook({ ...book, pages: newPages });

    try {
      const result = await translationService.translatePage(page.originalText, settings);
      newPages[idx] = { 
        ...newPages[idx], 
        translatedText: result, 
        status: 'completed',
        versionHistory: [result, ...newPages[idx].versionHistory]
      };
      setBook({ ...book, pages: newPages });
    } catch (err) {
      newPages[idx] = { ...newPages[idx], status: 'error', error: "Translation failed" };
      setBook({ ...book, pages: newPages });
      throw err;
    }
  };

  // Auto translation loop
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!isAutoTranslating || !book) return;
      
      for (let i = 0; i < book.pages.length; i++) {
        if (!active || !isAutoTranslating) break;
        if (book.pages[i].status === 'completed') continue;
        
        try {
          await translatePage(i);
        } catch (e) {
          console.error(`Error at page ${i + 1}`, e);
          // Continue to next page or stop? Let's continue but stop if too many errors
        }
      }
      setIsAutoTranslating(false);
    };
    run();
    return () => { active = false; };
  }, [isAutoTranslating]);

  const exportPDF = (mode: 'translated' | 'bilingual') => {
    if (!book) return;
    const doc = new jsPDF();
    let y = 20;

    // Cover Page
    doc.setFontSize(24);
    doc.text("BẢN DỊCH TÀI LIỆU", 105, 60, { align: 'center' });
    doc.setFontSize(16);
    doc.text(book.name, 105, 80, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Ngôn ngữ: ${settings.sourceLang} -> ${settings.targetLang}`, 105, 100, { align: 'center' });
    doc.text(`Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}`, 105, 110, { align: 'center' });
    
    book.pages.forEach((page, i) => {
      doc.addPage();
      doc.setFontSize(10);
      doc.text(`Trang ${i + 1}`, 105, 10, { align: 'center' });
      
      if (mode === 'bilingual') {
        doc.setFontSize(12);
        doc.text("Original:", 10, 20);
        const origLines = doc.splitTextToSize(page.originalText, 180);
        doc.text(origLines, 10, 30);
        
        doc.addPage();
        doc.text("Translation:", 10, 20);
        const transLines = doc.splitTextToSize(page.translatedText || "(Chưa dịch)", 180);
        doc.text(transLines, 10, 30);
      } else {
        const transLines = doc.splitTextToSize(page.translatedText || "(Chưa dịch)", 180);
        doc.text(transLines, 10, 20);
      }
    });

    doc.save(`${book.name}_translated.pdf`);
  };

  const currentPage = book?.pages[currentPageIdx];

  return (
    <div className="min-h-screen bg-[#F5F5F0] dark:bg-[#0A0A0A] text-[#141414] dark:text-[#E4E3E0] font-sans transition-colors duration-300">
      {/* Header */}
      <header className="h-16 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-6 sticky top-0 bg-inherit z-50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold">L</div>
          <h1 className="text-xl font-semibold tracking-tight italic serif">LinhDịch</h1>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          {!book ? (
            <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium cursor-pointer transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/20">
              <Upload size={16} />
              Tải sách lên
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc" />
            </label>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => exportPDF('translated')}
                className="bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 hover:bg-black/5"
              >
                <Download size={16} /> Xuất PDF
              </button>
              <button 
                onClick={() => setBook(null)}
                className="text-sm text-red-500 hover:underline px-2"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex h-[calc(100vh-64px)] overflow-hidden">
        {!book ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl"
            >
              <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <FileText size={40} />
              </div>
              <h2 className="text-4xl font-light mb-4 serif italic">Dịch sách chưa bao giờ dễ dàng đến thế</h2>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8 leading-relaxed">
                Hỗ trợ PDF, DOCX. Tự động chia trang, dịch song ngữ bằng trí tuệ nhân tạo Gemini, 
                giữ nguyên văn phong và thuật ngữ chuyên ngành.
              </p>
              <label className="inline-flex items-center gap-3 bg-[#141414] dark:bg-[#E4E3E0] text-white dark:text-black px-8 py-4 rounded-2xl font-medium cursor-pointer hover:scale-105 transition-transform shadow-2xl">
                <Upload size={20} />
                Chọn tài liệu để bắt đầu
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc" />
              </label>
              
              <button 
                onClick={() => {
                  setBook({
                    id: 'mock',
                    name: 'Sách mẫu - Đắc Nhân Tâm.pdf',
                    size: 1024 * 1024,
                    totalPages: 3,
                    pages: [
                      { id: 1, originalText: "Chapter 1: Fundamental Techniques in Handling People. If you want to gather honey, don't kick over the beehive.", translatedText: "", status: 'idle', versionHistory: [] },
                      { id: 2, originalText: "Chapter 2: Six Ways to Make People Like You. Become genuinely interested in other people.", translatedText: "", status: 'idle', versionHistory: [] },
                      { id: 3, originalText: "Chapter 3: How to Win People to Your Way of Thinking. The only way to get the best of an argument is to avoid it.", translatedText: "", status: 'idle', versionHistory: [] },
                    ],
                    ...settings
                  });
                }}
                className="mt-4 text-sm text-zinc-500 hover:text-emerald-500 underline"
              >
                Sử dụng dữ liệu mẫu để thử nghiệm
              </button>
              <div className="mt-12 grid grid-cols-3 gap-6 text-sm opacity-60">
                <div>
                  <div className="font-bold mb-1">AI Powered</div>
                  Gemini 3.1 Pro
                </div>
                <div>
                  <div className="font-bold mb-1">Bilingual</div>
                  Xem song song
                </div>
                <div>
                  <div className="font-bold mb-1">Export</div>
                  PDF chất lượng cao
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <>
            {/* Sidebar */}
            <aside className="w-72 border-r border-black/10 dark:border-white/10 flex flex-col bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
              <div className="p-4 border-b border-black/10 dark:border-white/10">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="Tìm trang..." 
                    className="w-full pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm outline-none focus:ring-1 ring-emerald-500"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {book.pages.map((p, idx) => (
                  <button
                    key={p.id}
                    onClick={() => setCurrentPageIdx(idx)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-xl text-sm transition-all group",
                      currentPageIdx === idx 
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20" 
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="opacity-50 font-mono text-[10px]">{idx + 1}</span>
                      <span className="truncate max-w-[140px]">{p.originalText.substring(0, 20)}...</span>
                    </div>
                    {p.status === 'completed' && <CheckCircle2 size={14} className={currentPageIdx === idx ? "text-white" : "text-emerald-500"} />}
                    {p.status === 'translating' && <Loader2 size={14} className="animate-spin" />}
                    {p.status === 'error' && <AlertCircle size={14} className="text-red-500" />}
                  </button>
                ))}
              </div>

              <div className="p-4 border-t border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span>Tiến độ dịch</span>
                  <span>{book.pages.filter(p => p.status === 'completed').length} / {book.totalPages} trang</span>
                </div>
                <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-500" 
                    style={{ width: `${(book.pages.filter(p => p.status === 'completed').length / book.totalPages) * 100}%` }}
                  />
                </div>
              </div>
            </aside>

            {/* Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="h-14 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-6 bg-white/30 dark:bg-zinc-900/30">
                <div className="flex items-center gap-4">
                  <div className="flex items-center bg-black/5 dark:bg-white/5 rounded-lg p-1">
                    <button 
                      onClick={() => setCurrentPageIdx(Math.max(0, currentPageIdx - 1))}
                      className="p-1.5 hover:bg-white dark:hover:bg-zinc-800 rounded-md transition-all"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="px-3 text-sm font-medium">
                      Trang {currentPageIdx + 1} / {book.totalPages}
                    </div>
                    <button 
                      onClick={() => setCurrentPageIdx(Math.min(book.totalPages - 1, currentPageIdx + 1))}
                      className="p-1.5 hover:bg-white dark:hover:bg-zinc-800 rounded-md transition-all"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isAutoTranslating ? (
                    <button 
                      onClick={() => setIsAutoTranslating(false)}
                      className="flex items-center gap-2 bg-amber-500/10 text-amber-600 px-4 py-2 rounded-full text-sm font-medium hover:bg-amber-500/20"
                    >
                      <Pause size={16} /> Tạm dừng dịch
                    </button>
                  ) : (
                    <button 
                      onClick={() => setIsAutoTranslating(true)}
                      className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 px-4 py-2 rounded-full text-sm font-medium hover:bg-emerald-500/20"
                    >
                      <Play size={16} /> Dịch tự động
                    </button>
                  )}
                  <button 
                    onClick={() => translatePage(currentPageIdx)}
                    disabled={currentPage?.status === 'translating'}
                    className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-black px-4 py-2 rounded-full text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {currentPage?.status === 'translating' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    Dịch trang này
                  </button>
                </div>
              </div>

              {/* Dual Pane Reader */}
              <div className="flex-1 flex overflow-hidden p-6 gap-6">
                {/* Original */}
                <div className="flex-1 flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-black/5 dark:border-white/5 overflow-hidden">
                  <div className="px-4 py-2 border-b border-black/5 dark:border-white/5 text-[10px] uppercase tracking-widest opacity-50 font-semibold">
                    Bản gốc ({settings.sourceLang})
                  </div>
                  <div className="flex-1 p-8 overflow-y-auto leading-relaxed text-lg font-serif">
                    {currentPage?.originalText}
                  </div>
                </div>

                {/* Translated */}
                <div className="flex-1 flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-black/5 dark:border-white/5 overflow-hidden relative">
                  <div className="px-4 py-2 border-b border-black/5 dark:border-white/5 text-[10px] uppercase tracking-widest opacity-50 font-semibold flex justify-between items-center">
                    <span>Bản dịch ({settings.targetLang})</span>
                    {currentPage?.status === 'completed' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> Đã dịch</span>}
                  </div>
                  <div className="flex-1 p-8 overflow-y-auto leading-relaxed text-lg font-serif relative">
                    {currentPage?.status === 'translating' && (
                      <div className="absolute inset-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                        <Loader2 size={32} className="animate-spin text-emerald-500 mb-4" />
                        <p className="text-sm font-medium animate-pulse">Đang dịch bằng Gemini AI...</p>
                      </div>
                    )}
                    
                    {currentPage?.status === 'error' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                        <AlertCircle size={40} className="text-red-500 mb-4" />
                        <h3 className="font-bold text-red-500 mb-2">Lỗi dịch thuật</h3>
                        <p className="text-sm opacity-60 mb-4">{currentPage.error}</p>
                        <button 
                          onClick={() => translatePage(currentPageIdx)}
                          className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm"
                        >
                          Thử lại
                        </button>
                      </div>
                    )}

                    {!currentPage?.translatedText && currentPage?.status === 'idle' && (
                      <div className="h-full flex flex-col items-center justify-center opacity-20 italic">
                        <Edit3 size={48} className="mb-4" />
                        Chưa có bản dịch cho trang này
                      </div>
                    )}

                    {currentPage?.translatedText && (
                      <textarea 
                        className="w-full h-full bg-transparent resize-none outline-none focus:ring-0"
                        value={currentPage.translatedText}
                        onChange={(e) => {
                          const newPages = [...book.pages];
                          newPages[currentPageIdx] = { ...currentPage, translatedText: e.target.value };
                          setBook({ ...book, pages: newPages });
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Sidebar */}
            <aside className="w-80 border-l border-black/10 dark:border-white/10 p-6 overflow-y-auto bg-white/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2 mb-8 opacity-50">
                <Settings size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Cấu hình dịch</h3>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold mb-2 opacity-60">Văn phong</label>
                  <select 
                    className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm outline-none"
                    value={settings.style}
                    onChange={e => setSettings({...settings, style: e.target.value as any})}
                  >
                    <option value="natural">Tự nhiên (Khuyên dùng)</option>
                    <option value="literal">Sát nghĩa</option>
                    <option value="literary">Văn học / Bay bổng</option>
                    <option value="academic">Học thuật / Trang trọng</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 opacity-60">Ngôn ngữ đích</label>
                  <select 
                    className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm outline-none"
                    value={settings.targetLang}
                    onChange={e => setSettings({...settings, targetLang: e.target.value})}
                  >
                    <option value="Vietnamese">Tiếng Việt</option>
                    <option value="English">Tiếng Anh</option>
                    <option value="Japanese">Tiếng Nhật</option>
                    <option value="French">Tiếng Pháp</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 opacity-60">Thuật ngữ / Glossary</label>
                  <textarea 
                    placeholder="Ví dụ: Harry -> Harry, Hogwarts -> Trường Hogwarts..."
                    className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm outline-none h-24 resize-none"
                    value={settings.glossary}
                    onChange={e => setSettings({...settings, glossary: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 opacity-60">Hướng dẫn thêm</label>
                  <textarea 
                    placeholder="Ví dụ: Xưng hô 'tôi - bạn', không dịch tên riêng..."
                    className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm outline-none h-24 resize-none"
                    value={settings.instructions}
                    onChange={e => setSettings({...settings, instructions: e.target.value})}
                  />
                </div>

                <div className="pt-4">
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                    <h4 className="text-xs font-bold text-emerald-600 mb-1">Mẹo nhỏ</h4>
                    <p className="text-[11px] text-emerald-700/70 leading-relaxed">
                      Sử dụng Gemini 3.1 Pro giúp bản dịch có chiều sâu, giữ đúng văn phong và xử lý tốt các thuật ngữ chuyên ngành phức tạp.
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
