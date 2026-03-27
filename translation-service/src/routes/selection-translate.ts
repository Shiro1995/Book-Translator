/**
 * Selection Translate route - lightweight translation for popup selections.
 *
 * POST /api/selection-translate -> concise translation-oriented analysis
 */

import { Router, type Request, type Response } from "express";
import { cliproxyChatCompletionsClient } from "../lib/chat-completions.js";
import { safeJsonParse } from "../lib/extract.js";
import { logger } from "../lib/logger.js";
import { normalizeUserFacingText } from "../lib/text.js";
import {
  ProviderError,
  isProviderError,
  providerErrorToHttpStatus,
} from "../lib/provider-errors.js";
import { DEBUG_TRANSLATION_TIMING_HEADER, isDebugTranslationTimingEnabled } from "../lib/translation-debug.js";
import { isVietnameseTarget } from "../lib/vietnamese.js";

const router = Router();

interface SelectionTranslateRequestBody {
  bookId?: string;
  bookName?: string;
  pageId?: number;
  selectedText?: string;
  normalizedText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  model?: string;
  glossary?: string;
  instructions?: string;
  beforeText?: string;
  afterText?: string;
  contextHash?: string;
}

interface SelectionTranslateResponse {
  translationNatural: string;
  alternatives: [];
  glossaryApplied: [];
  warnings: string[];
  segmentation: [];
  confidence?: number;
  source: "api" | "fallback";
}

const AMBIGUOUS_TOKEN_PATTERN =
  /\b(it|this|that|these|those|they|them|he|she|her|his|its|their|there|here|you|we|our|my|your)\b/i;
const LEADING_CONNECTOR_PATTERN = /^(and|or|but|with|for|to|of|in|on|at)\b/i;

function truncateForPrompt(value: string | undefined, maxLength = 400) {
  const normalized = (value ?? "").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizeKnownSelectionTypos(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.replace(/\ba\u1ecb\b/giu, (match) => {
    if (match === match.toUpperCase()) return "AI";
    if (match === match.toLowerCase()) return "ai";
    return "Ai";
  });
}

function shouldIncludeContext(body: SelectionTranslateRequestBody) {
  const selectedText = (body.selectedText ?? "").trim();
  if (!selectedText) {
    return false;
  }

  if (selectedText.length <= 24) {
    return true;
  }

  return (
    AMBIGUOUS_TOKEN_PATTERN.test(selectedText) ||
    LEADING_CONNECTOR_PATTERN.test(selectedText.toLowerCase())
  );
}

function estimateSelectionTranslateMaxTokens(body: SelectionTranslateRequestBody) {
  const selectedTextLength = body.selectedText?.trim().length ?? 0;
  const includeContext = shouldIncludeContext(body);

  const estimated = Math.round(
    60 +
      selectedTextLength * 0.8 +
      (includeContext ? 16 : 0),
  );
  return Math.max(72, Math.min(140, estimated));
}

function extractJsonFromText(raw: string): unknown {
  const direct = safeJsonParse(raw);
  if (typeof direct === "object" && direct !== null) return direct;

  const codeBlockMatch = raw.match(/```json\s*([\s\S]+?)```/i) ?? raw.match(/```\s*([\s\S]+?)```/i);
  if (codeBlockMatch?.[1]) {
    const blockParsed = safeJsonParse(codeBlockMatch[1].trim());
    if (typeof blockParsed === "object" && blockParsed !== null) return blockParsed;
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const objectParsed = safeJsonParse(raw.slice(firstBrace, lastBrace + 1));
    if (typeof objectParsed === "object" && objectParsed !== null) return objectParsed;
  }

  return null;
}

function normalizeSelectionTranslatePayload(payload: unknown): SelectionTranslateResponse | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const translationNatural =
    typeof record.translationNatural === "string"
      ? normalizeUserFacingText(record.translationNatural).trim()
      : typeof record.translation === "string"
        ? normalizeUserFacingText(record.translation).trim()
        : "";

  if (!translationNatural) return null;

  return {
    translationNatural,
    alternatives: [],
    glossaryApplied: [],
    warnings: [],
    segmentation: [],
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    source: "api",
  };
}

function buildSelectionTranslateMessages(body: SelectionTranslateRequestBody) {
  const includeContext = shouldIncludeContext(body);
  const systemPrompt = [
    "Translate selected text into the target language.",
    "Return ONLY valid JSON. No markdown, no explanation outside JSON.",
    "Use one JSON object with key: translationNatural.",
    "If target language is Vietnamese, use proper Vietnamese diacritics.",
  ].join(" ");

  const compactBefore = truncateForPrompt(body.beforeText, 60);
  const compactAfter = truncateForPrompt(body.afterText, 60);
  const mergedContext = [compactBefore, compactAfter].filter(Boolean).join(" ... ");

  const userPrompt = [
    `Target: ${body.targetLanguage ?? "Vietnamese"}`,
    body.sourceLanguage?.trim() && body.sourceLanguage !== "unknown"
      ? `Source: ${body.sourceLanguage}`
      : "",
    `Text: ${body.selectedText ?? ""}`,
    includeContext && mergedContext ? `Context: ${mergedContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ],
    promptMeta: {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      includeContext,
      contextLength: includeContext && mergedContext ? mergedContext.length : 0,
      estimatedInputTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
    },
  };
}

function buildFallbackResponse(translatedText: string): SelectionTranslateResponse {
  return {
    translationNatural: normalizeUserFacingText(translatedText).trim(),
    alternatives: [],
    glossaryApplied: [],
    warnings: [],
    segmentation: [],
    source: "fallback",
  };
}

router.post("/", async (req: Request<object, object, SelectionTranslateRequestBody>, res: Response) => {
  const debugTiming = isDebugTranslationTimingEnabled(req.header(DEBUG_TRANSLATION_TIMING_HEADER));
  const startedAt = debugTiming ? Date.now() : 0;
  const normalizedRequestBody: SelectionTranslateRequestBody = {
    ...req.body,
    selectedText: normalizeKnownSelectionTypos(req.body?.selectedText),
    normalizedText: normalizeKnownSelectionTypos(req.body?.normalizedText),
    beforeText: normalizeKnownSelectionTypos(req.body?.beforeText),
    afterText: normalizeKnownSelectionTypos(req.body?.afterText),
  };
  const targetLanguage = normalizedRequestBody.targetLanguage?.trim() || "Vietnamese";
  const selectedText = normalizedRequestBody.selectedText?.trim();
  if (!selectedText) {
    return res.status(400).json({ error: "Missing selected text" });
  }

  const model = normalizedRequestBody.model?.trim();
  if (!model) {
    return res.status(400).json({ error: "Missing model" });
  }

  const instructionsForRequest = [
    normalizedRequestBody.instructions?.trim() ?? "",
    isVietnameseTarget(targetLanguage)
      ? "If you answer in Vietnamese, use full Vietnamese diacritics."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const selectionTranslatePrompt = buildSelectionTranslateMessages({
    ...normalizedRequestBody,
    instructions: instructionsForRequest,
  });
  const maxTokens = estimateSelectionTranslateMaxTokens({
    ...normalizedRequestBody,
    instructions: instructionsForRequest,
  });
  const routePayloadForDebug = {
    ...normalizedRequestBody,
    instructions: instructionsForRequest,
  };
  const providerPayloadForDebug = {
    model,
    messages: selectionTranslatePrompt.messages,
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
  };
  const routePayloadSizeChars = JSON.stringify(routePayloadForDebug).length;
  const providerPayloadSizeChars = JSON.stringify(providerPayloadForDebug).length;

  if (debugTiming) {
    logger.info("Selection translate request started", {
      requestId: req.requestId,
      model,
      pageId: normalizedRequestBody.pageId,
      selectedTextLength: selectedText.length,
      normalizedTextLength: normalizedRequestBody.normalizedText?.trim().length ?? 0,
      beforeTextLength: normalizedRequestBody.beforeText?.length ?? 0,
      afterTextLength: normalizedRequestBody.afterText?.length ?? 0,
      glossaryLength: normalizedRequestBody.glossary?.length ?? 0,
      instructionsLength: instructionsForRequest.length,
      maxTokens,
      routePayloadSizeChars,
      providerPayloadSizeChars,
      routePayload: routePayloadForDebug,
      providerPayload: providerPayloadForDebug,
      ...selectionTranslatePrompt.promptMeta,
    });
  }

  try {
    const completion = await cliproxyChatCompletionsClient.createCompletion({
      feature: "selection-translate",
      model,
      messages: selectionTranslatePrompt.messages,
      temperature: 0,
      maxTokens,
      requestId: req.requestId,
      debugTiming,
    });

    const structuredPayload =
      normalizeSelectionTranslatePayload(completion.parsedBody) ??
      normalizeSelectionTranslatePayload(extractJsonFromText(completion.messageText));

    if (structuredPayload) {
      if (debugTiming) {
        logger.info("Selection translate request completed", {
          requestId: req.requestId,
          model,
          pageId: normalizedRequestBody.pageId,
          source: structuredPayload.source,
          providerDurationMs: completion.durationMs,
          totalDurationMs: Date.now() - startedAt,
        });
      }
      return res.json(structuredPayload);
    }

    if (debugTiming) {
      logger.warn("Selection translate request fell back", {
        requestId: req.requestId,
        model,
        pageId: normalizedRequestBody.pageId,
        providerDurationMs: completion.durationMs,
        totalDurationMs: Date.now() - startedAt,
      });
    }

    return res.json(buildFallbackResponse(completion.messageText || selectedText));
  } catch (error) {
    const providerError = isProviderError(error)
      ? error
      : new ProviderError(
        "E_PROVIDER_UNAVAILABLE",
        error instanceof Error ? error.message : "Unknown provider error",
      );

    logger.error("Selection translate provider error", {
      requestId: req.requestId,
      code: providerError.code,
      error: providerError.message,
      ...(debugTiming ? { totalDurationMs: Date.now() - startedAt } : {}),
    });

    return res.status(providerErrorToHttpStatus(providerError)).json({
      code: providerError.code,
      error: "Failed to process selection translate",
      details: providerError.message,
    });
  }
});

export default router;
