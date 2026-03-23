import { TranslationSettings } from "../types";

interface TranslateApiResponse {
  translatedText?: string;
  error?: string;
  details?: unknown;
  status?: number;
  webhookUrl?: string;
}

const FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;

export class TranslationService {
  async translatePage(text: string, settings: TranslationSettings): Promise<string> {
    const modelsToTry = [settings.model, ...FALLBACK_MODELS].filter(
      (model, index, list) => Boolean(model) && list.indexOf(model) === index,
    );
    let lastError: Error | null = null;

    for (const model of modelsToTry.slice(0, 3)) {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          settings: {
            ...settings,
            model,
          },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as TranslateApiResponse;

      if (response.ok && data.translatedText) {
        return data.translatedText;
      }

      const detailText =
        typeof data.details === "string"
          ? data.details
          : data.details
            ? JSON.stringify(data.details)
            : undefined;
      const extra = [
        `model=${model}`,
        data.status ? `status=${data.status}` : undefined,
        data.webhookUrl ? `webhook=${data.webhookUrl}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
      const message = [
        data.error ?? "Translation failed",
        detailText,
        extra || undefined,
      ]
        .filter(Boolean)
        .join(" | ");

      lastError = new Error(message);
    }

    throw lastError ?? new Error("Translation failed after 3 attempts");
  }
}

export const translationService = new TranslationService();
