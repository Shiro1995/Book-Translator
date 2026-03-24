import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Moon, Sun, Upload } from "lucide-react";
import { routePaths } from "@/app/router/paths";
import { BookTranslationLanding } from "@/modules/book-translation/components/BookTranslationLanding";
import {
  clearLegacyDraftState,
  type DraftSession,
  persistDraftSessions,
  restoreDraftSessions,
} from "@/modules/book-translation/draftSessions";
import {
  setPendingBookUpload,
  setPendingDraftSession,
  setPendingSampleBook,
} from "@/modules/book-translation/pendingUploadStore";

export default function HomePage() {
  const navigate = useNavigate();
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
  );

  useEffect(() => {
    try {
      const restoredSessions = restoreDraftSessions();
      if (restoredSessions.length > 0) {
        persistDraftSessions(restoredSessions);
      }
      clearLegacyDraftState();
      setDraftSessions(restoredSessions);
    } catch (error) {
      console.error("Failed to restore draft sessions on home page", error);
    }
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const navigateToBookTranslation = () => {
    navigate(routePaths.bookTranslation);
  };

  const activeDraftSession = useMemo(() => draftSessions[0] ?? null, [draftSessions]);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setPendingBookUpload(file);
    navigateToBookTranslation();
    event.target.value = "";
  };

  const handleUseSampleData = () => {
    setPendingSampleBook();
    navigateToBookTranslation();
  };

  const handleOpenDraftSession = (session: DraftSession) => {
    setPendingDraftSession(session.book.id);
    navigateToBookTranslation();
  };

  const handleRemoveDraftSession = (bookId: string) => {
    setDraftSessions((prev) => {
      const nextSessions = prev.filter((session) => session.book.id !== bookId);
      persistDraftSessions(nextSessions);
      clearLegacyDraftState();
      return nextSessions;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F0] text-[#141414] transition-colors duration-300 dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[#F5F5F0]/92 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-[#0A0A0A]/92 md:px-6">
        <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white">
              L
            </div>
            <h1 className="serif text-xl font-semibold italic tracking-tight">Book Translator</h1>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-4">
            <button
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="rounded-full p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>

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

            {activeDraftSession && (
              <button
                onClick={() => handleOpenDraftSession(activeDraftSession)}
                className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5 sm:w-auto dark:border-white/10 dark:bg-zinc-900"
              >
                Quay lại bản đang dịch
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 bg-[#F5F5F0] text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
        <BookTranslationLanding
          draftSessions={draftSessions}
          uploadNotice={null}
          onFileUpload={handleFileUpload}
          onUseSampleData={handleUseSampleData}
          onOpenDraftSession={handleOpenDraftSession}
          onRemoveDraftSession={handleRemoveDraftSession}
        />
      </main>
    </div>
  );
}
