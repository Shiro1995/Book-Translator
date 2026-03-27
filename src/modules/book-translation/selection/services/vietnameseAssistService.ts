import type {
  DictionaryLookupResult,
  EnglishDictionaryAssist,
  SelectionSnapshot,
  VietnameseAssistResult,
  VietnameseAssistSource,
} from "../types";
import { normalizeLookupText } from "../utils/selectionNormalization";
import { requestSelectionAiInsights } from "./selectionAiService";

interface DictionaryApiPhonetic {
  text?: string;
}

interface DictionaryApiDefinition {
  definition: string;
  example?: string;
}

interface DictionaryApiMeaning {
  partOfSpeech?: string;
  definitions: DictionaryApiDefinition[];
}

interface DictionaryApiEntry {
  word: string;
  phonetics?: DictionaryApiPhonetic[];
  meanings?: DictionaryApiMeaning[];
}

interface LabanSuggestion {
  select?: string;
  data?: string;
}

interface LabanAutocompleteResponse {
  query?: string;
  suggestions?: LabanSuggestion[];
}

export interface VietnameseAssistRequest {
  selection: SelectionSnapshot;
  dictionaryResult: DictionaryLookupResult | null;
  bookName: string;
  glossary: string;
  instructions: string;
  model: string;
  targetLanguage: string;
}

interface VietnameseAssistExplanation {
  explanation: string;
  note?: string;
  source: VietnameseAssistSource;
}

interface VietnameseAssistContext {
  request: VietnameseAssistRequest;
  englishAssist: EnglishDictionaryAssist | null;
}

interface EnglishDictionaryProvider {
  lookup: (term: string, options?: { signal?: AbortSignal }) => Promise<EnglishDictionaryAssist | null>;
}

interface VietnameseAssistProvider {
  explain: (
    context: VietnameseAssistContext,
    options?: { signal?: AbortSignal },
  ) => Promise<VietnameseAssistExplanation | null>;
}

interface VietnameseAssistFallbackProvider {
  explainWithFallback: (
    context: VietnameseAssistContext,
    options?: { signal?: AbortSignal },
  ) => Promise<VietnameseAssistExplanation | null>;
}

interface ProviderRegistry {
  englishDictionaryProvider: EnglishDictionaryProvider;
  vietnameseAssistProviders: VietnameseAssistProvider[];
  fallbackProvider: VietnameseAssistFallbackProvider;
}

const englishDictionaryCache = new Map<string, EnglishDictionaryAssist | null>();
const vietnameseAssistCache = new Map<string, VietnameseAssistResult>();

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError() {
  return new DOMException("Aborted", "AbortError");
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/<br\s*\/?>/giu, "\n");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value).replace(/<[^>]+>/giu, " ").replace(/\s+/gu, " ").trim();
}

function extractLabanMeaning(htmlSnippet: string) {
  const paragraphMatch = htmlSnippet.match(/<p>([\s\S]*?)<\/p>/iu);
  if (paragraphMatch?.[1]) {
    const parsed = stripHtml(paragraphMatch[1]);
    if (parsed) {
      return parsed;
    }
  }

  const parsed = stripHtml(htmlSnippet);
  return parsed || null;
}

export function shouldLoadVietnameseAssistBlock(selection: SelectionSnapshot) {
  if (selection.classifier.mode === "ai") {
    return false;
  }

  if (!selection.classifier.allowDictionary) {
    return false;
  }

  if (selection.metrics.hasLineBreak || selection.metrics.looksLikeSentence || selection.metrics.looksLikeMultiSentence) {
    return false;
  }

  if (selection.metrics.tokenCount === 0 || selection.metrics.tokenCount > 5) {
    return false;
  }

  if (selection.metrics.charCount > 48) {
    return false;
  }

  return selection.classifier.lookupType === "word" || selection.classifier.lookupType === "phrase";
}

function buildVietnameseAssistCacheKey(request: VietnameseAssistRequest) {
  return [
    request.selection.bookId,
    request.selection.pageId,
    request.selection.normalizedText,
    request.selection.contextWindow.contextHash,
    hashText(request.glossary),
    request.dictionaryResult?.primaryMeaning ?? "",
  ].join("::");
}

const englishDictionaryProvider: EnglishDictionaryProvider = {
  async lookup(term, options) {
    const normalizedTerm = normalizeLookupText(term);
    if (!normalizedTerm) {
      return null;
    }

    if (englishDictionaryCache.has(normalizedTerm)) {
      return englishDictionaryCache.get(normalizedTerm) ?? null;
    }

    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedTerm)}`,
        { signal: options?.signal },
      );
      if (!response.ok) {
        englishDictionaryCache.set(normalizedTerm, null);
        return null;
      }

      const payload = (await response.json()) as DictionaryApiEntry[];
      const entry = payload[0];
      const firstMeaning = entry?.meanings?.[0];
      const definitions = firstMeaning?.definitions?.map((item) => item.definition).filter(Boolean) ?? [];
      const firstExample = firstMeaning?.definitions?.find((item) => Boolean(item.example))?.example;

      if (!entry?.word || definitions.length === 0) {
        englishDictionaryCache.set(normalizedTerm, null);
        return null;
      }

      const assist: EnglishDictionaryAssist = {
        word: entry.word,
        pronunciation: entry.phonetics?.find((item) => item.text)?.text,
        partOfSpeech: firstMeaning?.partOfSpeech,
        definitions: definitions.slice(0, 3),
        example: firstExample,
        source: "dictionaryapi.dev",
      };

      englishDictionaryCache.set(normalizedTerm, assist);
      return assist;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return null;
    }
  },
};

const internalVietnameseAssistProvider: VietnameseAssistProvider = {
  async explain(context) {
    const glossaryHit = context.request.dictionaryResult?.glossaryMatches[0];
    if (!glossaryHit) {
      return null;
    }

    return {
      source: "internal-provider",
      explanation: `Theo glossary nội bộ, "${glossaryHit.sourceTerm}" được hiểu là "${glossaryHit.targetTerm}".`,
      note: "Ưu tiên thuật ngữ nội bộ của tài liệu.",
    };
  },
};

const labanVietnameseAssistProvider: VietnameseAssistProvider = {
  async explain(context, options) {
    const endpoint = String(import.meta.env.VITE_LABAN_DICTIONARY_URL ?? "https://dict.laban.vn/ajax/autocomplete").trim();
    if (!endpoint) {
      return null;
    }
    if (
      context.request.selection.metrics.language !== "latin" &&
      context.request.selection.metrics.language !== "unknown"
    ) {
      return null;
    }

    try {
      const url = new URL(endpoint);
      url.searchParams.set("type", "1");
      url.searchParams.set("site", "dictionary");
      url.searchParams.set("query", context.request.selection.trimmedText);
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: options?.signal,
      });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as LabanAutocompleteResponse;
      const suggestions = payload.suggestions ?? [];
      if (suggestions.length === 0) {
        return null;
      }

      const normalizedSelection = normalizeLookupText(context.request.selection.trimmedText);
      const matchedSuggestion =
        suggestions.find(
          (item) => normalizeLookupText(item.select ?? "") === normalizedSelection,
        ) ?? suggestions[0];

      const explanation = matchedSuggestion?.data ? extractLabanMeaning(matchedSuggestion.data) : null;

      if (!explanation) {
        return null;
      }

      return {
        source: "laban",
        explanation,
        note: "Từ điển Anh-Việt Laban.",
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return null;
    }
  },
};

const aiMicroFallbackProvider: VietnameseAssistFallbackProvider = {
  async explainWithFallback(context, options) {
    const { request } = context;
    const aiInstructions = [
      request.instructions.trim(),
      "Bạn là trợ lý giải thích từ/cụm ngắn cho người học Việt.",
      "Trả lời ngắn gọn bằng tiếng Việt, tối đa 2 câu, không thêm markdown.",
      "Giải thích nghĩa và sắc thái dùng trong ngữ cảnh tài liệu.",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const aiResult = await requestSelectionAiInsights(
        {
          bookId: request.selection.bookId,
          bookName: request.bookName,
          pageId: request.selection.pageId,
          selectedText: request.selection.trimmedText,
          normalizedText: request.selection.normalizedText,
          sourceLanguage: request.selection.metrics.language,
          targetLanguage: request.targetLanguage,
          model: request.model,
          glossary: request.glossary,
          instructions: aiInstructions,
          beforeText: request.selection.contextWindow.beforeText,
          afterText: request.selection.contextWindow.afterText,
          paragraphText: request.selection.contextWindow.paragraphText,
          pageText: request.selection.contextWindow.pageText,
          contextHash: request.selection.contextWindow.contextHash,
        },
        {
          signal: options?.signal,
          mode: "insights",
        },
      );

      const explanation = aiResult.explanation?.trim() || aiResult.translationNatural.trim();
      if (!explanation) {
        return null;
      }

      return {
        source: "ai-micro",
        explanation,
        note: "Fallback AI micro explanation.",
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return null;
    }
  },
};

function getDefaultProviders(): ProviderRegistry {
  return {
    englishDictionaryProvider,
    vietnameseAssistProviders: [internalVietnameseAssistProvider, labanVietnameseAssistProvider],
    fallbackProvider: aiMicroFallbackProvider,
  };
}

function buildUnsupportedResult(): VietnameseAssistResult {
  return {
    status: "unsupported",
    source: "none",
    title: "Giải thích tiếng Việt",
    note: "Block này chỉ áp dụng cho từ hoặc cụm ngắn. Với đoạn dài, dùng tab AI ngữ cảnh.",
  };
}

function buildEmptyResult(englishAssist: EnglishDictionaryAssist | null): VietnameseAssistResult {
  return {
    status: "empty",
    source: "none",
    title: "Giải thích tiếng Việt",
    englishAssist: englishAssist ?? undefined,
    note: "Chưa có diễn giải tiếng Việt phù hợp cho selection này.",
  };
}

export function clearVietnameseAssistCacheForTests() {
  englishDictionaryCache.clear();
  vietnameseAssistCache.clear();
}

export async function requestVietnameseAssistBlock(
  request: VietnameseAssistRequest,
  options?: {
    signal?: AbortSignal;
    providers?: Partial<ProviderRegistry>;
  },
): Promise<VietnameseAssistResult> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  if (!shouldLoadVietnameseAssistBlock(request.selection)) {
    return buildUnsupportedResult();
  }

  const cacheKey = buildVietnameseAssistCacheKey(request);
  if (vietnameseAssistCache.has(cacheKey)) {
    return vietnameseAssistCache.get(cacheKey)!;
  }

  const providerRegistry = {
    ...getDefaultProviders(),
    ...options?.providers,
  };

  const englishAssist = await providerRegistry.englishDictionaryProvider.lookup(
    request.selection.trimmedText,
    { signal: options?.signal },
  );

  const providerContext: VietnameseAssistContext = {
    request,
    englishAssist,
  };

  for (const provider of providerRegistry.vietnameseAssistProviders) {
    try {
      const explanation = await provider.explain(providerContext, { signal: options?.signal });
      if (!explanation?.explanation) {
        continue;
      }

      const result: VietnameseAssistResult = {
        status: "success",
        source: explanation.source,
        title: "Giải thích tiếng Việt",
        explanation: explanation.explanation,
        note: explanation.note,
        englishAssist: englishAssist ?? undefined,
      };
      vietnameseAssistCache.set(cacheKey, result);
      return result;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
    }
  }

  const fallbackExplanation = await providerRegistry.fallbackProvider.explainWithFallback(
    providerContext,
    { signal: options?.signal },
  );

  if (fallbackExplanation?.explanation) {
    const result: VietnameseAssistResult = {
      status: "success",
      source: fallbackExplanation.source,
      title: "Giải thích tiếng Việt",
      explanation: fallbackExplanation.explanation,
      note: fallbackExplanation.note,
      englishAssist: englishAssist ?? undefined,
    };
    vietnameseAssistCache.set(cacheKey, result);
    return result;
  }

  const emptyResult = buildEmptyResult(englishAssist);
  vietnameseAssistCache.set(cacheKey, emptyResult);
  return emptyResult;
}
