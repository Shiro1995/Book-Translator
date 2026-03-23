import { TranslationSettings } from "../types";

interface TranslateApiResponse {
  translatedText?: string;
  error?: string;
  details?: unknown;
  status?: number;
  webhookUrl?: string;
  code?: string;
}

const PRIMARY_MODEL = "gemini-2.5-pro";
const SECONDARY_MODEL = "gemini-3-flash-preview";
const TERTIARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = [SECONDARY_MODEL, TERTIARY_MODEL] as const;
const PRIMARY_MODEL_RETRY_INTERVAL_MS = 60_000;

let lastPrimaryModelFailureAt: number | null = null;

function canRetryPrimaryModel(now = Date.now()) {
  return (
    lastPrimaryModelFailureAt === null ||
    now - lastPrimaryModelFailureAt >= PRIMARY_MODEL_RETRY_INTERVAL_MS
  );
}

function buildModelsToTry(requestedModel: string, now = Date.now()) {
  if (canRetryPrimaryModel(now)) {
    return [PRIMARY_MODEL, ...FALLBACK_MODELS, requestedModel].filter(
      (model, index, list) => Boolean(model) && list.indexOf(model) === index,
    );
  }

  return [
    requestedModel === PRIMARY_MODEL ? SECONDARY_MODEL : requestedModel,
    ...FALLBACK_MODELS,
  ].filter((model, index, list) => Boolean(model) && list.indexOf(model) === index);
}

export interface TranslationResult {
  translatedText: string;
  usedModel: string;
  attemptedModels: string[];
}

export class TranslationService {
  async translatePage(
    text: string,
    settings: TranslationSettings,
    options?: { onModelChange?: (model: string) => void },
  ): Promise<TranslationResult> {
    const modelsToTry = buildModelsToTry(settings.model);
    let lastError: Error | null = null;
    const attemptedModels: string[] = [];

    for (const model of modelsToTry.slice(0, 3)) {
      options?.onModelChange?.(model);
      attemptedModels.push(model);

      try {
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
          if (model === PRIMARY_MODEL) {
            lastPrimaryModelFailureAt = null;
          }

          return {
            translatedText: data.translatedText,
            usedModel: model,
            attemptedModels,
          };
        }

        if (model === PRIMARY_MODEL) {
          lastPrimaryModelFailureAt = Date.now();
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
          data.code ? `code=${data.code}` : undefined,
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
      } catch (error) {
        if (model === PRIMARY_MODEL) {
          lastPrimaryModelFailureAt = Date.now();
        }

        const message = error instanceof Error ? error.message : "Translation request failed";
        lastError = new Error(`Translation failed | model=${model} | ${message}`);
      }
    }

    const attemptsSummary = attemptedModels.length
      ? `attemptedModels=${attemptedModels.join(" -> ")}`
      : undefined;

    const finalMessage = [lastError?.message ?? "Translation failed after 3 attempts", attemptsSummary]
      .filter(Boolean)
      .join(" | ");

    throw new Error(finalMessage);
  }
}

export const translationService = new TranslationService();
