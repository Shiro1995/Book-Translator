/**
 * Extract translated text from arbitrary n8n/provider response payloads.
 * Extracted from server.ts for reuse.
 */

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Recursively searches a payload for the translated text string.
 * Tries common key names first (translatedText, translation, output, etc.),
 * then falls back to depth-first search of all values.
 */
export function extractTranslatedText(payload: unknown, depth = 0): string | null {
  if (depth > 5 || payload == null) return null;

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
