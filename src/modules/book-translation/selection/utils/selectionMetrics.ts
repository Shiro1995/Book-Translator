import type { SelectionMetrics } from "../types";
import {
  detectSelectionLanguage,
  normalizeSelectionText,
  splitSelectionTokens,
} from "./selectionNormalization";

const TERMINAL_PUNCTUATION_REGEX = /[.!?。！？]$/u;
const INNER_PUNCTUATION_REGEX = /[,:;。！？、]/u;
const SENTENCE_SPLIT_REGEX = /[.!?。！？]+/u;

function countMeaningfulCharacters(value: string) {
  return Array.from(value).filter((char) => /\S/u.test(char)).length;
}

export function buildSelectionMetrics(
  value: string,
  options?: {
    exactGlossaryMatch?: boolean;
    partialGlossaryMatch?: boolean;
    annotationOverlap?: boolean;
  },
): SelectionMetrics {
  const normalized = normalizeSelectionText(value);
  const trimmed = normalized.trim();
  const language = detectSelectionLanguage(trimmed);
  const tokens = splitSelectionTokens(trimmed, language);
  const meaningfulCharacters = countMeaningfulCharacters(trimmed);
  const specialCharacters =
    Array.from(trimmed).filter((char) => /\S/u.test(char) && !/[\p{L}\p{N}]/u.test(char)).length ?? 0;
  const digits = Array.from(trimmed).filter((char) => /\p{N}/u.test(char)).length;
  const sentenceCount = trimmed
    .split(SENTENCE_SPLIT_REGEX)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const ocrNoiseLikely =
    meaningfulCharacters > 0 &&
    (specialCharacters / meaningfulCharacters > 0.35 ||
      /(?:\b\w\b\s+){4,}/u.test(trimmed) ||
      /[Il1|]{3,}/u.test(trimmed));

  return {
    charCount: meaningfulCharacters,
    tokenCount: tokens.length,
    sentenceCount,
    hasLineBreak: /\n/u.test(normalized),
    hasTerminalPunctuation: TERMINAL_PUNCTUATION_REGEX.test(trimmed),
    hasInnerPunctuation: INNER_PUNCTUATION_REGEX.test(trimmed),
    hasLeadingOrTrailingWhitespace: normalized !== trimmed,
    isSingleWord: tokens.length === 1,
    isShortPhrase: tokens.length >= 2 && tokens.length <= 5 && meaningfulCharacters <= 32,
    looksLikeSentence:
      sentenceCount === 1 &&
      (tokens.length >= 6 || TERMINAL_PUNCTUATION_REGEX.test(trimmed) || /,\s+\p{L}/u.test(trimmed)),
    looksLikeMultiSentence: sentenceCount > 1,
    specialCharacterRatio: meaningfulCharacters > 0 ? specialCharacters / meaningfulCharacters : 0,
    digitRatio: meaningfulCharacters > 0 ? digits / meaningfulCharacters : 0,
    ocrNoiseLikely,
    language,
    exactGlossaryMatch: Boolean(options?.exactGlossaryMatch),
    partialGlossaryMatch: Boolean(options?.partialGlossaryMatch),
    annotationOverlap: Boolean(options?.annotationOverlap),
  };
}
