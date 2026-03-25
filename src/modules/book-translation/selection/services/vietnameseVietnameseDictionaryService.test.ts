import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVietnameseVietnameseDictionaryCacheForTests,
  lookupVietnameseVietnameseDictionary,
} from "./vietnameseVietnameseDictionaryService";

const originalFetch = globalThis.fetch;

describe("lookupVietnameseVietnameseDictionary", () => {
  beforeEach(() => {
    clearVietnameseVietnameseDictionaryCacheForTests();
  });

  afterEach(() => {
    clearVietnameseVietnameseDictionaryCacheForTests();
    vi.restoreAllMocks();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps data and reuses cache for repeated lookup", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          exists: true,
          word: "hạnh phúc",
          results: [
            {
              lang_code: "vi",
              meanings: [
                {
                  definition: "trạng thái sung sướng",
                  definition_lang: "vi",
                  example: "gia đình hạnh phúc",
                  pos: "Danh từ",
                  source: "TVTD",
                },
                {
                  definition: "happy",
                  definition_lang: "en",
                  pos: "Tính từ",
                  source: "Wiktionary EN",
                },
              ],
              pronunciations: [{ ipa: "[han˨˩˨ fʊwk͡p̚˦˥]", region: "Saigon" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const firstResult = await lookupVietnameseVietnameseDictionary("hạnh phúc");
    const secondResult = await lookupVietnameseVietnameseDictionary("hạnh   phúc");

    expect(firstResult.status).toBe("success");
    expect(firstResult.source).toBe("minhqnd");
    expect(firstResult.word).toBe("hạnh phúc");
    expect(firstResult.meanings).toHaveLength(1);
    expect(firstResult.meanings[0]?.definitionLang).toBe("vi");
    expect(firstResult.pronunciations).toHaveLength(1);
    expect(secondResult).toEqual(firstResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty result for blank input without network call", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await lookupVietnameseVietnameseDictionary("   ");

    expect(result.status).toBe("empty");
    expect(result.source).toBe("minhqnd");
    expect(result.meanings).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when dictionary endpoint responds with error", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("server error", { status: 503 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lookupVietnameseVietnameseDictionary("hạnh phúc")).rejects.toThrow(
      "Từ điển Việt-Việt trả lỗi (503).",
    );
  });

  it("propagates AbortError when signal is canceled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }

          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = lookupVietnameseVietnameseDictionary("hạnh phúc", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
