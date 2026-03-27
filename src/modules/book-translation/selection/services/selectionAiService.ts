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
const SELECTION_AI_EMPTY_PAYLOAD_CODE = "E_SELECTION_AI_EMPTY_PAYLOAD";
const SELECTION_AI_INVALID_JSON_CODE = "E_SELECTION_AI_INVALID_JSON";
const QUICK_REQUEST_TEXT_MAX_LENGTH = 600;
const QUICK_REQUEST_CONTEXT_MAX_LENGTH = 100;
const FULL_REQUEST_CONTEXT_MAX_LENGTH = 240;
const FULL_REQUEST_PARAGRAPH_MAX_LENGTH = 900;
const FULL_REQUEST_PAGE_MAX_LENGTH = 900;
const FULL_REQUEST_TRANSLATION_MAX_LENGTH = 500;
const FULL_REQUEST_GLOSSARY_MAX_LENGTH = 600;
const FULL_REQUEST_INSTRUCTION_MAX_LENGTH = 260;
const QUICK_CONTEXT_TOKEN_PATTERN =
  /\b(it|this|that|these|those|they|them|he|she|her|his|its|their|there|here)\b/i;
const QUICK_CONTEXT_CONNECTOR_PATTERN = /^(and|or|but|with|for|to|of|in|on|at)\b/i;

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

function createSelectionAiError(message: string, code?: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function truncateForPayload(value: string | undefined, maxLength: number) {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function shouldIncludeQuickContext(selectedText: string) {
  const normalized = selectedText.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.length <= 24) {
    return true;
  }

  return (
    QUICK_CONTEXT_TOKEN_PATTERN.test(normalized) ||
    QUICK_CONTEXT_CONNECTOR_PATTERN.test(normalized.toLowerCase())
  );
}

function buildRequestPayload(
  request: SelectionAiRequest,
  model: string,
  endpoint: string,
  mode: SelectionAiRequestMode,
) {
  if (endpoint === LIGHT_SELECTION_ROUTE) {
    const includeContext = shouldIncludeQuickContext(request.selectedText);
    return {
      bookId: request.bookId,
      bookName: request.bookName,
      pageId: request.pageId,
      selectedText: truncateForPayload(request.selectedText, QUICK_REQUEST_TEXT_MAX_LENGTH),
      normalizedText: truncateForPayload(request.normalizedText, QUICK_REQUEST_TEXT_MAX_LENGTH),
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      model,
      glossary: "",
      instructions: "",
      beforeText: includeContext
        ? truncateForPayload(request.beforeText, QUICK_REQUEST_CONTEXT_MAX_LENGTH)
        : "",
      afterText: includeContext
        ? truncateForPayload(request.afterText, QUICK_REQUEST_CONTEXT_MAX_LENGTH)
        : "",
      contextHash: request.contextHash,
    };
  }

  const selectedTextLength = request.selectedText.trim().length;
  const includeParagraphContext = selectedTextLength >= 32;
  const includePageContext = selectedTextLength >= 96;
  const includeExistingTranslation = selectedTextLength >= 48;

  return {
    ...request,
    model,
    detailLevel: mode === "insights" ? "insights" : "quick",
    selectedText: truncateForPayload(request.selectedText, QUICK_REQUEST_TEXT_MAX_LENGTH),
    normalizedText: truncateForPayload(request.normalizedText, QUICK_REQUEST_TEXT_MAX_LENGTH),
    beforeText: truncateForPayload(request.beforeText, FULL_REQUEST_CONTEXT_MAX_LENGTH),
    afterText: truncateForPayload(request.afterText, FULL_REQUEST_CONTEXT_MAX_LENGTH),
    paragraphText: includeParagraphContext
      ? truncateForPayload(request.paragraphText, FULL_REQUEST_PARAGRAPH_MAX_LENGTH)
      : "",
    pageText: includePageContext
      ? truncateForPayload(request.pageText, FULL_REQUEST_PAGE_MAX_LENGTH)
      : "",
    existingTranslation: includeExistingTranslation
      ? truncateForPayload(request.existingTranslation, FULL_REQUEST_TRANSLATION_MAX_LENGTH)
      : "",
    glossary: truncateForPayload(request.glossary, FULL_REQUEST_GLOSSARY_MAX_LENGTH),
    instructions: truncateForPayload(request.instructions, FULL_REQUEST_INSTRUCTION_MAX_LENGTH),
  };
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
      const requestPayload = buildRequestPayload(request, model, endpoint, mode);
      const requestPayloadSizeChars = JSON.stringify(requestPayload).length;
      debugSelectionAi("attempt payload", {
        attempt: index + 1,
        model,
        endpoint,
        mode,
        requestPayloadSizeChars,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isTranslationTimingDebugEnabled()
            ? { [TRANSLATION_TIMING_DEBUG_HEADER]: "1" }
            : {}),
        },
        body: JSON.stringify(requestPayload),
        signal: options?.signal,
      });

      const attemptDurationMs = Math.round(performance.now() - attemptStartedAt);
      let payloadParseFailed = false;
      const payload = (await response
        .json()
        .catch(() => {
          payloadParseFailed = true;
          return {};
        })) as Partial<SelectionAiApiResponse>;

      if (!response.ok) {
        const error = createSelectionAiError(
          payload.error ?? `Khong the lay giai thich AI cho vung chon bang model ${model}.`,
          payload.code,
        );
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

      const translationNatural =
        typeof payload.translationNatural === "string" ? payload.translationNatural.trim() : "";
      if (payloadParseFailed || !translationNatural) {
        const error = createSelectionAiError(
          payloadParseFailed
            ? `Endpoint ${endpoint} tra du lieu khong phai JSON hop le.`
            : `Endpoint ${endpoint} tra payload khong co translationNatural.`,
          payloadParseFailed ? SELECTION_AI_INVALID_JSON_CODE : SELECTION_AI_EMPTY_PAYLOAD_CODE,
        );
        lastError = error;

        debugSelectionAi("attempt invalid payload", {
          attempt: index + 1,
          model,
          endpoint,
          mode,
          status: response.status,
          durationMs: attemptDurationMs,
          contentType: response.headers.get("content-type"),
          payloadParseFailed,
          payloadKeys: Object.keys(payload),
          error: error.message,
        });
        continue;
      }

      const detailLevel = endpoint === FULL_SELECTION_ROUTE ? "insights" : "quick";
      const isQuickDetail = detailLevel === "quick";
      const normalizedPayload: SelectionAiResult = {
        translationNatural,
        translationLiteral:
          !isQuickDetail && typeof payload.translationLiteral === "string"
            ? payload.translationLiteral.trim()
            : undefined,
        explanation:
          !isQuickDetail && typeof payload.explanation === "string" ? payload.explanation.trim() : undefined,
        alternatives: !isQuickDetail ? payload.alternatives ?? [] : [],
        glossaryApplied: !isQuickDetail ? payload.glossaryApplied ?? [] : [],
        warnings: !isQuickDetail ? payload.warnings ?? [] : [],
        segmentation: !isQuickDetail ? payload.segmentation ?? [] : [],
        confidence: !isQuickDetail ? payload.confidence : undefined,
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
