import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("translation-service config", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TRANSLATION_PROVIDER: "cliproxy",
      CLIPROXY_BASE_URL: "",
      CLIPROXY_API_KEY: "",
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("reports missing Cliproxy configuration", async () => {
    const { isTranslationProviderConfigured, validateConfig } = await import("./index.js");

    expect(isTranslationProviderConfigured()).toBe(false);
    expect(validateConfig()).toEqual(
      expect.arrayContaining([
        "CLIPROXY_BASE_URL is not set - translation requests will fail",
        "CLIPROXY_API_KEY is not set - provider authentication will fail",
      ]),
    );
  });
});
