import type { ProviderErrorCode } from "../lib/provider-errors.js";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "canceled";

export interface JobInfo<TResult = unknown> {
  jobId: string;
  status: JobStatus;
  progress?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  errorCode?: ProviderErrorCode;
  result?: TResult;
}

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
  requestId?: string;
}

export interface TranslationJobResult {
  translatedText: string;
}

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

export interface TranslateRequest {
  text: string;
  model: string;
  targetLang: string;
  style: TranslationStyle;
  glossary: string;
  instructions: string;
  pageId?: number;
  bookName?: string;
  requestId?: string;
  jobId?: string;
}

export interface TranslateResponse {
  translatedText: string;
}
