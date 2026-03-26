import { cliproxyChatCompletionsClient } from "../lib/chat-completions.js";
import { ProviderError } from "../lib/provider-errors.js";
import { normalizeUserFacingText } from "../lib/text.js";
import { isVietnameseTarget, looksLikeVietnameseMissingDiacritics } from "../lib/vietnamese.js";
import type { TranslateRequest, TranslateResponse } from "../types/index.js";
import type { TranslationProvider } from "./types.js";

function describeStyle(style: TranslateRequest["style"]) {
  switch (style) {
    case "literal":
      return "Stay close to the source phrasing while remaining grammatical.";
    case "literary":
      return "Preserve voice, rhythm, and literary tone where possible.";
    case "academic":
      return "Use precise terminology and a formal register.";
    case "natural":
    default:
      return "Optimize for natural, fluent reading while preserving meaning.";
  }
}

function buildTranslationMessages(request: TranslateRequest) {
  const systemPrompt = [
    "You are a professional translation engine for books and documents.",
    "Translate the user's source text into the requested target language.",
    "Return only the translated text.",
    "Do not add explanations, labels, markdown, code fences, or quotes unless they already exist in the source.",
    "Preserve meaning, tone, paragraph breaks, speaker labels, numbering, and punctuation.",
    "Respect glossary terms when they are relevant and keep terminology consistent.",
    "If the target language is Vietnamese, output fully accented Vietnamese with proper diacritics.",
  ].join(" ");

  const userPrompt = [
    `Target language: ${request.targetLang}`,
    `Style guidance: ${describeStyle(request.style)}`,
    request.bookName ? `Book: ${request.bookName}` : "",
    request.pageId != null ? `Page: ${request.pageId}` : "",
    request.glossary.trim() ? `Glossary:\n${request.glossary.trim()}` : "Glossary: none",
    request.instructions.trim()
      ? `Additional instructions:\n${request.instructions.trim()}`
      : "Additional instructions: none",
    "Source text:",
    request.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];
}

function estimateMaxTokens(text: string) {
  return Math.max(1_024, Math.min(8_192, Math.ceil(text.length * 1.5)));
}

export class CliproxyChatCompletionsProvider implements TranslationProvider {
  readonly name = "cliproxy-chat-completions";

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const completion = await cliproxyChatCompletionsClient.createCompletion({
      feature: "translation",
      model: request.model,
      messages: buildTranslationMessages(request),
      temperature: 0.15,
      maxTokens: estimateMaxTokens(request.text),
      requestId: request.requestId,
      jobId: request.jobId,
      debugTiming: request.debugTiming,
    });

    const normalizedText = normalizeUserFacingText(completion.messageText).trim();

    if (!normalizedText) {
      throw new ProviderError(
        "E_PROVIDER_MALFORMED_RESPONSE",
        "Cliproxy returned an empty translation",
      );
    }

    if (
      isVietnameseTarget(request.targetLang) &&
      looksLikeVietnameseMissingDiacritics(normalizedText)
    ) {
      throw new ProviderError(
        "E_PROVIDER_MALFORMED_RESPONSE",
        "E_VIETNAMESE_DIACRITICS: translated Vietnamese text appears to be missing diacritics",
      );
    }

    return { translatedText: normalizedText };
  }
}
