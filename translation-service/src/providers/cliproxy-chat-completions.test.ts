import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function setCliproxyEnv() {
  process.env.TRANSLATION_PROVIDER = "cliproxy";
  process.env.CLIPROXY_BASE_URL = "http://69.87.219.202:8317";
  process.env.CLIPROXY_API_KEY = "test-key";
  process.env.CLIPROXY_TIMEOUT_MS = "5000";
  process.env.CLIPROXY_MAX_RETRIES = "0";
}

describe("CliproxyChatCompletionsProvider", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setCliproxyEnv();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("builds a translation-oriented prompt and returns normalized translated text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ban dich sach" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const { CliproxyChatCompletionsProvider } = await import("./cliproxy-chat-completions.js");
    const provider = new CliproxyChatCompletionsProvider();

    const result = await provider.translate({
      text: "Source text",
      model: "gemini-3-flash-preview",
      targetLang: "Vietnamese",
      style: "literary",
      glossary: "hero -> anh hung",
      instructions: "Keep the tone warm.",
      pageId: 12,
      bookName: "My Book",
      requestId: "req-2",
      jobId: "job-2",
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body));

    expect(payload.model).toBe("gemini-3-flash-preview");
    expect(payload.messages[0].content).toContain("Return only the translated text.");
    expect(payload.messages[1].content).toContain("Target language: Vietnamese");
    expect(payload.messages[1].content).toContain("Glossary:");
    expect(payload.messages[1].content).toContain("hero -> anh hung");
    expect(payload.messages[1].content).toContain("Keep the tone warm.");
    expect(result.translatedText).toBe("Ban dich sach");
  });
});
