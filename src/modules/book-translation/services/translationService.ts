import { TranslationSettings } from "../types";
import { normalizeUserFacingText } from "../utils/text";
import {
  isTranslationTimingDebugEnabled,
  TRANSLATION_TIMING_DEBUG_HEADER,
} from "./translationDebug";

interface TranslateApiResponse {
  translatedText?: string;
  error?: string;
  details?: unknown;
  status?: number;
  providerUrl?: string;
  code?: string;
}

const PRIMARY_MODEL = "gemini-3-flash-preview";
const SECONDARY_MODEL = "gemini-2.5-pro";
const TERTIARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = [SECONDARY_MODEL, TERTIARY_MODEL] as const;
const PRIMARY_MODEL_RETRY_INTERVAL_MS = 60_000;

let lastPrimaryModelFailureAt: number | null = null;

function debugTranslationFlow(message: string, meta?: Record<string, unknown>) {
  if (!isTranslationTimingDebugEnabled()) {
    return;
  }

  console.debug(`[page-translate] ${message}`, meta ?? {});
}

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
    const startedAt = performance.now();

    debugTranslationFlow("request start", {
      requestedModel: settings.model,
      modelsToTry: modelsToTry.slice(0, 3),
      textLength: text.length,
      targetLang: settings.targetLang,
      style: settings.style,
    });

    for (const [index, model] of modelsToTry.slice(0, 3).entries()) {
      options?.onModelChange?.(model);
      attemptedModels.push(model);
      const attemptStartedAt = performance.now();

      debugTranslationFlow("attempt start", {
        attempt: index + 1,
        model,
      });

      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isTranslationTimingDebugEnabled()
              ? { [TRANSLATION_TIMING_DEBUG_HEADER]: "1" }
              : {}),
          },
          body: JSON.stringify({
            text,
            settings: {
              ...settings,
              model,
            },
          }),
        });

        const attemptDurationMs = Math.round(performance.now() - attemptStartedAt);
        const data = (await response.json().catch(() => ({}))) as TranslateApiResponse;

        if (response.ok && data.translatedText) {
          if (model === PRIMARY_MODEL) {
            lastPrimaryModelFailureAt = null;
          }

          debugTranslationFlow("attempt succeeded", {
            attempt: index + 1,
            model,
            status: response.status,
            durationMs: attemptDurationMs,
            totalDurationMs: Math.round(performance.now() - startedAt),
            translatedLength: data.translatedText.length,
          });

          return {
            translatedText: normalizeUserFacingText(data.translatedText),
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
          data.providerUrl ? `provider=${data.providerUrl}` : undefined,
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
        debugTranslationFlow("attempt failed", {
          attempt: index + 1,
          model,
          status: response.status,
          durationMs: attemptDurationMs,
          code: data.code,
          error: message,
        });
      } catch (error) {
        if (model === PRIMARY_MODEL) {
          lastPrimaryModelFailureAt = Date.now();
        }

        const message = error instanceof Error ? error.message : "Translation request failed";
        lastError = new Error(`Translation failed | model=${model} | ${message}`);
        debugTranslationFlow("attempt failed", {
          attempt: index + 1,
          model,
          durationMs: Math.round(performance.now() - attemptStartedAt),
          error: lastError.message,
        });
      }
    }

    const attemptsSummary = attemptedModels.length
      ? `attemptedModels=${attemptedModels.join(" -> ")}`
      : undefined;

    const finalMessage = [lastError?.message ?? "Translation failed after 3 attempts", attemptsSummary]
      .filter(Boolean)
      .join(" | ");

    debugTranslationFlow("request failed", {
      attemptedModels,
      totalDurationMs: Math.round(performance.now() - startedAt),
      error: finalMessage,
    });

    throw new Error(finalMessage);
  }
}

export const translationService = new TranslationService();
