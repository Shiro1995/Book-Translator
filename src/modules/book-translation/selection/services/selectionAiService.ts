import type { SelectionAiRequest, SelectionAiResult } from "../types";
import {
  isTranslationTimingDebugEnabled,
  TRANSLATION_TIMING_DEBUG_HEADER,
} from "../../services/translationDebug";

interface SelectionAiApiResponse extends SelectionAiResult {
  error?: string;
  code?: string;
}

type SelectionAiRequestMode = "auto" | "quick" | "insights";

interface RequestSelectionAiInsightsOptions {
  signal?: AbortSignal;
  mode?: SelectionAiRequestMode;
}

const selectionAiCache = new Map<string, SelectionAiResult>();
export const POPUP_SELECTION_AI_PRIMARY_MODEL = "gemini-2.5-flash";
const POPUP_SELECTION_AI_FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
] as const;
const LIGHT_SELECTION_ROUTE = "/api/selection-translate";
const FULL_SELECTION_ROUTE = "/api/selection-insights";
const LIGHT_SELECTION_MAX_CHARS = 220;
const ENDPOINT_FALLBACK_STATUSES = new Set([404, 405, 501]);

function debugSelectionAi(message: string, meta?: Record<string, unknown>) {
  if (!isTranslationTimingDebugEnabled()) {
    return;
  }

  console.debug(`[selection-ai] ${message}`, meta ?? {});
}

function buildSelectionAiCacheKey(request: SelectionAiRequest, endpoint: string) {
  return [
    request.bookId,
    request.pageId,
    request.normalizedText,
    request.sourceLanguage ?? "",
    request.targetLanguage,
    request.contextHash,
    endpoint,
  ].join("::");
}

function buildModelsToTry(requestedModel: string) {
  return [requestedModel || POPUP_SELECTION_AI_PRIMARY_MODEL, ...POPUP_SELECTION_AI_FALLBACK_MODELS].filter(
    (model, index, list) => Boolean(model) && list.indexOf(model) === index,
  );
}

function resolveSelectionAiEndpoint(request: SelectionAiRequest) {
  const selectedText = request.selectedText.trim();
  const looksCompactSelection =
    selectedText.length > 0 &&
    selectedText.length <= LIGHT_SELECTION_MAX_CHARS &&
    !selectedText.includes("\n");

  return looksCompactSelection ? LIGHT_SELECTION_ROUTE : FULL_SELECTION_ROUTE;
}

function buildEndpointsToTry(request: SelectionAiRequest, mode: SelectionAiRequestMode) {
  if (mode === "insights") {
    return [FULL_SELECTION_ROUTE];
  }

  if (mode === "quick") {
    return [LIGHT_SELECTION_ROUTE, FULL_SELECTION_ROUTE];
  }

  const primaryEndpoint = resolveSelectionAiEndpoint(request);
  return primaryEndpoint === LIGHT_SELECTION_ROUTE
    ? [LIGHT_SELECTION_ROUTE, FULL_SELECTION_ROUTE]
    : [FULL_SELECTION_ROUTE];
}

export async function requestSelectionAiInsights(
  request: SelectionAiRequest,
  options?: RequestSelectionAiInsightsOptions,
) {
  const startedAt = performance.now();
  const mode = options?.mode ?? "auto";
  const modelsToTry = buildModelsToTry(request.model);
  const endpointsToTry = buildEndpointsToTry(request, mode);
  const primaryEndpoint = endpointsToTry[0];
  const primaryCacheKey = buildSelectionAiCacheKey(request, primaryEndpoint);
  const cached = selectionAiCache.get(primaryCacheKey);

  if (cached) {
    debugSelectionAi("cache hit", {
      cacheKey: primaryCacheKey,
      mode,
      endpoint: primaryEndpoint,
      pageId: request.pageId,
      targetLanguage: request.targetLanguage,
      selectedTextLength: request.selectedText.length,
      detailLevel: cached.detailLevel,
    });
    return cached;
  }

  let lastError: Error | null = null;

  debugSelectionAi("request start", {
    mode,
    endpointsToTry,
    pageId: request.pageId,
    requestedModel: request.model,
    targetLanguage: request.targetLanguage,
    selectedTextLength: request.selectedText.length,
    normalizedTextLength: request.normalizedText.length,
    contextHash: request.contextHash,
    modelsToTry,
  });

  for (const [index, model] of modelsToTry.entries()) {
    for (const endpoint of endpointsToTry) {
      const attemptStartedAt = performance.now();

      debugSelectionAi("attempt start", {
        attempt: index + 1,
        model,
        endpoint,
        mode,
        pageId: request.pageId,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isTranslationTimingDebugEnabled()
            ? { [TRANSLATION_TIMING_DEBUG_HEADER]: "1" }
            : {}),
        },
        body: JSON.stringify({
          ...request,
          model,
        }),
        signal: options?.signal,
      });

      const attemptDurationMs = Math.round(performance.now() - attemptStartedAt);
      const payload = (await response.json().catch(() => ({}))) as Partial<SelectionAiApiResponse>;

      if (!response.ok) {
        const error = new Error(
          payload.error ?? `Khong the lay giai thich AI cho vung chon bang model ${model}.`,
        );
        (error as Error & { code?: string }).code = payload.code;
        lastError = error;

        debugSelectionAi("attempt failed", {
          attempt: index + 1,
          model,
          endpoint,
          mode,
          status: response.status,
          durationMs: attemptDurationMs,
          code: payload.code,
          error: error.message,
        });

        if (endpoint === LIGHT_SELECTION_ROUTE && ENDPOINT_FALLBACK_STATUSES.has(response.status)) {
          continue;
        }

        break;
      }

      const detailLevel = endpoint === FULL_SELECTION_ROUTE ? "insights" : "quick";
      const normalizedPayload: SelectionAiResult = {
        translationNatural: payload.translationNatural ?? "",
        translationLiteral: payload.translationLiteral,
        explanation: payload.explanation,
        alternatives: payload.alternatives ?? [],
        glossaryApplied: payload.glossaryApplied ?? [],
        warnings: payload.warnings ?? [],
        segmentation: payload.segmentation ?? [],
        confidence: payload.confidence,
        source: payload.source ?? "fallback",
        detailLevel,
      };

      const endpointCacheKey = buildSelectionAiCacheKey(request, endpoint);
      selectionAiCache.set(endpointCacheKey, normalizedPayload);
      selectionAiCache.set(primaryCacheKey, normalizedPayload);

      debugSelectionAi("attempt succeeded", {
        attempt: index + 1,
        model,
        endpoint,
        mode,
        status: response.status,
        durationMs: attemptDurationMs,
        totalDurationMs: Math.round(performance.now() - startedAt),
        source: normalizedPayload.source,
        detailLevel,
        hasExplanation: Boolean(normalizedPayload.explanation),
        alternativesCount: normalizedPayload.alternatives.length,
      });
      return normalizedPayload;
    }
  }

  debugSelectionAi("request failed", {
    mode,
    endpointsToTry,
    totalDurationMs: Math.round(performance.now() - startedAt),
    attemptedModels: modelsToTry,
    error: lastError?.message ?? "Unknown error",
  });

  throw lastError ?? new Error("Khong the lay giai thich AI cho vung chon.");
}
