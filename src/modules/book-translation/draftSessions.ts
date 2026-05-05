import { type Book, type Page } from "./types";
import { normalizeUserFacingText } from "./utils/text";

export const DRAFT_BOOK_STORAGE_KEY = "book-translator:draft-book";
export const DRAFT_UI_STORAGE_KEY = "book-translator:draft-ui";
export const DRAFT_SESSIONS_STORAGE_KEY = "book-translator:draft-sessions";
export const MAX_DRAFT_SESSIONS = 3;

const DRAFT_SESSIONS_DB_NAME = "book-translator";
const DRAFT_SESSIONS_DB_VERSION = 1;
const DRAFT_SESSIONS_STORE_NAME = "draft-session-state";
const DRAFT_SESSIONS_RECORD_KEY = "draft-sessions";
const PAGE_STATUSES = new Set(["idle", "translating", "completed", "error"] as const);
const BOOK_STYLES = new Set(["literal", "natural", "literary", "academic"] as const);

type PersistedDraftSessionsRecord = {
  sessions: DraftSession[];
};

let draftSessionPersistQueue = Promise.resolve();

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

function getLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function parseJsonSafely<T>(rawValue: string | null): T | null {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function normalizePage(page: Partial<Page> | null | undefined, fallbackId: number): Page {
  const nextStatus = page?.status;

  return {
    id: typeof page?.id === "number" ? page.id : fallbackId,
    originalText: normalizeUserFacingText(page?.originalText ?? ""),
    translatedText: normalizeUserFacingText(page?.translatedText ?? ""),
    status: nextStatus && PAGE_STATUSES.has(nextStatus) ? nextStatus : "idle",
    error: typeof page?.error === "string" ? page.error : undefined,
    versionHistory: Array.isArray(page?.versionHistory)
      ? page.versionHistory.map((version) => normalizeUserFacingText(version))
      : [],
  };
}

function normalizeBook(book: Book): Book {
  const normalizedPages = Array.isArray(book.pages)
    ? book.pages.map((page, index) => normalizePage(page, index + 1))
    : [];

  return {
    ...book,
    name: normalizeUserFacingText(book.name),
    totalPages:
      typeof book.totalPages === "number" && Number.isFinite(book.totalPages) && book.totalPages > 0
        ? book.totalPages
        : normalizedPages.length,
    pages: normalizedPages,
    promptPreset: book.promptPreset ?? "reader",
    style: book.style && BOOK_STYLES.has(book.style) ? book.style : "natural",
    glossary: typeof book.glossary === "string" ? book.glossary : "",
    instructions: typeof book.instructions === "string" ? book.instructions : "",
    model: typeof book.model === "string" ? book.model : "gemini-3-flash-preview",
    targetLang: typeof book.targetLang === "string" ? book.targetLang : "Vietnamese",
  };
}

function normalizeDraftSession(
  session: Partial<DraftSession> | null | undefined,
): DraftSession | null {
  if (!session?.book?.id) {
    return null;
  }

  const normalizedBook = normalizeBook(session.book);

  return {
    book: normalizedBook,
    currentPageIdx: clampPageIndex(normalizedBook, session.currentPageIdx ?? 0),
    updatedAt:
      typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
        ? session.updatedAt
        : Date.now(),
  };
}

function normalizeDraftSessions(sessions: DraftSession[]): DraftSession[] {
  return sessions
    .map((session) => normalizeDraftSession(session))
    .filter((session): session is DraftSession => Boolean(session))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFT_SESSIONS);
}

function createLocalStorageFallbackSessions(sessions: DraftSession[]) {
  const trimmedHistorySessions = sessions.map((session) => ({
    ...session,
    book: {
      ...session.book,
      pages: session.book.pages.map((page) => ({
        ...page,
        versionHistory: page.versionHistory.slice(0, 1),
      })),
    },
  }));

  return [
    sessions,
    trimmedHistorySessions,
    trimmedHistorySessions.slice(0, 1),
  ];
}

async function openDraftSessionsDatabase() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  return await new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DRAFT_SESSIONS_DB_NAME, DRAFT_SESSIONS_DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_SESSIONS_STORE_NAME)) {
        request.result.createObjectStore(DRAFT_SESSIONS_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("Failed to open draft sessions database", request.error);
      resolve(null);
    };
    request.onblocked = () => {
      console.warn("Draft sessions database upgrade is blocked");
    };
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function waitForRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function restoreDraftSessionsFromIndexedDb() {
  const database = await openDraftSessionsDatabase();
  if (!database) {
    return null;
  }

  try {
    const transaction = database.transaction(DRAFT_SESSIONS_STORE_NAME, "readonly");
    const request = transaction.objectStore(DRAFT_SESSIONS_STORE_NAME).get(DRAFT_SESSIONS_RECORD_KEY);
    const record = await waitForRequest(request);
    await waitForTransaction(transaction);

    const savedSessions = Array.isArray((record as PersistedDraftSessionsRecord | undefined)?.sessions)
      ? ((record as PersistedDraftSessionsRecord).sessions ?? [])
      : [];

    return normalizeDraftSessions(savedSessions);
  } catch (error) {
    console.warn("Failed to restore draft sessions from IndexedDB", error);
    return null;
  } finally {
    database.close();
  }
}

function restoreDraftSessionsFromLocalStorage() {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }

  const savedSessions = parseJsonSafely<DraftSession[]>(
    storage.getItem(DRAFT_SESSIONS_STORAGE_KEY),
  );
  const normalizedSessions = normalizeDraftSessions(savedSessions ?? []);

  if (normalizedSessions.length > 0) {
    return normalizedSessions;
  }

  const parsedBook = parseJsonSafely<Book>(storage.getItem(DRAFT_BOOK_STORAGE_KEY));
  const parsedUi = parseJsonSafely<{ currentPageIdx?: number }>(
    storage.getItem(DRAFT_UI_STORAGE_KEY),
  );

  if (!parsedBook) {
    return [];
  }

  return upsertDraftSession(
    [],
    normalizeBook(parsedBook),
    typeof parsedUi?.currentPageIdx === "number" ? parsedUi.currentPageIdx : 0,
  );
}

async function persistDraftSessionsToIndexedDb(sessions: DraftSession[]) {
  const database = await openDraftSessionsDatabase();
  if (!database) {
    return false;
  }

  try {
    const transaction = database.transaction(DRAFT_SESSIONS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DRAFT_SESSIONS_STORE_NAME);

    if (sessions.length === 0) {
      store.delete(DRAFT_SESSIONS_RECORD_KEY);
    } else {
      store.put({ sessions }, DRAFT_SESSIONS_RECORD_KEY);
    }

    await waitForTransaction(transaction);
    return true;
  } catch (error) {
    console.warn("Failed to persist draft sessions to IndexedDB", error);
    return false;
  } finally {
    database.close();
  }
}

function persistDraftSessionsToLocalStorage(sessions: DraftSession[]) {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  if (sessions.length === 0) {
    storage.removeItem(DRAFT_SESSIONS_STORAGE_KEY);
    return true;
  }

  for (const candidateSessions of createLocalStorageFallbackSessions(sessions)) {
    try {
      storage.setItem(DRAFT_SESSIONS_STORAGE_KEY, JSON.stringify(candidateSessions));
      return true;
    } catch (error) {
      console.warn("Failed to persist draft sessions to localStorage", error);
    }
  }

  try {
    storage.removeItem(DRAFT_SESSIONS_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear oversized localStorage draft sessions", error);
  }

  return false;
}

function clearLegacyDraftSessionsStorage() {
  const storage = getLocalStorage();
  storage?.removeItem(DRAFT_SESSIONS_STORAGE_KEY);
}

export async function restoreDraftSessions(): Promise<DraftSession[]> {
  const indexedDbSessions = await restoreDraftSessionsFromIndexedDb();
  if (indexedDbSessions && indexedDbSessions.length > 0) {
    return indexedDbSessions;
  }

  return restoreDraftSessionsFromLocalStorage();
}

export function persistDraftSessions(sessions: DraftSession[]) {
  const normalizedSessions = normalizeDraftSessions(sessions);

  draftSessionPersistQueue = draftSessionPersistQueue
    .catch(() => undefined)
    .then(async () => {
      const persistedToIndexedDb = await persistDraftSessionsToIndexedDb(normalizedSessions);
      if (persistedToIndexedDb) {
        clearLegacyDraftSessionsStorage();
        return;
      }

      persistDraftSessionsToLocalStorage(normalizedSessions);
    });

  return draftSessionPersistQueue;
}

export function clearLegacyDraftState() {
  const storage = getLocalStorage();
  storage?.removeItem(DRAFT_BOOK_STORAGE_KEY);
  storage?.removeItem(DRAFT_UI_STORAGE_KEY);
}
