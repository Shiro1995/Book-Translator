import { type Book } from "./types";

export const DRAFT_BOOK_STORAGE_KEY = "book-translator:draft-book";
export const DRAFT_UI_STORAGE_KEY = "book-translator:draft-ui";
export const DRAFT_SESSIONS_STORAGE_KEY = "book-translator:draft-sessions";
export const MAX_DRAFT_SESSIONS = 3;

export interface DraftSession {
  book: Book;
  currentPageIdx: number;
  updatedAt: number;
}

export function clampPageIndex(book: Book, pageIdx: number) {
  return Math.min(Math.max(pageIdx, 0), Math.max(book.pages.length - 1, 0));
}

export function upsertDraftSession(
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

export function restoreDraftSessions(): DraftSession[] {
  const savedSessionsRaw = localStorage.getItem(DRAFT_SESSIONS_STORAGE_KEY);
  const savedSessions = savedSessionsRaw ? (JSON.parse(savedSessionsRaw) as DraftSession[]) : [];

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
    return normalizedSessions;
  }

  const savedBook = localStorage.getItem(DRAFT_BOOK_STORAGE_KEY);
  const savedUi = localStorage.getItem(DRAFT_UI_STORAGE_KEY);

  if (!savedBook) {
    return [];
  }

  const parsedBook = JSON.parse(savedBook) as Book;
  const parsedUi = savedUi ? (JSON.parse(savedUi) as { currentPageIdx?: number }) : undefined;

  return upsertDraftSession(
    [],
    {
      ...parsedBook,
      promptPreset: parsedBook.promptPreset ?? "reader",
    },
    typeof parsedUi?.currentPageIdx === "number" ? parsedUi.currentPageIdx : 0,
  );
}

export function persistDraftSessions(sessions: DraftSession[]) {
  localStorage.setItem(DRAFT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

export function clearLegacyDraftState() {
  localStorage.removeItem(DRAFT_BOOK_STORAGE_KEY);
  localStorage.removeItem(DRAFT_UI_STORAGE_KEY);
}
