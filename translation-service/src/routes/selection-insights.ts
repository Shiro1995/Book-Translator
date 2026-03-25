/**
 * Selection Insights route — AI-powered analysis of selected text.
 * Moved from server.ts handleSelectionInsights.
 *
 * POST /api/selection-insights → structured AI analysis
 */

import { Router, type Request, type Response } from "express";
import { config } from "../config/index.js";
import { extractTranslatedText, safeJsonParse } from "../lib/extract.js";
import { normalizeUserFacingText } from "../lib/text.js";
import { isVietnameseTarget } from "../lib/vietnamese.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Types ───────────────────────────────────────────────────────────

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

// ── Webhook Helpers ─────────────────────────────────────────────────

function getProductionWebhookUrl(url: string) {
  if (!url.includes("/webhook-test/")) return null;
  return url.replace("/webhook-test/", "/webhook/");
}

async function postToWebhook(url: string, payload: object, token: string, timeoutMs: number) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function postToWebhookWithBearer(url: string, payload: object, token: string, timeoutMs: number) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function callWebhook(payload: object) {
  const webhookUrl = config.n8nWebhookUrl;
  const authToken = config.n8nAuthToken;
  const timeoutMs = config.webhookTimeoutMs;

  let response = await postToWebhook(webhookUrl, payload, authToken, timeoutMs);
  let effectiveWebhookUrl = webhookUrl;

  logger.info("Webhook request sent", { url: effectiveWebhookUrl, status: response.status });

  if (response.status === 401 || response.status === 403) {
    response = await postToWebhookWithBearer(effectiveWebhookUrl, payload, authToken, timeoutMs);
    logger.info("Retried with Bearer auth", { status: response.status });
  }

  if (response.status === 404) {
    const productionUrl = getProductionWebhookUrl(webhookUrl);
    if (productionUrl) {
      response = await postToWebhook(productionUrl, payload, authToken, timeoutMs);
      effectiveWebhookUrl = productionUrl;
      if (response.status === 401 || response.status === 403) {
        response = await postToWebhookWithBearer(effectiveWebhookUrl, payload, authToken, timeoutMs);
      }
    }
  }

  const rawBody = await response.text();
  const parsedBody = safeJsonParse(rawBody);

  return { response, effectiveWebhookUrl, rawBody, parsedBody };
}

// ── Normalization Helpers ───────────────────────────────────────────

function truncateForPrompt(value: string | undefined, maxLength = 1200) {
  const normalized = (value ?? "").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
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
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeGlossaryApplied(value: unknown): SelectionInsightGlossaryApplied[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const sourceTerm = typeof record.sourceTerm === "string" ? normalizeUserFacingText(record.sourceTerm).trim() : "";
      const targetTerm = typeof record.targetTerm === "string" ? normalizeUserFacingText(record.targetTerm).trim() : "";
      const status =
        record.status === "applied" || record.status === "suggested" || record.status === "conflict"
          ? record.status
          : "suggested";
      if (!sourceTerm || !targetTerm) return null;
      return { sourceTerm, targetTerm, status: status as "applied" | "suggested" | "conflict", note: typeof record.note === "string" ? normalizeUserFacingText(record.note).trim() : undefined };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
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
        explanation: typeof record.explanation === "string" ? normalizeUserFacingText(record.explanation).trim() : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
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
      typeof record.translationLiteral === "string" ? normalizeUserFacingText(record.translationLiteral).trim() : undefined,
    explanation:
      typeof record.explanation === "string" ? normalizeUserFacingText(record.explanation).trim() : undefined,
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

  const translatedText = extractTranslatedText(payload);
  if (!translatedText) return null;

  return normalizeSelectionInsightPayload(extractJsonFromText(translatedText));
}

function buildSelectionInsightPrompt(body: SelectionInsightsRequestBody) {
  return [
    "You are the selection-inspector assistant for a book/document translation application.",
    "Return strict JSON only. Do not include markdown fences or prose outside JSON.",
    "Use this schema exactly:",
    '{"translationNatural":"string","translationLiteral":"string?","explanation":"string?","alternatives":[{"text":"string","note":"string?"}],"glossaryApplied":[{"sourceTerm":"string","targetTerm":"string","status":"applied|suggested|conflict","note":"string?"}],"warnings":["string"],"segmentation":[{"source":"string","explanation":"string?"}],"confidence":0.0}',
    "Rules:",
    "- Prefer glossary terms when provided. If you do not use a glossary term, mention the conflict in glossaryApplied or warnings.",
    "- Dictionary-style behavior is for short terms, but you should still explain short ambiguous phrases clearly.",
    "- If the selection appears cut off mid-sentence, add a warning.",
    "- Keep explanation concise and professional in the target language.",
    "",
    `Book: ${body.bookName ?? "Untitled"}`,
    `Page: ${body.pageId ?? "unknown"}`,
    `Source language hint: ${body.sourceLanguage ?? "unknown"}`,
    `Target language: ${body.targetLanguage ?? "Vietnamese"}`,
    `Selected text: ${body.selectedText ?? ""}`,
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
}

// ── Route Handler ───────────────────────────────────────────────────

router.post("/", async (req: Request<object, object, SelectionInsightsRequestBody>, res: Response) => {
  const selectedText = req.body?.selectedText?.trim();
  if (!selectedText) {
    return res.status(400).json({ error: "Missing selected text" });
  }

  const targetLanguage = req.body?.targetLanguage?.trim() || "Vietnamese";
  const prompt = buildSelectionInsightPrompt(req.body ?? {});
  const instructionsForRequest = [
    req.body?.instructions?.trim() ?? "",
    isVietnameseTarget(targetLanguage)
      ? "Bắt buộc giữ tiếng Việt có đầy đủ dấu nếu output dùng tiếng Việt."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const webhookPayload = {
    text: prompt,
    model: req.body?.model?.trim() || "gemini-3-flash-preview",
    targetLang: targetLanguage,
    style: "natural",
    glossary: req.body?.glossary?.trim() ?? "",
    instructions: instructionsForRequest,
    pageId: req.body?.pageId ?? null,
    bookName: req.body?.bookName ?? null,
  };

  try {
    const { response, effectiveWebhookUrl, rawBody, parsedBody } = await callWebhook(webhookPayload);

    if (!response.ok) {
      const n8nDetails =
        extractTranslatedText(parsedBody) ??
        rawBody.slice(0, 500) ??
        `HTTP ${response.status}`;

      return res.status(502).json({
        error: "n8n webhook returned an error for selection insights",
        details: n8nDetails,
        status: response.status,
        webhookUrl: effectiveWebhookUrl,
      });
    }

    const structuredPayload =
      extractSelectionInsights(parsedBody) ??
      extractSelectionInsights(extractTranslatedText(parsedBody) ?? rawBody);

    if (structuredPayload) {
      return res.json(structuredPayload);
    }

    const translatedText = extractTranslatedText(parsedBody) ?? selectedText;
    return res.json({
      translationNatural: normalizeUserFacingText(translatedText).trim(),
      translationLiteral: undefined,
      explanation:
        "AI không trả về JSON có cấu trúc, nên hệ thống fallback sang bản dịch tự nhiên của vùng chọn.",
      alternatives: [],
      glossaryApplied: [],
      warnings: [
        "Kết quả đang ở chế độ fallback. Nếu cần phân tích sâu hơn, kiểm tra prompt/flow của n8n để trả JSON chuẩn.",
      ],
      segmentation: [],
      confidence: undefined,
      source: "fallback" as const,
    });
  } catch (error) {
    logger.error("Selection insights webhook error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return res.status(502).json({
      code: "E_SELECTION_AI",
      error: "Failed to reach selection insights webhook",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
