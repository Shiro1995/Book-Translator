import type {
  DictionaryLookupResult,
  DictionaryLookupSource,
  SelectionClassification,
} from "../types";
import {
  findExactGlossaryMatch,
  findGlossaryCandidates,
  parseGlossaryEntries,
} from "./glossaryLookupService";
import {
  detectSelectionLanguage,
  normalizeLookupText,
  splitSelectionTokens,
} from "../utils/selectionNormalization";

// ── Free Dictionary API Types ───────────────────────────────────────

interface DictionaryApiPhonetic {
  text?: string;
  audio?: string;
}

interface DictionaryApiDefinition {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

interface DictionaryApiMeaning {
  partOfSpeech: string;
  definitions: DictionaryApiDefinition[];
  synonyms: string[];
  antonyms: string[];
}

interface DictionaryApiEntry {
  word: string;
  phonetics: DictionaryApiPhonetic[];
  meanings: DictionaryApiMeaning[];
}

// ── API cache to avoid redundant network calls ──────────────────────

const apiCache = new Map<string, DictionaryApiEntry[] | null>();

async function fetchDictionaryApi(
  word: string,
  signal?: AbortSignal,
): Promise<DictionaryApiEntry[] | null> {
  const cacheKey = word.toLowerCase().trim();
  if (apiCache.has(cacheKey)) {
    return apiCache.get(cacheKey) ?? null;
  }

  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cacheKey)}`,
      { signal },
    );

    if (!response.ok) {
      apiCache.set(cacheKey, null);
      return null;
    }

    const data = (await response.json()) as DictionaryApiEntry[];
    apiCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

function mapApiEntryToResult(
  entries: DictionaryApiEntry[],
  originalText: string,
  normalizedText: string,
  glossaryMatches: DictionaryLookupResult["glossaryMatches"],
  tokenBreakdown: DictionaryLookupResult["tokenBreakdown"],
): DictionaryLookupResult {
  const entry = entries[0];
  const allMeanings = entry.meanings;

  // Primary meaning = first definition of the first meaning
  const primaryMeaning = allMeanings[0]?.definitions[0]?.definition;

  // Secondary meanings = remaining definitions across all parts of speech
  const secondaryMeanings = allMeanings
    .flatMap((m) => m.definitions.slice(0, 2).map((d) => d.definition))
    .filter((d) => d !== primaryMeaning)
    .slice(0, 4);

  // Pronunciation
  const phonetic = entry.phonetics.find((p) => p.text);
  const pronunciation = phonetic?.text;

  // Part of speech
  const partOfSpeech = allMeanings.map((m) => m.partOfSpeech).join(", ");

  // Examples
  const examples = allMeanings
    .flatMap((m) => m.definitions.filter((d) => d.example).map((d) => d.example!))
    .slice(0, 3);

  // Related terms (synonyms + antonyms)
  const synonyms = allMeanings.flatMap((m) => [...m.synonyms, ...m.definitions.flatMap((d) => d.synonyms)]);
  const antonyms = allMeanings.flatMap((m) => [...m.antonyms, ...m.definitions.flatMap((d) => d.antonyms)]);
  const relatedTerms = [
    ...synonyms.slice(0, 3).map((s) => `≈ ${s}`),
    ...antonyms.slice(0, 2).map((a) => `≠ ${a}`),
  ];

  const source: DictionaryLookupSource = glossaryMatches.length > 0
    ? "glossary"
    : "internal-dictionary";

  return {
    status: "success",
    source,
    selectedText: originalText,
    normalizedText,
    glossaryMatches,
    tokenBreakdown,
    primaryMeaning,
    secondaryMeanings,
    pronunciation,
    partOfSpeech,
    examples,
    relatedTerms,
    message: glossaryMatches.length > 0
      ? "Khớp glossary nội bộ + từ điển tiếng Anh."
      : "Tra cứu từ điển tiếng Anh",
  };
}

// ── Heuristic POS fallback ──────────────────────────────────────────

function inferPartOfSpeech(text: string) {
  if (/ing$/iu.test(text) || /\bto\s+\w+/iu.test(text)) return "Động từ / cụm động từ";
  if (/ly$/iu.test(text)) return "Trạng từ";
  if (/tion$|ment$|ness$|ity$/iu.test(text)) return "Danh từ";
  return undefined;
}

// ── Main Lookup (now async) ─────────────────────────────────────────

export async function lookupDictionarySelection(
  input: {
    text: string;
    glossary: string;
    classifier: SelectionClassification;
  },
  options?: { signal?: AbortSignal },
): Promise<DictionaryLookupResult> {
  const glossaryEntries = parseGlossaryEntries(input.glossary);
  const normalizedText = normalizeLookupText(input.text);
  const exactMatch = findExactGlossaryMatch(input.text, glossaryEntries);
  const candidateMatches = findGlossaryCandidates(input.text, glossaryEntries);
  const language = detectSelectionLanguage(input.text);
  const tokens = splitSelectionTokens(input.text, language);

  // Not suitable for dictionary lookup
  if (!input.classifier.allowDictionary) {
    return {
      status: "unsupported",
      source: "none",
      selectedText: input.text,
      normalizedText,
      glossaryMatches: candidateMatches,
      tokenBreakdown: [],
      secondaryMeanings: [],
      examples: [],
      relatedTerms: [],
      message: "Đoạn bôi đen quá dài để tra cứu kiểu từ điển.",
      suggestion: "Chuyển sang tab AI để lấy bản dịch ngữ cảnh và giải thích đầy đủ.",
    };
  }

  const tokenBreakdown = tokens
    .map((token) => ({
      token,
      normalizedToken: normalizeLookupText(token),
      glossaryMatch:
        glossaryEntries.find((entry) => entry.normalizedSourceTerm === normalizeLookupText(token)) ??
        undefined,
    }))
    .filter((entry) => entry.token.trim().length > 0);

  // ── Try external dictionary API for Latin-script single words/short phrases ──
  const isLatinScript = language === "latin" || language === "unknown";
  const isShortEnough = tokens.length <= 3;

  if (isLatinScript && isShortEnough) {
    // Try the full text first, then individual tokens
    const lookupWords = [
      input.text.trim().toLowerCase(),
      ...tokens.filter((t) => t.trim().length > 1).map((t) => t.trim().toLowerCase()),
    ].filter((w, i, arr) => arr.indexOf(w) === i); // dedupe

    for (const word of lookupWords) {
      const apiResult = await fetchDictionaryApi(word, options?.signal);
      if (apiResult && apiResult.length > 0) {
        const result = mapApiEntryToResult(
          apiResult,
          input.text,
          normalizedText,
          exactMatch ? [exactMatch] : candidateMatches,
          tokenBreakdown,
        );

        // Merge glossary info if we also have a glossary hit
        if (exactMatch) {
          result.message = "Khớp glossary nội bộ + từ điển tiếng Anh.";
          if (!result.relatedTerms.includes(`${exactMatch.sourceTerm} → ${exactMatch.targetTerm}`)) {
            result.relatedTerms.unshift(`📖 ${exactMatch.sourceTerm} → ${exactMatch.targetTerm}`);
          }
        }

        return result;
      }
    }
  }

  // ── Glossary exact match fallback ──
  if (exactMatch) {
    return {
      status: "success",
      source: "glossary",
      selectedText: input.text,
      normalizedText,
      glossaryMatches: [exactMatch],
      tokenBreakdown,
      primaryMeaning: exactMatch.targetTerm,
      secondaryMeanings: [],
      examples: [],
      relatedTerms: glossaryEntries
        .filter((entry) => entry.id !== exactMatch.id)
        .slice(0, 3)
        .map((entry) => `${entry.sourceTerm} → ${entry.targetTerm}`),
      partOfSpeech: inferPartOfSpeech(exactMatch.sourceTerm),
      message: "Khớp glossary nội bộ.",
      suggestion: "Bạn vẫn có thể mở tab AI để xem bản dịch theo ngữ cảnh của cả câu.",
    };
  }

  // ── Partial glossary token matches ──
  const matchedTokens = tokenBreakdown.filter((token) => token.glossaryMatch);

  if (matchedTokens.length > 0) {
    return {
      status: "partial",
      source: "generated-helper",
      selectedText: input.text,
      normalizedText,
      glossaryMatches: matchedTokens.flatMap((token) => (token.glossaryMatch ? [token.glossaryMatch] : [])),
      tokenBreakdown,
      primaryMeaning: matchedTokens
        .map((token) => `${token.token} → ${token.glossaryMatch?.targetTerm}`)
        .join("; "),
      secondaryMeanings: [],
      examples: [],
      relatedTerms: candidateMatches.slice(0, 4).map((entry) => `${entry.sourceTerm} → ${entry.targetTerm}`),
      message: "Không có mục khớp chính xác, nhưng đã tìm thấy các thành phần liên quan trong glossary.",
      suggestion: "Nếu cần diễn giải đầy đủ của cả cụm, mở tab AI ngữ cảnh.",
    };
  }

  // ── No results ──
  return {
    status: tokens.length > 1 ? "partial" : "empty",
    source: tokens.length > 1 ? "generated-helper" : "none",
    selectedText: input.text,
    normalizedText,
    glossaryMatches: candidateMatches,
    tokenBreakdown,
    primaryMeaning: undefined,
    secondaryMeanings: [],
    pronunciation: undefined,
    partOfSpeech: inferPartOfSpeech(input.text),
    domain: undefined,
    examples: [],
    relatedTerms: candidateMatches.slice(0, 4).map((entry) => `${entry.sourceTerm} → ${entry.targetTerm}`),
    message:
      tokens.length > 1
        ? "Chưa có mục từ điển nội bộ khớp trực tiếp. Có thể dùng breakdown từng token hoặc chuyển sang AI."
        : "Chưa tìm thấy dữ liệu từ điển nội bộ cho selection này.",
    suggestion:
      "Chưa có kết quả trong glossary nội bộ cho cụm này. Bạn có thể mở AI ngữ cảnh để xem giải thích đầy đủ.",
  };
}
