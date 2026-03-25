import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function setCliproxyEnv() {
  process.env.TRANSLATION_PROVIDER = "cliproxy";
  process.env.CLIPROXY_BASE_URL = "http://69.87.219.202:8317";
  process.env.CLIPROXY_API_KEY = "test-key";
}

describe("buildTranslationCacheKey", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setCliproxyEnv();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("keeps the FE model in the cache key", async () => {
    const { buildTranslationCacheKey } = await import("./translation.js");

    const baseInput = {
      text: "Source text",
      settings: {
        model: "gemini-3-flash-preview",
        targetLang: "Vietnamese",
        style: "natural" as const,
        glossary: "hero -> anh hung",
        instructions: "none",
      },
      pageId: 1,
      bookName: "Book",
    };

    const sameKey = buildTranslationCacheKey(baseInput);
    const differentLegacyModelKey = buildTranslationCacheKey({
      ...baseInput,
      settings: {
        ...baseInput.settings,
        model: "gemini-2.5-pro",
      },
    });
    const differentModelKey = buildTranslationCacheKey({
      ...baseInput,
      settings: {
        ...baseInput.settings,
        model: "gpt-4.1-mini",
      },
    });
    const differentGlossaryKey = buildTranslationCacheKey({
      ...baseInput,
      settings: {
        ...baseInput.settings,
        glossary: "hero -> nguoi hung",
      },
    });

    expect(buildTranslationCacheKey(baseInput)).toBe(sameKey);
    expect(differentLegacyModelKey).not.toBe(sameKey);
    expect(differentModelKey).not.toBe(sameKey);
    expect(differentGlossaryKey).not.toBe(sameKey);
  });
});
