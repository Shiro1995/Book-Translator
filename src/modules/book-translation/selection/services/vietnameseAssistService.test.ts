import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DictionaryLookupResult,
  EnglishDictionaryAssist,
  GlossaryEntry,
  SelectionSnapshot,
} from "../types";
import {
  clearVietnameseAssistCacheForTests,
  requestVietnameseAssistBlock,
  type VietnameseAssistRequest,
} from "./vietnameseAssistService";

const originalFetch = globalThis.fetch;

function createSelection(overrides?: {
  id?: string;
  trimmedText?: string;
  normalizedText?: string;
  tokenCount?: number;
  charCount?: number;
  mode?: "dictionary" | "ai";
  allowDictionary?: boolean;
  lookupType?: "word" | "phrase" | "sentence" | "paragraph";
}): SelectionSnapshot {
  const trimmedText = overrides?.trimmedText ?? "culture";
  return {
    id: overrides?.id ?? "selection-1",
    bookId: "book-1",
    pageId: 1,
    text: trimmedText,
    trimmedText,
    normalizedText: overrides?.normalizedText ?? "culture",
    rect: {
      top: 10,
      left: 20,
      right: 120,
      bottom: 40,
      width: 100,
      height: 30,
    },
    metrics: {
      charCount: overrides?.charCount ?? 7,
      tokenCount: overrides?.tokenCount ?? 1,
      sentenceCount: 1,
      hasLineBreak: false,
      hasTerminalPunctuation: false,
      hasInnerPunctuation: false,
      hasLeadingOrTrailingWhitespace: false,
      isSingleWord: true,
      isShortPhrase: true,
      looksLikeSentence: false,
      looksLikeMultiSentence: false,
      specialCharacterRatio: 0,
      digitRatio: 0,
      ocrNoiseLikely: false,
      language: "latin",
      exactGlossaryMatch: false,
      partialGlossaryMatch: false,
      annotationOverlap: false,
    },
    classifier: {
      mode: overrides?.mode ?? "dictionary",
      reason: "test",
      confidence: 0.95,
      metrics: {
        charCount: overrides?.charCount ?? 7,
        tokenCount: overrides?.tokenCount ?? 1,
        sentenceCount: 1,
        hasLineBreak: false,
        hasTerminalPunctuation: false,
        hasInnerPunctuation: false,
        hasLeadingOrTrailingWhitespace: false,
        isSingleWord: true,
        isShortPhrase: true,
        looksLikeSentence: false,
        looksLikeMultiSentence: false,
        specialCharacterRatio: 0,
        digitRatio: 0,
        ocrNoiseLikely: false,
        language: "latin",
        exactGlossaryMatch: false,
        partialGlossaryMatch: false,
        annotationOverlap: false,
      },
      allowDictionary: overrides?.allowDictionary ?? true,
      allowAI: true,
      defaultTab: "dictionary",
      lookupType: overrides?.lookupType ?? "word",
    },
    contextWindow: {
      startOffset: 0,
      endOffset: trimmedText.length,
      beforeText: "before",
      afterText: "after",
      paragraphText: "before culture after",
      pageText: "before culture after page",
      contextHash: "ctx-1",
    },
  };
}

function createDictionaryResult(
  overrides?: Partial<DictionaryLookupResult>,
): DictionaryLookupResult {
  return {
    status: "success",
    source: "internal-dictionary",
    selectedText: "culture",
    normalizedText: "culture",
    glossaryMatches: [],
    tokenBreakdown: [],
    secondaryMeanings: [],
    examples: [],
    relatedTerms: [],
    ...overrides,
  };
}

function createRequest(
  overrides?: Partial<VietnameseAssistRequest>,
): VietnameseAssistRequest {
  return {
    selection: createSelection(),
    dictionaryResult: createDictionaryResult(),
    bookName: "Book Name",
    glossary: "culture -> văn hóa",
    instructions: "Use concise output",
    model: "gemini-2.5-flash",
    targetLanguage: "Vietnamese",
    ...overrides,
  };
}

describe("requestVietnameseAssistBlock", () => {
  beforeEach(() => {
    clearVietnameseAssistCacheForTests();
  });

  afterEach(() => {
    clearVietnameseAssistCacheForTests();
    vi.restoreAllMocks();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads Vietnamese assist for short selection and uses cache", async () => {
    const englishAssist: EnglishDictionaryAssist = {
      word: "culture",
      pronunciation: "/ˈkʌltʃər/",
      partOfSpeech: "noun",
      definitions: ["the ideas, customs, and social behaviour of a people"],
      source: "dictionaryapi.dev",
    };
    const englishLookup = vi.fn(async () => englishAssist);
    const vietnameseProvider = vi.fn(async () => ({
      source: "laban" as const,
      explanation: "Văn hóa là tập hợp giá trị và cách sống của cộng đồng.",
      note: "Tóm tắt ngắn cho người Việt.",
    }));
    const fallbackProvider = vi.fn(async () => null);
    const request = createRequest();

    const firstResult = await requestVietnameseAssistBlock(request, {
      providers: {
        englishDictionaryProvider: { lookup: englishLookup },
        vietnameseAssistProviders: [{ explain: vietnameseProvider }],
        fallbackProvider: { explainWithFallback: fallbackProvider },
      },
    });
    const secondResult = await requestVietnameseAssistBlock(request, {
      providers: {
        englishDictionaryProvider: { lookup: englishLookup },
        vietnameseAssistProviders: [{ explain: vietnameseProvider }],
        fallbackProvider: { explainWithFallback: fallbackProvider },
      },
    });

    expect(firstResult.status).toBe("success");
    expect(firstResult.source).toBe("laban");
    expect(firstResult.englishAssist?.word).toBe("culture");
    expect(secondResult).toEqual(firstResult);
    expect(englishLookup).toHaveBeenCalledTimes(1);
    expect(vietnameseProvider).toHaveBeenCalledTimes(1);
    expect(fallbackProvider).not.toHaveBeenCalled();
  });

  it("prefers internal provider when glossary hit exists", async () => {
    const glossaryEntry: GlossaryEntry = {
      id: "g-1",
      sourceTerm: "culture",
      targetTerm: "văn hóa",
      normalizedSourceTerm: "culture",
      raw: "culture -> văn hóa",
    };
    const request = createRequest({
      dictionaryResult: createDictionaryResult({
        source: "glossary",
        glossaryMatches: [glossaryEntry],
        primaryMeaning: "văn hóa",
      }),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      return new Response(
        JSON.stringify([
          {
            word: "culture",
            phonetics: [{ text: "/ˈkʌltʃər/" }],
            meanings: [
              {
                partOfSpeech: "noun",
                definitions: [{ definition: "the ideas and customs of a group" }],
              },
            ],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await requestVietnameseAssistBlock(request);

    expect(result.status).toBe("success");
    expect(result.source).toBe("internal-provider");
    expect(result.explanation).toContain("văn hóa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallInput = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstCallInput).toContain("dictionaryapi.dev");
  });

  it("falls back to AI micro explanation when Vietnamese providers fail", async () => {
    const englishLookup = vi.fn(async () => null);
    const failingProvider = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const emptyProvider = vi.fn(async () => null);
    const fallbackProvider = vi.fn(async () => ({
      source: "ai-micro" as const,
      explanation: "Đây là diễn giải dự phòng bằng AI micro.",
      note: "Fallback active.",
    }));

    const result = await requestVietnameseAssistBlock(createRequest(), {
      providers: {
        englishDictionaryProvider: { lookup: englishLookup },
        vietnameseAssistProviders: [{ explain: failingProvider }, { explain: emptyProvider }],
        fallbackProvider: { explainWithFallback: fallbackProvider },
      },
    });

    expect(result.status).toBe("success");
    expect(result.source).toBe("ai-micro");
    expect(result.explanation).toContain("AI micro");
    expect(fallbackProvider).toHaveBeenCalledTimes(1);
  });

  it("returns unsupported for long selection and does not eager load providers", async () => {
    const englishLookup = vi.fn(async () => null);
    const vietnameseProvider = vi.fn(async () => null);
    const fallbackProvider = vi.fn(async () => null);
    const request = createRequest({
      selection: createSelection({
        id: "selection-long",
        trimmedText: "this is a very long selection for dictionary popup",
        normalizedText: "this is a very long selection for dictionary popup",
        tokenCount: 9,
        charCount: 49,
        lookupType: "phrase",
      }),
    });

    const result = await requestVietnameseAssistBlock(request, {
      providers: {
        englishDictionaryProvider: { lookup: englishLookup },
        vietnameseAssistProviders: [{ explain: vietnameseProvider }],
        fallbackProvider: { explainWithFallback: fallbackProvider },
      },
    });

    expect(result.status).toBe("unsupported");
    expect(result.source).toBe("none");
    expect(englishLookup).not.toHaveBeenCalled();
    expect(vietnameseProvider).not.toHaveBeenCalled();
    expect(fallbackProvider).not.toHaveBeenCalled();
  });

  it("propagates AbortError when request is canceled", async () => {
    const controller = new AbortController();
    const englishLookup = vi.fn(
      (_term: string, options?: { signal?: AbortSignal }) =>
        new Promise<EnglishDictionaryAssist | null>((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }

          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const fallbackProvider = vi.fn(async () => null);
    const request = createRequest();

    const pending = requestVietnameseAssistBlock(request, {
      signal: controller.signal,
      providers: {
        englishDictionaryProvider: { lookup: englishLookup },
        vietnameseAssistProviders: [],
        fallbackProvider: { explainWithFallback: fallbackProvider },
      },
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(englishLookup).toHaveBeenCalledTimes(1);
    expect(fallbackProvider).not.toHaveBeenCalled();
  });
});
