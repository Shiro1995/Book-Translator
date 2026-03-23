export type TranslationStatus = 'idle' | 'translating' | 'completed' | 'error';
export type PromptPreset = 'custom' | 'reader' | 'literary' | 'technical' | 'study';

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
  promptPreset: PromptPreset;
  glossary: string;
  instructions: string;
}

export interface TranslationSettings {
  model: string;
  sourceLang: string;
  targetLang: string;
  style: 'natural' | 'literal' | 'literary' | 'academic';
  promptPreset: PromptPreset;
  glossary: string;
  instructions: string;
}
