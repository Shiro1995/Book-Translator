/**
 * N8n Webhook Translation Provider.
 * Extracted and cleaned up from server.ts webhook handling logic.
 */

import { config } from "../config/index.js";
import { extractTranslatedText, safeJsonParse } from "../lib/extract.js";
import { logger } from "../lib/logger.js";
import { normalizeUserFacingText } from "../lib/text.js";
import { isVietnameseTarget, looksLikeVietnameseMissingDiacritics } from "../lib/vietnamese.js";
import type { TranslateRequest, TranslateResponse } from "../types/index.js";
import type { TranslationProvider } from "./types.js";

function getProductionWebhookUrl(url: string) {
  if (!url.includes("/webhook-test/")) return null;
  return url.replace("/webhook-test/", "/webhook/");
}

async function postToWebhook(url: string, payload: object, token: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.webhookTimeoutMs),
  });
}

async function postToWebhookWithBearer(url: string, payload: object, token: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.webhookTimeoutMs),
  });
}

export class N8nWebhookProvider implements TranslationProvider {
  readonly name = "n8n-webhook";

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const webhookUrl = config.n8nWebhookUrl;
    const authToken = config.n8nAuthToken;

    if (!webhookUrl) {
      throw new Error("N8N_WEBHOOK_URL is not configured");
    }

    // Build instructions with Vietnamese diacritics enforcement
    const instructions = [
      request.instructions,
      isVietnameseTarget(request.targetLang)
        ? "Bắt buộc xuất tiếng Việt có đầy đủ dấu (dấu thanh và ký tự ă â ê ô ơ ư đ). Không được viết tiếng Việt không dấu."
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const webhookPayload = {
      text: request.text,
      model: request.model,
      targetLang: request.targetLang,
      style: request.style,
      glossary: request.glossary,
      instructions,
      pageId: request.pageId ?? null,
      bookName: request.bookName ?? null,
    };

    // Try initial request → auth retry → production URL fallback
    let response = await postToWebhook(webhookUrl, webhookPayload, authToken);
    let effectiveUrl = webhookUrl;

    logger.info("Webhook request sent", { url: effectiveUrl, status: response.status });

    // Retry with Bearer auth if plain auth fails
    if (response.status === 401 || response.status === 403) {
      response = await postToWebhookWithBearer(effectiveUrl, webhookPayload, authToken);
      logger.info("Retried with Bearer auth", { status: response.status });
    }

    // Try production URL if test URL returns 404
    if (response.status === 404) {
      const productionUrl = getProductionWebhookUrl(webhookUrl);
      if (productionUrl) {
        response = await postToWebhook(productionUrl, webhookPayload, authToken);
        effectiveUrl = productionUrl;

        if (response.status === 401 || response.status === 403) {
          response = await postToWebhookWithBearer(effectiveUrl, webhookPayload, authToken);
        }
      }
    }

    const rawBody = await response.text();
    const parsedBody = safeJsonParse(rawBody);

    if (!response.ok) {
      const details =
        extractTranslatedText(parsedBody) ??
        rawBody.slice(0, 500) ??
        `HTTP ${response.status}`;

      const isNotRegistered =
        response.status === 404 &&
        typeof details === "string" &&
        details.toLowerCase().includes("not registered");

      throw new Error(
        isNotRegistered
          ? "n8n webhook is not active or not registered"
          : `n8n webhook error: ${details} (status=${response.status})`,
      );
    }

    const translatedText = extractTranslatedText(parsedBody);
    if (!translatedText) {
      throw new Error("n8n webhook returned no translated text");
    }

    const normalizedText = normalizeUserFacingText(translatedText);

    // Validate Vietnamese diacritics
    if (
      isVietnameseTarget(request.targetLang) &&
      looksLikeVietnameseMissingDiacritics(normalizedText)
    ) {
      throw new Error(
        "E_VIETNAMESE_DIACRITICS: translated Vietnamese text appears to be missing diacritics",
      );
    }

    return { translatedText: normalizedText };
  }
}
