import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function setCliproxyEnv() {
  process.env.TRANSLATION_PROVIDER = "cliproxy";
  process.env.CLIPROXY_BASE_URL = "http://69.87.219.202:8317";
  process.env.CLIPROXY_API_KEY = "test-key";
  process.env.CLIPROXY_TIMEOUT_MS = "5000";
  process.env.CLIPROXY_MAX_RETRIES = "1";
}

describe("CliproxyChatCompletionsClient", () => {
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

  it("sends an OpenAI-compatible chat completions request and preserves the FE model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "temporary" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Ban dich cuoi cung" } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { cliproxyChatCompletionsClient } = await import("./chat-completions.js");
    const result = await cliproxyChatCompletionsClient.createCompletion({
      feature: "test",
      model: "gemini-3-flash-preview",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
      temperature: 0.1,
      maxTokens: 256,
      requestId: "req-1",
      jobId: "job-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://69.87.219.202:8317/v1/chat/completions");

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((requestInit.headers as Record<string, string>).Authorization).toBe("Bearer test-key");

    const payload = JSON.parse(String(requestInit.body));
    expect(payload).toMatchObject({
      model: "gemini-3-flash-preview",
      temperature: 0.1,
      max_tokens: 256,
      stream: false,
    });
    expect(payload.messages).toHaveLength(2);
    expect(result.messageText).toBe("Ban dich cuoi cung");
  });

  it("throws a malformed response error when choices[0].message.content is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const { cliproxyChatCompletionsClient } = await import("./chat-completions.js");

    await expect(
      cliproxyChatCompletionsClient.createCompletion({
        feature: "test",
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: "E_PROVIDER_MALFORMED_RESPONSE",
    });
  });
});
