import type { SelectionAiRequest, SelectionAiResult } from "../types";

interface SelectionAiApiResponse extends SelectionAiResult {
  error?: string;
  code?: string;
}

const selectionAiCache = new Map<string, SelectionAiResult>();
const PREFERRED_SELECTION_AI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
] as const;

function buildSelectionAiCacheKey(request: SelectionAiRequest) {
  return [
    request.bookId,
    request.pageId,
    request.normalizedText,
    request.sourceLanguage ?? "",
    request.targetLanguage,
    request.contextHash,
  ].join("::");
}

function buildModelsToTry() {
  return [...PREFERRED_SELECTION_AI_MODELS];
}

export async function requestSelectionAiInsights(
  request: SelectionAiRequest,
  options?: { signal?: AbortSignal },
) {
  const cacheKey = buildSelectionAiCacheKey(request);
  const cached = selectionAiCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let lastError: Error | null = null;

  for (const model of buildModelsToTry()) {
    const response = await fetch("/api/selection-insights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        model,
      }),
      signal: options?.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as Partial<SelectionAiApiResponse>;
    if (!response.ok) {
      const error = new Error(
        payload.error ?? `Không thể lấy giải thích AI cho vùng chọn bằng model ${model}.`,
      );
      (error as Error & { code?: string }).code = payload.code;
      lastError = error;
      continue;
    }

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
    };

    selectionAiCache.set(cacheKey, normalizedPayload);
    return normalizedPayload;
  }

  throw lastError ?? new Error("Không thể lấy giải thích AI cho vùng chọn.");
}
