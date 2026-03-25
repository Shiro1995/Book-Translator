// ── Job States ──────────────────────────────────────────────────────
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "canceled";

export interface JobInfo<TResult = unknown> {
  jobId: string;
  status: JobStatus;
  progress?: number;       // 0-100
  createdAt: number;       // epoch ms
  updatedAt: number;
  error?: string;
  result?: TResult;
}

// ── Translation ─────────────────────────────────────────────────────
export type TranslationStyle = "natural" | "literal" | "literary" | "academic";

export interface TranslationSettings {
  model: string;
  targetLang: string;
  style: TranslationStyle;
  glossary: string;
  instructions: string;
}

export interface TranslationJobInput {
  text: string;
  settings: TranslationSettings;
  pageId?: number;
  bookName?: string;
}

export interface TranslationJobResult {
  translatedText: string;
}

// ── Document Parse ──────────────────────────────────────────────────
export interface ParsedPage {
  id: number;
  originalText: string;
  translatedText: string;
  status: "idle";
}

export interface DocumentParseResult {
  name: string;
  size: number;
  pages: ParsedPage[];
}

// ── Provider ────────────────────────────────────────────────────────
export interface TranslateRequest {
  text: string;
  model: string;
  targetLang: string;
  style: TranslationStyle;
  glossary: string;
  instructions: string;
  pageId?: number;
  bookName?: string;
}

export interface TranslateResponse {
  translatedText: string;
}
