export type TranslationStatus = 'idle' | 'translating' | 'completed' | 'error';

export interface Page {
  id: number;
  originalText: string;
  translatedText: string;
  status: TranslationStatus;
  error?: string;
  versionHistory: string[];
}

export interface Book {
  id: string;
  name: string;
  size: number;
  totalPages: number;
  pages: Page[];
  model: string;
  sourceLang: string;
  targetLang: string;
  style: 'literal' | 'natural' | 'literary' | 'academic';
  glossary: string;
  instructions: string;
}

export interface TranslationSettings {
  model: string;
  sourceLang: string;
  targetLang: string;
  style: 'natural' | 'literal' | 'literary' | 'academic';
  glossary: string;
  instructions: string;
}
