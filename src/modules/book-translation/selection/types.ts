export type SelectionMode = "dictionary" | "ai";
export type SelectionTab = "dictionary" | "ai";
export type SelectionLookupType = "word" | "phrase" | "sentence" | "paragraph";

export type SelectionLanguage =
  | "latin"
  | "japanese"
  | "chinese"
  | "korean"
  | "mixed"
  | "unknown";

export interface SelectionAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SelectionMetrics {
  charCount: number;
  tokenCount: number;
  sentenceCount: number;
  hasLineBreak: boolean;
  hasTerminalPunctuation: boolean;
  hasInnerPunctuation: boolean;
  hasLeadingOrTrailingWhitespace: boolean;
  isSingleWord: boolean;
  isShortPhrase: boolean;
  looksLikeSentence: boolean;
  looksLikeMultiSentence: boolean;
  specialCharacterRatio: number;
  digitRatio: number;
  ocrNoiseLikely: boolean;
  language: SelectionLanguage;
  exactGlossaryMatch: boolean;
  partialGlossaryMatch: boolean;
  annotationOverlap: boolean;
}

export interface SelectionClassifierConfig {
  maxDictionaryTokens: number;
  maxDictionaryChars: number;
  aiSentenceThresholdTokens: number;
  aiPreferredCharThreshold: number;
  shortPhraseMinTokens: number;
  shortPhraseMaxTokens: number;
}

export interface SelectionClassification {
  mode: SelectionMode;
  reason: string;
  confidence: number;
  metrics: SelectionMetrics;
  allowDictionary: boolean;
  allowAI: boolean;
  defaultTab: SelectionTab;
  lookupType: SelectionLookupType;
}

export interface GlossaryEntry {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  normalizedSourceTerm: string;
  note?: string;
  raw: string;
}

export interface SelectionContextWindow {
  startOffset: number;
  endOffset: number;
  beforeText: string;
  afterText: string;
  paragraphText: string;
  pageText: string;
  contextHash: string;
}

export interface SelectionSnapshot {
  id: string;
  bookId: string;
  pageId: number;
  text: string;
  trimmedText: string;
  normalizedText: string;
  rect: SelectionAnchorRect;
  metrics: SelectionMetrics;
  classifier: SelectionClassification;
  contextWindow: SelectionContextWindow;
}

export interface DictionaryTokenBreakdown {
  token: string;
  normalizedToken: string;
  glossaryMatch?: GlossaryEntry;
}

export type DictionaryLookupSource =
  | "glossary"
  | "internal-dictionary"
  | "generated-helper"
  | "vi-viet-dictionary"
  | "none";

export type DictionaryLookupStatus = "success" | "partial" | "empty" | "unsupported";

export interface DictionaryLookupResult {
  status: DictionaryLookupStatus;
  source: DictionaryLookupSource;
  selectedText: string;
  normalizedText: string;
  glossaryMatches: GlossaryEntry[];
  tokenBreakdown: DictionaryTokenBreakdown[];
  primaryMeaning?: string;
  secondaryMeanings: string[];
  pronunciation?: string;
  partOfSpeech?: string;
  domain?: string;
  examples: string[];
  relatedTerms: string[];
  message?: string;
  suggestion?: string;
}

export interface EnglishDictionaryAssist {
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definitions: string[];
  example?: string;
  source: "dictionaryapi.dev";
}

export type VietnameseAssistSource =
  | "internal-provider"
  | "laban"
  | "ai-micro"
  | "none";

export type VietnameseAssistStatus = "success" | "empty" | "unsupported";

export interface VietnameseAssistResult {
  status: VietnameseAssistStatus;
  source: VietnameseAssistSource;
  title: string;
  explanation?: string;
  note?: string;
  englishAssist?: EnglishDictionaryAssist;
}

export interface SelectionAiRequest {
  bookId: string;
  bookName: string;
  pageId: number;
  selectedText: string;
  normalizedText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  model: string;
  glossary: string;
  instructions: string;
  beforeText: string;
  afterText: string;
  paragraphText: string;
  pageText: string;
  existingTranslation?: string;
  documentMetadata?: {
    title?: string;
    genre?: string;
    domain?: string;
  };
  contextHash: string;
}

export interface SelectionAiAlternative {
  text: string;
  note?: string;
}

export interface SelectionAiGlossaryApplied {
  sourceTerm: string;
  targetTerm: string;
  status: "applied" | "suggested" | "conflict";
  note?: string;
}

export interface SelectionAiSegmentation {
  source: string;
  explanation?: string;
}

export interface SelectionAiResult {
  translationNatural: string;
  translationLiteral?: string;
  explanation?: string;
  alternatives: SelectionAiAlternative[];
  glossaryApplied: SelectionAiGlossaryApplied[];
  warnings: string[];
  segmentation: SelectionAiSegmentation[];
  confidence?: number;
  source: "api" | "fallback";
  detailLevel?: "quick" | "insights";
}

export interface SelectionAnalyticsPayload {
  documentId: string;
  pageId: number;
  selectionLengthChars: number;
  selectionLengthTokens: number;
  classifierMode: SelectionMode;
  defaultTab: SelectionTab;
  language: SelectionLanguage;
  glossaryHit: boolean;
  responseTime?: number;
  errorCode?: string;
}
