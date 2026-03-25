/**
 * Extract translated text from arbitrary provider response payloads.
 */

interface ChatCompletionChoice {
  message?: {
    content?: unknown;
  };
  text?: unknown;
}

function normalizeStringContent(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";

      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        return record.text;
      }

      return "";
    })
    .join("")
    .trim();

  return parts.length > 0 ? parts : null;
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function extractChatCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? (record.choices as ChatCompletionChoice[]) : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  return (
    normalizeStringContent(firstChoice.message?.content) ??
    normalizeStringContent(firstChoice.text)
  );
}

/**
 * Recursively searches a payload for the translated text string.
 * Tries common key names first, then falls back to depth-first search.
 */
export function extractTranslatedText(payload: unknown, depth = 0): string | null {
  if (depth > 5 || payload == null) return null;

  const chatCompletionText = extractChatCompletionText(payload);
  if (chatCompletionText) return chatCompletionText;

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = extractTranslatedText(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const preferredKeys = [
    "translatedText",
    "translation",
    "translated_text",
    "output",
    "result",
    "text",
    "content",
    "message",
    "data",
  ];

  for (const key of preferredKeys) {
    if (!(key in record)) continue;
    const candidate = extractTranslatedText(record[key], depth + 1);
    if (candidate) return candidate;
  }

  for (const value of Object.values(record)) {
    const candidate = extractTranslatedText(value, depth + 1);
    if (candidate) return candidate;
  }

  return null;
}

export function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message.trim();
    }
    if (typeof errorRecord.code === "string" && errorRecord.code.trim()) {
      return errorRecord.code.trim();
    }
  }

  return extractTranslatedText(payload);
}
