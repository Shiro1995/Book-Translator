import { type ChangeEvent } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import { type DraftSession } from "../draftSessions";

interface BookTranslationLandingProps {
  draftSessions: DraftSession[];
  isImportingBook: boolean;
  importingFileName: string | null;
  uploadNotice: string | null;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onUseSampleData: () => void;
  onOpenDraftSession: (session: DraftSession) => void;
  onRemoveDraftSession: (bookId: string) => void;
}

export function BookTranslationLanding({
  draftSessions,
  isImportingBook,
  importingFileName,
  uploadNotice,
  onFileUpload,
  onUseSampleData,
  onOpenDraftSession,
  onRemoveDraftSession,
}: BookTranslationLandingProps) {
  const hasDraftSession = draftSessions.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center md:p-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-xl"
        aria-busy={isImportingBook}
      >
        {isImportingBook && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[2rem] bg-[#F5F5F0]/88 px-6 text-center backdrop-blur-sm dark:bg-[#0A0A0A]/88">
            <Loader2 size={34} className="mb-4 animate-spin text-emerald-500" />
            <p className="text-base font-semibold">Đang nạp tài liệu</p>
            <p className="mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-300">
              {importingFileName
                ? `Đang xử lý "${importingFileName}". PDF nhiều trang có thể mất vài giây.`
                : "Hệ thống đang đọc file. PDF nhiều trang có thể mất vài giây."}
            </p>
          </div>
        )}

        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
          <FileText size={40} />
        </div>
        <h2 className="serif mb-4 text-3xl font-light italic md:text-4xl">
          Dịch sách để đọc và chỉnh sửa từng trang
        </h2>
        <p className="mb-8 leading-relaxed text-zinc-500 dark:text-zinc-400">
          Hỗ trợ PDF và DOCX. Văn bản được tách thành từng trang để xử lý bản dịch, sau đó trả
          về giao diện để bạn xem và sửa.
        </p>
        <label
          className={`inline-flex w-full items-center justify-center gap-3 rounded-2xl px-8 py-4 font-medium text-white shadow-2xl transition-transform sm:w-auto dark:text-black ${
            isImportingBook
              ? "cursor-not-allowed bg-[#141414]/70 opacity-80 dark:bg-[#E4E3E0]/70"
              : "cursor-pointer bg-[#141414] hover:scale-[1.02] sm:hover:scale-105 dark:bg-[#E4E3E0]"
          }`}
        >
          {isImportingBook ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
          {isImportingBook ? "Đang nạp tài liệu..." : "Chọn tài liệu để bắt đầu"}
          <input
            type="file"
            className="hidden"
            onChange={onFileUpload}
            accept=".pdf,.docx,.doc"
            disabled={isImportingBook}
          />
        </label>

        <button
          onClick={onUseSampleData}
          disabled={isImportingBook}
          className="mt-4 ml-4 text-sm text-zinc-500 underline hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                        onClick={() => onRemoveDraftSession(session.book.id)}
                        disabled={isImportingBook}
                        className="rounded-lg p-1 text-zinc-500 hover:bg-black/5 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
                        aria-label={`Xóa session ${session.book.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <button
                      onClick={() => onOpenDraftSession(session)}
                      disabled={isImportingBook}
                      className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
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
            Auto Flow
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
  );
}
