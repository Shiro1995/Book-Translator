import { TranslationSettings } from "../types";

interface TranslateApiResponse {
  translatedText?: string;
  error?: string;
  details?: unknown;
  status?: number;
  webhookUrl?: string;
}

export class TranslationService {
  async translatePage(text: string, settings: TranslationSettings): Promise<string> {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        settings,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as TranslateApiResponse;

    if (!response.ok) {
      const detailText =
        typeof data.details === "string"
          ? data.details
          : data.details
            ? JSON.stringify(data.details)
            : undefined;
      const extra = [
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
      throw new Error(message);
    }

    if (!data.translatedText) {
      throw new Error("Webhook returned empty translation");
    }

    return data.translatedText;
  }
}

export const translationService = new TranslationService();
