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
  const systemPrompt = [
    "You are the selection-inspector assistant for a book and document translation application.",
    "Return strict JSON only.",
    "Do not include markdown fences or any prose outside the JSON object.",
    'Use this schema exactly: {"translationNatural":"string","translationLiteral":"string?","explanation":"string?","alternatives":[{"text":"string","note":"string?"}],"glossaryApplied":[{"sourceTerm":"string","targetTerm":"string","status":"applied|suggested|conflict","note":"string?"}],"warnings":["string"],"segmentation":[{"source":"string","explanation":"string?"}],"confidence":0.0}',
    "Prefer glossary terms when they fit the context.",
    "Keep the explanation concise and professional in the target language.",
    "If the target language is Vietnamese, use proper Vietnamese diacritics.",
  ].join(" ");

  const userPrompt = [
    `Book: ${body.bookName ?? "Untitled"}`,
    `Page: ${body.pageId ?? "unknown"}`,
    `Source language hint: ${body.sourceLanguage ?? "unknown"}`,
    `Target language: ${body.targetLanguage ?? "Vietnamese"}`,
    `Selected text: ${body.selectedText ?? ""}`,
    `Normalized text: ${body.normalizedText ?? ""}`,
    `Text before selection: ${truncateForPrompt(body.beforeText, 240)}`,
    `Text after selection: ${truncateForPrompt(body.afterText, 240)}`,
    `Paragraph context: ${truncateForPrompt(body.paragraphText, 900)}`,
    `Page context: ${truncateForPrompt(body.pageText, 1400)}`,
    `Existing translation on page: ${truncateForPrompt(body.existingTranslation, 600)}`,
    `Document metadata: ${JSON.stringify(body.documentMetadata ?? {})}`,
    `Glossary: ${truncateForPrompt(body.glossary, 1600)}`,
    `Extra instructions: ${truncateForPrompt(body.instructions, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];
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
  const selectedText = req.body?.selectedText?.trim();
  if (!selectedText) {
    return res.status(400).json({ error: "Missing selected text" });
  }
  const model = req.body?.model?.trim();
  if (!model) {
    return res.status(400).json({ error: "Missing model" });
  }

  const targetLanguage = req.body?.targetLanguage?.trim() || "Vietnamese";
  const instructionsForRequest = [
    req.body?.instructions?.trim() ?? "",
    isVietnameseTarget(targetLanguage)
      ? "If you answer in Vietnamese, use full Vietnamese diacritics."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await cliproxyChatCompletionsClient.createCompletion({
      feature: "selection-insights",
      model,
      messages: buildSelectionInsightMessages({
        ...req.body,
        instructions: instructionsForRequest,
      }),
      temperature: 0.1,
      maxTokens: 2_000,
      requestId: req.requestId,
    });

    const structuredPayload =
      extractSelectionInsights(completion.messageText) ??
      extractSelectionInsights(extractJsonFromText(completion.messageText));

    if (structuredPayload) {
      return res.json(structuredPayload);
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
    });

    return res.status(providerErrorToHttpStatus(providerError)).json({
      code: providerError.code,
      error: "Failed to process selection insights",
      details: providerError.message,
    });
  }
});

export default router;
