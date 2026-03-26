/**
 * Selection Insights route - AI-powered analysis of selected text.
 *
 * POST /api/selection-insights -> structured AI analysis
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

interface SelectionInsightsRequestBody {
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
  paragraphText?: string;
  pageText?: string;
  existingTranslation?: string;
  documentMetadata?: {
    title?: string;
    genre?: string;
    domain?: string;
  };
  contextHash?: string;
  customInstructions?: string;
}

interface SelectionInsightAlternative {
  text: string;
  note?: string;
}

interface SelectionInsightGlossaryApplied {
  sourceTerm: string;
  targetTerm: string;
  status: "applied" | "suggested" | "conflict";
  note?: string;
}

interface SelectionInsightSegmentation {
  source: string;
  explanation?: string;
}

interface SelectionInsightResponse {
  translationNatural: string;
  translationLiteral?: string;
  explanation?: string;
  alternatives: SelectionInsightAlternative[];
  glossaryApplied: SelectionInsightGlossaryApplied[];
  warnings: string[];
  segmentation: SelectionInsightSegmentation[];
  confidence?: number;
  source: "api" | "fallback";
}

function truncateForPrompt(value: string | undefined, maxLength = 1200) {
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

function normalizeComparableContext(value: string | undefined) {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function estimateSelectionInsightMaxTokens(body: SelectionInsightsRequestBody) {
  const selectedTextLength = body.selectedText?.trim().length ?? 0;
  const glossaryLength = body.glossary?.trim().length ?? 0;
  const instructionLength = body.instructions?.trim().length ?? 0;
  const usesLitePrompt = shouldUseLiteSelectionInsightPrompt(body);

  return Math.max(
    usesLitePrompt ? 120 : 180,
    Math.min(
      usesLitePrompt ? 220 : 360,
      (usesLitePrompt ? 90 : 140) +
        selectedTextLength * (usesLitePrompt ? 1.6 : 2.5) +
        Math.min(glossaryLength, 240) / 12 +
        Math.min(instructionLength, 160) / 16,
    ),
  );
}

function shouldUseLiteSelectionInsightPrompt(body: SelectionInsightsRequestBody) {
  const selectedTextLength = body.selectedText?.trim().length ?? 0;
  const customInstructionsLength = body.customInstructions?.trim().length ?? 0;
  return (
    selectedTextLength > 0 &&
    selectedTextLength <= 80 &&
    !body.glossary?.trim() &&
    customInstructionsLength === 0
  );
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

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? normalizeUserFacingText(item).trim() : ""))
    .filter(Boolean);
}

function normalizeAlternatives(value: unknown): SelectionInsightAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === "string" ? normalizeUserFacingText(record.text).trim() : "";
      if (!text) return null;

      return {
        text,
        note: typeof record.note === "string" ? normalizeUserFacingText(record.note).trim() : undefined,
      };
    })
    .filter((item) => item !== null) as SelectionInsightAlternative[];
}

function normalizeGlossaryApplied(value: unknown): SelectionInsightGlossaryApplied[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const sourceTerm =
        typeof record.sourceTerm === "string" ? normalizeUserFacingText(record.sourceTerm).trim() : "";
      const targetTerm =
        typeof record.targetTerm === "string" ? normalizeUserFacingText(record.targetTerm).trim() : "";
      const status =
        record.status === "applied" || record.status === "suggested" || record.status === "conflict"
          ? record.status
          : "suggested";

      if (!sourceTerm || !targetTerm) return null;

      return {
        sourceTerm,
        targetTerm,
        status,
        note: typeof record.note === "string" ? normalizeUserFacingText(record.note).trim() : undefined,
      };
    })
    .filter((item) => item !== null) as SelectionInsightGlossaryApplied[];
}

function normalizeSegmentation(value: unknown): SelectionInsightSegmentation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const source = typeof record.source === "string" ? normalizeUserFacingText(record.source).trim() : "";
      if (!source) return null;

      return {
        source,
        explanation:
          typeof record.explanation === "string"
            ? normalizeUserFacingText(record.explanation).trim()
            : undefined,
      };
    })
    .filter((item) => item !== null) as SelectionInsightSegmentation[];
}

function normalizeSelectionInsightPayload(payload: unknown): SelectionInsightResponse | null {
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
    translationLiteral:
      typeof record.translationLiteral === "string"
        ? normalizeUserFacingText(record.translationLiteral).trim()
        : undefined,
    explanation:
      typeof record.explanation === "string"
        ? normalizeUserFacingText(record.explanation).trim()
        : undefined,
    alternatives: normalizeAlternatives(record.alternatives),
    glossaryApplied: normalizeGlossaryApplied(record.glossaryApplied),
    warnings: normalizeStringArray(record.warnings),
    segmentation: normalizeSegmentation(record.segmentation),
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    source: "api",
  };
}

function extractSelectionInsights(payload: unknown): SelectionInsightResponse | null {
  const normalizedObject = normalizeSelectionInsightPayload(payload);
  if (normalizedObject) return normalizedObject;

  if (typeof payload === "string") {
    return normalizeSelectionInsightPayload(extractJsonFromText(payload));
  }

  return null;
}

function buildSelectionInsightMessages(body: SelectionInsightsRequestBody) {
  const usesLitePrompt = shouldUseLiteSelectionInsightPrompt(body);
  if (usesLitePrompt) {
    const systemPrompt = [
      "You translate short selected text for a book translation tool.",
      "Return ONLY valid JSON. No markdown, no explanation outside JSON.",
      "Use one JSON object with keys: translationNatural, translationLiteral, explanation.",
      "Keep explanation optional and very short.",
      "If target language is Vietnamese, use proper Vietnamese diacritics.",
    ].join(" ");
    const userPrompt = [
      `Target language: ${body.targetLanguage ?? "Vietnamese"}`,
      `Source language hint: ${body.sourceLanguage ?? "unknown"}`,
      `Selected text: ${body.selectedText ?? ""}`,
      body.beforeText?.trim() ? `Context before: ${truncateForPrompt(body.beforeText, 80)}` : "",
      body.afterText?.trim() ? `Context after: ${truncateForPrompt(body.afterText, 80)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      promptMeta: {
        promptMode: "lite",
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        includeParagraphContext: false,
        includePageContext: false,
        includeExistingTranslation: false,
        paragraphContextLength: 0,
        pageContextLength: 0,
        existingTranslationLength: 0,
        duplicatePageContext: false,
        estimatedInputTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
      },
    };
  }

  const systemPrompt = [
    "You analyze a selected passage in a book translation tool.",
    "Return ONLY valid JSON. No markdown, no explanation outside JSON.",
    "Use one JSON object with keys: translationNatural, translationLiteral, explanation, alternatives, glossaryApplied, warnings, segmentation, confidence.",
    "Keep output concise: explanation max 2 short sentences, alternatives max 2, warnings max 2.",
    "Prefer glossary terms when relevant.",
    "If target language is Vietnamese, use proper Vietnamese diacritics.",
  ].join(" ");

  const selectedTextLength = body.selectedText?.trim().length ?? 0;
  const rawParagraphContext = normalizeComparableContext(body.paragraphText);
  const rawPageContext = normalizeComparableContext(body.pageText);
  const duplicatePageContext =
    Boolean(rawParagraphContext) &&
    Boolean(rawPageContext) &&
    rawParagraphContext === rawPageContext;
  const includeParagraphContext = selectedTextLength >= 48 || rawParagraphContext.length <= 320;
  const includePageContext = selectedTextLength >= 96 && !duplicatePageContext;
  const includeExistingTranslation = selectedTextLength >= 48;
  const paragraphContext = includeParagraphContext ? truncateForPrompt(body.paragraphText, 320) : "";
  const pageContext = includePageContext ? truncateForPrompt(body.pageText, 360) : "";
  const existingTranslation = includeExistingTranslation
    ? truncateForPrompt(body.existingTranslation, 220)
    : "";

  const userPrompt = [
    `Book: ${body.bookName ?? "Untitled"}`,
    `Page: ${body.pageId ?? "unknown"}`,
    `Source language hint: ${body.sourceLanguage ?? "unknown"}`,
    `Target language: ${body.targetLanguage ?? "Vietnamese"}`,
    `Selected text: ${body.selectedText ?? ""}`,
    `Normalized text: ${body.normalizedText ?? ""}`,
    `Text before selection: ${truncateForPrompt(body.beforeText, 240)}`,
    `Text after selection: ${truncateForPrompt(body.afterText, 240)}`,
    paragraphContext ? `Paragraph context: ${paragraphContext}` : "",
    pageContext ? `Page context: ${pageContext}` : "",
    existingTranslation ? `Existing translation on page: ${existingTranslation}` : "",
    `Document metadata: ${JSON.stringify(body.documentMetadata ?? {})}`,
    body.glossary?.trim() ? `Glossary: ${truncateForPrompt(body.glossary, 1600)}` : "",
    body.instructions?.trim() ? `Extra instructions: ${truncateForPrompt(body.instructions, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ],
    promptMeta: {
      promptMode: "full",
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      includeParagraphContext,
      includePageContext,
      includeExistingTranslation,
      paragraphContextLength: paragraphContext.length,
      pageContextLength: pageContext.length,
      existingTranslationLength: existingTranslation.length,
      duplicatePageContext,
      estimatedInputTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
    },
  };
}

function buildFallbackResponse(translatedText: string): SelectionInsightResponse {
  return {
    translationNatural: normalizeUserFacingText(translatedText).trim(),
    translationLiteral: undefined,
    explanation:
      "AI khong tra ve JSON co cau truc, he thong fallback sang ban phan tich don gian.",
    alternatives: [],
    glossaryApplied: [],
    warnings: [
      "Ket qua dang o che do fallback. Neu can phan tich sau hon, hay dieu chinh prompt hoac model.",
    ],
    segmentation: [],
    confidence: undefined,
    source: "fallback",
  };
}

router.post("/", async (req: Request<object, object, SelectionInsightsRequestBody>, res: Response) => {
  const debugTiming = isDebugTranslationTimingEnabled(req.header(DEBUG_TRANSLATION_TIMING_HEADER));
  const startedAt = debugTiming ? Date.now() : 0;
  const normalizedRequestBody: SelectionInsightsRequestBody = {
    ...req.body,
    selectedText: normalizeKnownSelectionTypos(req.body?.selectedText),
    normalizedText: normalizeKnownSelectionTypos(req.body?.normalizedText),
    beforeText: normalizeKnownSelectionTypos(req.body?.beforeText),
    afterText: normalizeKnownSelectionTypos(req.body?.afterText),
    paragraphText: normalizeKnownSelectionTypos(req.body?.paragraphText),
    pageText: normalizeKnownSelectionTypos(req.body?.pageText),
    existingTranslation: normalizeKnownSelectionTypos(req.body?.existingTranslation),
  };
  const selectedText = normalizedRequestBody.selectedText?.trim();
  if (!selectedText) {
    return res.status(400).json({ error: "Missing selected text" });
  }
  const model = normalizedRequestBody.model?.trim();
  if (!model) {
    return res.status(400).json({ error: "Missing model" });
  }

  const targetLanguage = normalizedRequestBody.targetLanguage?.trim() || "Vietnamese";
  const customInstructions = normalizedRequestBody.instructions?.trim() ?? "";
  const instructionsForRequest = [
    customInstructions,
    isVietnameseTarget(targetLanguage)
      ? "If you answer in Vietnamese, use full Vietnamese diacritics."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const selectionInsightPrompt = buildSelectionInsightMessages({
    ...normalizedRequestBody,
    instructions: instructionsForRequest,
    customInstructions,
  });
  const maxTokens = estimateSelectionInsightMaxTokens({
    ...normalizedRequestBody,
    instructions: instructionsForRequest,
    customInstructions,
  });

  if (debugTiming) {
    logger.info("Selection insights request started", {
      requestId: req.requestId,
      model,
      pageId: normalizedRequestBody.pageId,
      selectedTextLength: selectedText.length,
      normalizedTextLength: normalizedRequestBody.normalizedText?.trim().length ?? 0,
      beforeTextLength: normalizedRequestBody.beforeText?.length ?? 0,
      afterTextLength: normalizedRequestBody.afterText?.length ?? 0,
      paragraphTextLength: normalizedRequestBody.paragraphText?.length ?? 0,
      pageTextLength: normalizedRequestBody.pageText?.length ?? 0,
      glossaryLength: normalizedRequestBody.glossary?.length ?? 0,
      customInstructionsLength: customInstructions.length,
      instructionsLength: instructionsForRequest.length,
      maxTokens,
      ...selectionInsightPrompt.promptMeta,
    });
  }

  try {
    const completion = await cliproxyChatCompletionsClient.createCompletion({
      feature: "selection-insights",
      model,
      messages: selectionInsightPrompt.messages,
      temperature: 0.1,
      maxTokens,
      requestId: req.requestId,
      debugTiming,
    });

    const structuredPayload =
      extractSelectionInsights(completion.messageText) ??
      extractSelectionInsights(extractJsonFromText(completion.messageText));

    if (structuredPayload) {
      if (debugTiming) {
        logger.info("Selection insights request completed", {
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
      logger.warn("Selection insights request fell back", {
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

    logger.error("Selection insights provider error", {
      requestId: req.requestId,
      code: providerError.code,
      error: providerError.message,
      ...(debugTiming ? { totalDurationMs: Date.now() - startedAt } : {}),
    });

    return res.status(providerErrorToHttpStatus(providerError)).json({
      code: providerError.code,
      error: "Failed to process selection insights",
      details: providerError.message,
    });
  }
});

export default router;
