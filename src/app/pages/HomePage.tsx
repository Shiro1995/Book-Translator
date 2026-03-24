import { type ChangeEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

  const navigateToBookTranslation = () => {
    navigate(routePaths.bookTranslation);
  };

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
    <main className="flex min-h-screen bg-[#F5F5F0] text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0]">
      <BookTranslationLanding
        draftSessions={draftSessions}
        uploadNotice={null}
        onFileUpload={handleFileUpload}
        onUseSampleData={handleUseSampleData}
        onOpenDraftSession={handleOpenDraftSession}
        onRemoveDraftSession={handleRemoveDraftSession}
      />
    </main>
  );
}
