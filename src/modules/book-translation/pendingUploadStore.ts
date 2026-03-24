export type PendingBookTranslationLaunch =
  | { type: "upload"; file: File }
  | { type: "resume"; bookId: string }
  | { type: "sample" };

let pendingBookTranslationLaunch: PendingBookTranslationLaunch | null = null;

export function setPendingBookUpload(file: File | null) {
  pendingBookTranslationLaunch = file ? { type: "upload", file } : null;
}

export function setPendingDraftSession(bookId: string | null) {
  pendingBookTranslationLaunch = bookId ? { type: "resume", bookId } : null;
}

export function setPendingSampleBook() {
  pendingBookTranslationLaunch = { type: "sample" };
}

export function peekPendingBookTranslationLaunch() {
  return pendingBookTranslationLaunch;
}

export function takePendingBookTranslationLaunch() {
  const nextLaunch = pendingBookTranslationLaunch;
  pendingBookTranslationLaunch = null;
  return nextLaunch;
}
