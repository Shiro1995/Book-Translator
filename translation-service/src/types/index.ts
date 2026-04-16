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
  debugTiming?: boolean;
}

export interface TranslationJobResult {
  translatedText: string;
  providerPayload?: unknown;
  providerResponse?: unknown;
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

export interface ExportPdfPageInput {
  id: number;
  translatedText: string;
}

export interface ExportPdfRequest {
  bookName: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  pages: ExportPdfPageInput[];
}

export interface ExportPdfResult {
  fileName: string;
  buffer: Buffer;
  exportedPages: number;
}

export interface ExportDocxPageInput {
  id: number;
  translatedText: string;
}

export interface ExportDocxRequest {
  bookName: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  pages: ExportDocxPageInput[];
}

export interface ExportDocxResult {
  fileName: string;
  buffer: Buffer;
  exportedPages: number;
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
  debugTiming?: boolean;
}

export interface TranslateResponse {
  translatedText: string;
  providerPayload?: unknown;
  providerResponse?: unknown;
}
