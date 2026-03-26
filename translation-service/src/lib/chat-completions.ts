import { config } from "../config/index.js";
import { extractChatCompletionText, extractErrorMessage, safeJsonParse } from "./extract.js";
import { logger } from "./logger.js";
import { ProviderError } from "./provider-errors.js";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatCompletionRequest {
  feature: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  jobId?: string;
  debugTiming?: boolean;
}

export interface ChatCompletionResult {
  model: string;
  messageText: string;
  parsedBody: unknown;
  rawBody: string;
  status: number;
  durationMs: number;
}

export function resolveChatCompletionModel(requestedModel?: string) {
  const normalizedRequestedModel = requestedModel?.trim() ?? "";

  return normalizedRequestedModel;
}

function buildChatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (!trimmed) return "";
  if (trimmed.endsWith("/v1/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isRetriableStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number) {
  return Math.min(2_000, 250 * 2 ** attempt);
}

function createHttpError(status: number, details: string | null) {
  if (status === 401 || status === 403) {
    return new ProviderError(
      "E_PROVIDER_AUTH",
      `Cliproxy authentication failed (status=${status})`,
      { status },
    );
  }

  if (status === 400 || status === 404 || status === 409 || status === 422) {
    const suffix = details ? `: ${details}` : "";
    return new ProviderError(
      "E_PROVIDER_BAD_REQUEST",
      `Cliproxy rejected the request${suffix} (status=${status})`,
      { status },
    );
  }

  const suffix = details ? `: ${details}` : "";
  return new ProviderError(
    "E_PROVIDER_UNAVAILABLE",
    `Cliproxy provider unavailable${suffix} (status=${status})`,
    { status, retriable: isRetriableStatus(status) },
  );
}

function normalizeFetchError(error: unknown) {
  if (error instanceof ProviderError) {
    return error;
  }

  if (isTimeoutError(error)) {
    return new ProviderError(
      "E_PROVIDER_TIMEOUT",
      `Cliproxy request timed out after ${config.cliproxyTimeoutMs}ms`,
      { retriable: true, cause: error },
    );
  }

  if (error instanceof TypeError) {
    return new ProviderError(
      "E_PROVIDER_NETWORK",
      "Cliproxy network request failed",
      { retriable: true, cause: error },
    );
  }

  const message = error instanceof Error ? error.message : "Unknown provider error";
  return new ProviderError("E_PROVIDER_UNAVAILABLE", message, { cause: error });
}

export class CliproxyChatCompletionsClient {
  async createCompletion(input: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const endpoint = buildChatCompletionsUrl(config.cliproxyBaseUrl);
    const apiKey = config.cliproxyApiKey.trim();
    const model = resolveChatCompletionModel(input.model);

    if (!endpoint) {
      throw new ProviderError(
        "E_PROVIDER_CONFIG",
        "CLIPROXY_BASE_URL is not configured",
      );
    }

    if (!apiKey) {
      throw new ProviderError(
        "E_PROVIDER_CONFIG",
        "CLIPROXY_API_KEY is not configured",
      );
    }

    if (!model) {
      throw new ProviderError(
        "E_PROVIDER_BAD_REQUEST",
        "Missing model in request",
      );
    }

    const requestBody = {
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens,
      stream: false,
    };

    let lastError: ProviderError | null = null;

    for (let attempt = 0; attempt <= config.cliproxyMaxRetries; attempt += 1) {
      const attemptNumber = attempt + 1;
      const attemptStartedAt = Date.now();
      const sentAt = new Date(attemptStartedAt).toISOString();

      if (input.debugTiming) {
        logger.info("Cliproxy request started", {
          feature: input.feature,
          provider: "cliproxy",
          model,
          requestId: input.requestId,
          jobId: input.jobId,
          attempt: attemptNumber,
          endpoint,
          sentAt,
          payload: requestBody,
        });
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(config.cliproxyTimeoutMs),
        });

        const rawBody = await response.text();
        const parsedBody = safeJsonParse(rawBody);
        const durationMs = Date.now() - attemptStartedAt;
        const responseAt = new Date().toISOString();

        if (input.debugTiming) {
          logger.info("Cliproxy request completed", {
            feature: input.feature,
            provider: "cliproxy",
            model,
            requestId: input.requestId,
            jobId: input.jobId,
            attempt: attemptNumber,
            status: response.status,
            sentAt,
            responseAt,
            durationMs,
          });
        }

        if (!response.ok) {
          throw createHttpError(response.status, extractErrorMessage(parsedBody) ?? rawBody.slice(0, 300));
        }

        const messageText = extractChatCompletionText(parsedBody);
        if (!messageText) {
          throw new ProviderError(
            "E_PROVIDER_MALFORMED_RESPONSE",
            "Cliproxy returned no choices[0].message.content",
            { status: response.status },
          );
        }

        return {
          model,
          messageText,
          parsedBody,
          rawBody,
          status: response.status,
          durationMs,
        };
      } catch (error) {
        const durationMs = Date.now() - attemptStartedAt;
        const responseAt = new Date().toISOString();
        const providerError = normalizeFetchError(error);
        lastError = providerError;

        if (!providerError.retriable || attempt >= config.cliproxyMaxRetries) {
          throw providerError;
        }

        if (input.debugTiming) {
          logger.warn("Retrying Cliproxy request", {
            feature: input.feature,
            provider: "cliproxy",
            model,
            requestId: input.requestId,
            jobId: input.jobId,
            attempt: attemptNumber,
            nextAttempt: attemptNumber + 1,
            code: providerError.code,
            message: providerError.message,
            sentAt,
            responseAt,
            durationMs,
          });
        }

        await sleep(getRetryDelayMs(attempt));
      }
    }

    throw lastError ?? new ProviderError("E_PROVIDER_UNAVAILABLE", "Cliproxy request failed");
  }
}

export const cliproxyChatCompletionsClient = new CliproxyChatCompletionsClient();
