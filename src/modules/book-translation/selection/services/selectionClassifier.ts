import type {
  SelectionClassification,
  SelectionClassifierConfig,
  SelectionMetrics,
} from "../types";

export const DEFAULT_SELECTION_CLASSIFIER_CONFIG: SelectionClassifierConfig = {
  maxDictionaryTokens: 5,
  maxDictionaryChars: 32,
  aiSentenceThresholdTokens: 6,
  aiPreferredCharThreshold: 48,
  shortPhraseMinTokens: 2,
  shortPhraseMaxTokens: 5,
};

function resolveLookupType(metrics: SelectionMetrics): SelectionClassification["lookupType"] {
  if (metrics.looksLikeMultiSentence || metrics.hasLineBreak || metrics.charCount > 160) {
    return "paragraph";
  }
  if (metrics.looksLikeSentence || metrics.tokenCount >= 6) {
    return "sentence";
  }
  if (metrics.isSingleWord) {
    return "word";
  }
  return "phrase";
}

export function classifySelection(
  metrics: SelectionMetrics,
  config: Partial<SelectionClassifierConfig> = {},
): SelectionClassification {
  const resolvedConfig = { ...DEFAULT_SELECTION_CLASSIFIER_CONFIG, ...config };

  const baseResult: SelectionClassification = {
    mode: "dictionary",
    reason: "Cụm ngắn phù hợp để tra cứu nhanh.",
    confidence: 0.72,
    metrics,
    allowDictionary: true,
    allowAI: true,
    defaultTab: "dictionary",
    lookupType: resolveLookupType(metrics),
  };

  if (metrics.annotationOverlap) {
    return {
      ...baseResult,
      reason: "Vùng chọn chồng lên lớp đánh dấu nên ưu tiên xử lý an toàn bằng AI.",
      mode: "ai",
      defaultTab: "ai",
      confidence: 0.6,
    };
  }

  if (metrics.exactGlossaryMatch) {
    return {
      ...baseResult,
      reason: "Khớp glossary nội bộ, nên ưu tiên tra cứu ngay.",
      confidence: 0.96,
    };
  }

  if (metrics.ocrNoiseLikely) {
    return {
      ...baseResult,
      mode: "ai",
      defaultTab: "ai",
      allowDictionary: metrics.partialGlossaryMatch,
      reason: "Selection có dấu hiệu nhiễu OCR, AI sẽ chịu lỗi tốt hơn.",
      confidence: 0.81,
    };
  }

  if (metrics.hasLineBreak || metrics.looksLikeMultiSentence) {
    return {
      ...baseResult,
      mode: "ai",
      defaultTab: "ai",
      reason: "Đoạn bôi đen có xuống dòng hoặc nhiều câu nên ưu tiên AI ngữ cảnh.",
      confidence: 0.94,
      lookupType: "paragraph",
    };
  }

  if (
    metrics.tokenCount > resolvedConfig.maxDictionaryTokens ||
    metrics.charCount > resolvedConfig.aiPreferredCharThreshold ||
    (metrics.looksLikeSentence &&
      (metrics.tokenCount >= resolvedConfig.aiSentenceThresholdTokens ||
        metrics.hasTerminalPunctuation))
  ) {
    return {
      ...baseResult,
      mode: "ai",
      defaultTab: "ai",
      reason: "Selection đủ dài để AI hiểu ngữ cảnh tốt hơn tra cứu từ điển.",
      confidence: 0.9,
      lookupType: metrics.hasLineBreak ? "paragraph" : resolveLookupType(metrics),
    };
  }

  if (metrics.isSingleWord) {
    return {
      ...baseResult,
      reason: "Một từ đơn nên ưu tiên tra cứu từ điển/glossary.",
      confidence: 0.92,
      lookupType: "word",
    };
  }

  if (
    metrics.tokenCount >= resolvedConfig.shortPhraseMinTokens &&
    metrics.tokenCount <= resolvedConfig.shortPhraseMaxTokens &&
    metrics.charCount <= resolvedConfig.maxDictionaryChars
  ) {
    return {
      ...baseResult,
      reason: metrics.partialGlossaryMatch
        ? "Cụm ngắn có liên quan glossary nên ưu tiên tab tra cứu."
        : "Cụm ngắn phù hợp để tra cứu, nhưng vẫn giữ sẵn tab AI.",
      confidence: metrics.partialGlossaryMatch ? 0.84 : 0.78,
      lookupType: "phrase",
    };
  }

  return {
    ...baseResult,
    mode: "ai",
    defaultTab: "ai",
    reason: "Selection này có lợi hơn khi dịch theo ngữ cảnh.",
    confidence: 0.68,
    lookupType: resolveLookupType(metrics),
  };
}
