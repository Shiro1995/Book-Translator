import { normalizeUserFacingText } from "../../utils/text";
import type { SelectionLanguage } from "../types";

const BOUNDARY_PUNCTUATION_REGEX = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const MULTI_SPACE_REGEX = /[^\S\r\n]+/g;

export function detectSelectionLanguage(value: string): SelectionLanguage {
  if (!value.trim()) {
    return "unknown";
  }

  const hasJapanese = /[\u3040-\u30ff]/u.test(value);
  const hasChinese = /[\u4e00-\u9fff]/u.test(value);
  const hasKorean = /[\uac00-\ud7af]/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);

  const matches = [hasJapanese, hasChinese, hasKorean, hasLatin].filter(Boolean).length;
  if (matches > 1) {
    return "mixed";
  }
  if (hasJapanese) {
    return "japanese";
  }
  if (hasChinese) {
    return "chinese";
  }
  if (hasKorean) {
    return "korean";
  }
  if (hasLatin) {
    return "latin";
  }
  return "unknown";
}

export function normalizeSelectionWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(MULTI_SPACE_REGEX, " ");
}

export function normalizeSelectionText(value: string) {
  return normalizeUserFacingText(value).replace(/\u00a0/g, " ");
}

export function trimBoundaryPunctuation(value: string) {
  return value.replace(BOUNDARY_PUNCTUATION_REGEX, "");
}

export function normalizeLookupText(value: string, language?: SelectionLanguage) {
  const detectedLanguage = language ?? detectSelectionLanguage(value);
  const normalized = normalizeSelectionWhitespace(normalizeSelectionText(value)).trim();
  const widthNormalized = normalized.normalize("NFKC");
  const stripped = trimBoundaryPunctuation(widthNormalized).trim();

  if (detectedLanguage === "latin" || detectedLanguage === "mixed") {
    return stripped.toLocaleLowerCase();
  }

  return stripped;
}

export function splitSelectionTokens(value: string, language?: SelectionLanguage) {
  const detectedLanguage = language ?? detectSelectionLanguage(value);
  const normalized = normalizeLookupText(value, detectedLanguage);

  if (!normalized) {
    return [];
  }

  if (
    (detectedLanguage === "japanese" || detectedLanguage === "chinese" || detectedLanguage === "korean") &&
    !/\s/u.test(normalized)
  ) {
    return Array.from(normalized).filter((char) => /\p{L}|\p{N}/u.test(char));
  }

  return normalized
    .split(/[\s/]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function buildContextHash(parts: string[]) {
  const raw = parts.join("::");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
