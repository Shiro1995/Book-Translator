import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  DictionaryLookupResult,
  SelectionAiResult,
  SelectionClassification,
  SelectionSnapshot,
  VietnameseAssistResult,
} from "../types";
import { normalizeUserFacingText } from "../../utils/text";
import { buildSelectionMetrics } from "../utils/selectionMetrics";
import { buildContextHash, normalizeLookupText } from "../utils/selectionNormalization";
import { computeInspectorPosition, computeMiniBubblePosition, rectFromDomRect } from "../utils/overlayPosition";
import { SelectionMiniBubble } from "./SelectionMiniBubble";
import { SelectionInspector } from "./SelectionInspector";
import { lookupVietnameseVietnameseDictionary } from "../services/vietnameseVietnameseDictionaryService";

interface AsyncState<T> {
  selectionId: string | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  data: T | null;
}

interface TranslatedTextSelectionPopupProps {
  bookId: string;
  pageId: number;
  translatedText: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const IDLE_DICTIONARY_STATE: AsyncState<DictionaryLookupResult> = {
  selectionId: null,
  status: "idle",
  error: null,
  data: null,
};

const IDLE_AI_STATE: AsyncState<SelectionAiResult> = {
  selectionId: null,
  status: "idle",
  error: null,
  data: null,
};

const IDLE_VIET_ASSIST_STATE: AsyncState<VietnameseAssistResult> = {
  selectionId: null,
  status: "idle",
  error: null,
  data: null,
};

type SelectionAnchorRect = SelectionSnapshot["rect"];

function normalizeTextareaSelection(value: string) {
  return normalizeUserFacingText(value).replace(/\s+/gu, " ").trim();
}

function shouldLookupVietnameseDictionary(value: string) {
  if (!value) {
    return false;
  }

  const tokenCount = value.split(/\s+/u).filter(Boolean).length;
  return tokenCount > 0 && tokenCount <= 6 && value.length <= 56;
}

function inferLookupType(metrics: SelectionSnapshot["metrics"]): SelectionClassification["lookupType"] {
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

function extractParagraph(pageText: string, startOffset: number, endOffset: number) {
  const paragraphStart = pageText.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1;
  const paragraphEndCandidate = pageText.indexOf("\n", endOffset);
  const paragraphEnd = paragraphEndCandidate === -1 ? pageText.length : paragraphEndCandidate;
  return pageText.slice(paragraphStart, paragraphEnd).trim();
}

const TEXTAREA_MIRROR_STYLE_PROPS = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "letterSpacing",
  "textTransform",
  "textIndent",
  "textDecoration",
  "wordSpacing",
  "tabSize",
] as const;

function createTextareaSelectionAnchorRect(
  textarea: HTMLTextAreaElement,
  selectionOffset: number,
): SelectionAnchorRect {
  const fallback = rectFromDomRect(textarea.getBoundingClientRect());
  let mirror: HTMLDivElement | null = null;

  try {
    mirror = document.createElement("div");
    const mirrorStyle = mirror.style;
    const computedStyle = window.getComputedStyle(textarea);
    const textareaRect = textarea.getBoundingClientRect();

    mirrorStyle.position = "fixed";
    mirrorStyle.visibility = "hidden";
    mirrorStyle.pointerEvents = "none";
    mirrorStyle.whiteSpace = "pre-wrap";
    mirrorStyle.wordWrap = "break-word";
    mirrorStyle.left = "-99999px";
    mirrorStyle.top = "0";

    for (const property of TEXTAREA_MIRROR_STYLE_PROPS) {
      mirrorStyle.setProperty(property, computedStyle.getPropertyValue(property));
    }

    const caretProbe = document.createElement("span");
    const clampedOffset = Math.max(0, Math.min(selectionOffset, textarea.value.length));
    const textBeforeCaret = textarea.value.slice(0, clampedOffset);
    mirror.textContent = textBeforeCaret;

    caretProbe.textContent = textarea.value.slice(clampedOffset, clampedOffset + 1) || "\u200b";
    mirror.appendChild(caretProbe);
    document.body.appendChild(mirror);

    const probeRect = caretProbe.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const computedLineHeight = Number.parseFloat(computedStyle.lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight)
      ? computedLineHeight
      : Number.parseFloat(computedStyle.fontSize) * 1.2;

    const left = textareaRect.left + (probeRect.left - mirrorRect.left) - textarea.scrollLeft;
    const top = textareaRect.top + (probeRect.top - mirrorRect.top) - textarea.scrollTop;

    return {
      top,
      left,
      right: left + 1,
      bottom: top + lineHeight,
      width: 1,
      height: lineHeight,
    };
  } catch {
    return fallback;
  } finally {
    mirror?.remove();
  }
}

function buildSelectionSnapshot(input: {
  bookId: string;
  pageId: number;
  pageText: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  anchorRect: SelectionAnchorRect;
}): SelectionSnapshot {
  const trimmedText = normalizeTextareaSelection(input.selectedText);
  const normalizedText = normalizeLookupText(trimmedText);
  const metrics = buildSelectionMetrics(trimmedText);
  const allowDictionary = shouldLookupVietnameseDictionary(trimmedText);
  const classifier: SelectionClassification = {
    mode: "dictionary",
    reason: allowDictionary
      ? "Cụm ngắn phù hợp để tra cứu Việt-Việt."
      : "Chỉ hỗ trợ tra cứu Việt-Việt cho từ/cụm ngắn.",
    confidence: allowDictionary ? 0.91 : 0.71,
    metrics,
    allowDictionary,
    allowAI: false,
    defaultTab: "dictionary",
    lookupType: inferLookupType(metrics),
  };
  const beforeText = input.pageText.slice(Math.max(0, input.startOffset - 180), input.startOffset).trim();
  const afterText = input.pageText.slice(input.endOffset, input.endOffset + 180).trim();
  const paragraphText = extractParagraph(input.pageText, input.startOffset, input.endOffset);
  const contextHash = buildContextHash([
    normalizedText,
    beforeText,
    afterText,
    paragraphText,
    String(input.pageId),
    "translated",
  ]);

  return {
    id: `${input.bookId}-${input.pageId}-translated-${contextHash}-${input.startOffset}-${input.endOffset}`,
    bookId: input.bookId,
    pageId: input.pageId,
    text: input.selectedText,
    trimmedText,
    normalizedText,
    rect: input.anchorRect,
    metrics,
    classifier,
    contextWindow: {
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      beforeText,
      afterText,
      paragraphText,
      pageText: input.pageText,
      contextHash,
    },
  };
}

function buildUnsupportedResult(selection: SelectionSnapshot): DictionaryLookupResult {
  return {
    status: "unsupported",
    source: "vi-viet-dictionary",
    selectedText: selection.trimmedText,
    normalizedText: selection.normalizedText,
    glossaryMatches: [],
    tokenBreakdown: [],
    secondaryMeanings: [],
    examples: [],
    relatedTerms: [],
    message: "Chỉ hỗ trợ từ/cụm ngắn trong popup này.",
    suggestion: "Hãy chọn tối đa 6 từ để tra cứu Việt-Việt nhanh.",
  };
}

function buildDictionaryResultFromVietnameseLookup(
  selection: SelectionSnapshot,
  lookupResult: Awaited<ReturnType<typeof lookupVietnameseVietnameseDictionary>>,
): DictionaryLookupResult {
  if (lookupResult.status === "empty") {
    return {
      status: "empty",
      source: "vi-viet-dictionary",
      selectedText: selection.trimmedText,
      normalizedText: selection.normalizedText,
      glossaryMatches: [],
      tokenBreakdown: [],
      secondaryMeanings: [],
      examples: [],
      relatedTerms: [],
      message: lookupResult.note ?? "Chưa tìm thấy mục phù hợp.",
      suggestion: "Thử với từ khóa ngắn hơn hoặc chọn lại token.",
    };
  }

  const primary = lookupResult.meanings[0];
  const secondary = lookupResult.meanings.slice(1, 5);
  const examples = lookupResult.meanings
    .map((item) => item.example?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 3);
  const relatedTerms = lookupResult.meanings
    .map((item) => item.source?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 3)
    .map((source) => `Nguồn: ${source}`);

  return {
    status: "success",
    source: "vi-viet-dictionary",
    selectedText: selection.trimmedText,
    normalizedText: selection.normalizedText,
    glossaryMatches: [],
    tokenBreakdown: [],
    primaryMeaning: primary?.definition,
    secondaryMeanings: secondary.map((item) => item.definition),
    pronunciation: lookupResult.pronunciations[0]?.ipa,
    partOfSpeech: primary?.partOfSpeech,
    examples,
    relatedTerms,
    message: `Tra cứu Việt-Việt (${lookupResult.word}).`,
    suggestion: lookupResult.note,
  };
}

async function copyToClipboard(value: string) {
  if (!value) {
    return;
  }
  await navigator.clipboard.writeText(value);
}

export function TranslatedTextSelectionPopup({
  bookId,
  pageId,
  translatedText,
  textareaRef,
}: TranslatedTextSelectionPopupProps) {
  const inspectorRef = useRef<HTMLElement | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const currentSelectionRef = useRef<SelectionSnapshot | null>(null);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [inspectorSize, setInspectorSize] = useState({ width: 420, height: 520 });
  const [dictionaryState, setDictionaryState] = useState<AsyncState<DictionaryLookupResult>>(
    IDLE_DICTIONARY_STATE,
  );

  useEffect(() => {
    currentSelectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    lookupAbortRef.current?.abort();
    setSelection(null);
    setIsBubbleVisible(false);
    setIsInspectorOpen(false);
    setPinned(false);
    setDictionaryState(IDLE_DICTIONARY_STATE);
  }, [bookId, pageId, translatedText]);

  useEffect(() => {
    return () => {
      lookupAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isInspectorOpen || !inspectorRef.current) {
      return;
    }

    const element = inspectorRef.current;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setInspectorSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : {
              width: Math.ceil(rect.width),
              height: Math.ceil(rect.height),
            },
      );
    };

    updateSize();
    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isInspectorOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const syncSelection = () => {
      const start = Math.min(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0);
      const end = Math.max(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0);
      if (start === end) {
        if (!isInspectorOpen && !pinned) {
          setSelection(null);
          setIsBubbleVisible(false);
          setDictionaryState(IDLE_DICTIONARY_STATE);
        }
        return;
      }

      const selectedText = textarea.value.slice(start, end);
      const normalizedSelectedText = normalizeTextareaSelection(selectedText);
      if (!normalizedSelectedText) {
        if (!isInspectorOpen && !pinned) {
          setSelection(null);
          setIsBubbleVisible(false);
          setDictionaryState(IDLE_DICTIONARY_STATE);
        }
        return;
      }

      const nextSelection = buildSelectionSnapshot({
        bookId,
        pageId,
        pageText: translatedText,
        selectedText,
        startOffset: start,
        endOffset: end,
        anchorRect: createTextareaSelectionAnchorRect(textarea, end),
      });

      const isNewSelection = nextSelection.id !== currentSelectionRef.current?.id;
      setSelection(nextSelection);
      if (isInspectorOpen && isNewSelection) {
        lookupAbortRef.current?.abort();
        setDictionaryState(IDLE_DICTIONARY_STATE);
      }
      if (!isInspectorOpen) {
        setIsBubbleVisible(true);
      }
    };

    textarea.addEventListener("select", syncSelection);
    textarea.addEventListener("mouseup", syncSelection);
    textarea.addEventListener("keyup", syncSelection);
    textarea.addEventListener("touchend", syncSelection);
    textarea.addEventListener("scroll", syncSelection);

    return () => {
      textarea.removeEventListener("select", syncSelection);
      textarea.removeEventListener("mouseup", syncSelection);
      textarea.removeEventListener("keyup", syncSelection);
      textarea.removeEventListener("touchend", syncSelection);
      textarea.removeEventListener("scroll", syncSelection);
    };
  }, [bookId, isInspectorOpen, pageId, pinned, textareaRef, translatedText]);

  useEffect(() => {
    if (!selection || !isInspectorOpen) {
      return;
    }

    // Run lookup once per selection while inspector is open to avoid retry loops.
    if (dictionaryState.selectionId === selection.id) {
      return;
    }

    lookupAbortRef.current?.abort();

    if (!selection.classifier.allowDictionary) {
      setDictionaryState({
        selectionId: selection.id,
        status: "success",
        error: null,
        data: buildUnsupportedResult(selection),
      });
      return;
    }

    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setDictionaryState({
      selectionId: selection.id,
      status: "loading",
      error: null,
      data: null,
    });

    void lookupVietnameseVietnameseDictionary(selection.trimmedText, { signal: controller.signal })
      .then((lookupResult) => {
        if (controller.signal.aborted || currentSelectionRef.current?.id !== selection.id) {
          return;
        }

        setDictionaryState({
          selectionId: selection.id,
          status: "success",
          error: null,
          data: buildDictionaryResultFromVietnameseLookup(selection, lookupResult),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || currentSelectionRef.current?.id !== selection.id) {
          return;
        }

        const message = error instanceof Error ? error.message : "Tra cứu Việt-Việt thất bại.";
        setDictionaryState({
          selectionId: selection.id,
          status: "error",
          error: message,
          data: null,
        });
      });
  }, [dictionaryState.selectionId, dictionaryState.status, isInspectorOpen, selection]);

  useEffect(() => {
    if (!isBubbleVisible && !isInspectorOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (
        target.closest("[data-selection-bubble='true']") ||
        target.closest("[data-selection-inspector='true']") ||
        textareaRef.current?.contains(target)
      ) {
        return;
      }

      setIsBubbleVisible(false);
      if (isInspectorOpen && !pinned) {
        lookupAbortRef.current?.abort();
        setIsInspectorOpen(false);
        setSelection(null);
        setDictionaryState(IDLE_DICTIONARY_STATE);
      } else if (!isInspectorOpen) {
        setSelection(null);
        setDictionaryState(IDLE_DICTIONARY_STATE);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      lookupAbortRef.current?.abort();
      setIsBubbleVisible(false);
      setIsInspectorOpen(false);
      setSelection(null);
      setPinned(false);
      setDictionaryState(IDLE_DICTIONARY_STATE);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isBubbleVisible, isInspectorOpen, pinned, textareaRef]);

  const bubblePosition = selection ? computeMiniBubblePosition(selection.rect) : null;
  const inspectorPosition = selection ? computeInspectorPosition(selection.rect, inspectorSize) : null;
  const aiState = useMemo(() => IDLE_AI_STATE, []);
  const vietAssistState = useMemo(() => IDLE_VIET_ASSIST_STATE, []);

  if (!selection) {
    return null;
  }

  return (
    <>
      {isBubbleVisible && bubblePosition && (
        <SelectionMiniBubble
          selection={selection}
          position={bubblePosition}
          onOpenInspector={() => {
            setIsInspectorOpen(true);
            setIsBubbleVisible(false);
            setDictionaryState(IDLE_DICTIONARY_STATE);
          }}
          onCopySelection={() => {
            void copyToClipboard(selection.trimmedText);
          }}
        />
      )}

      {isInspectorOpen && inspectorPosition && inspectorPosition.placement === "center" && (
        <button
          type="button"
          aria-label="Đóng popup tra cứu Việt-Việt"
          className="fixed inset-0 z-[63] bg-black/30"
          onClick={() => {
            lookupAbortRef.current?.abort();
            setIsInspectorOpen(false);
            setSelection(null);
            setPinned(false);
            setDictionaryState(IDLE_DICTIONARY_STATE);
          }}
        />
      )}

      {isInspectorOpen && inspectorPosition && (
        <SelectionInspector
          selection={selection}
          position={inspectorPosition}
          inspectorRef={inspectorRef}
          activeTab="dictionary"
          pinned={pinned}
          dictionaryState={dictionaryState}
          vietnameseAssistState={vietAssistState}
          aiState={aiState}
          availableTabs={["dictionary"]}
          hideVietnameseAssist
          allowAiActions={false}
          allowGlossaryActions={false}
          onClose={() => {
            lookupAbortRef.current?.abort();
            setIsInspectorOpen(false);
            setSelection(null);
            setPinned(false);
            setDictionaryState(IDLE_DICTIONARY_STATE);
          }}
          onTogglePin={() => setPinned((prev) => !prev)}
          onTabChange={() => {
            // Dictionary-only popup.
          }}
          onCopySelection={() => {
            void copyToClipboard(selection.trimmedText);
          }}
          onCopyDictionaryMeaning={() => {
            void copyToClipboard(dictionaryState.data?.primaryMeaning ?? "");
          }}
          onCopyAiTranslation={() => {
            // Dictionary-only popup.
          }}
          onOpenAiTab={() => {
            // Dictionary-only popup.
          }}
          onRetryVietnameseAssist={() => {
            // Vietnamese assist block hidden in this popup.
          }}
          onAddGlossaryFromDictionary={() => {
            // Glossary action disabled in this popup.
          }}
          onAddGlossaryFromAi={() => {
            // AI tab disabled in this popup.
          }}
          onApplyAiTranslation={() => {
            // AI tab disabled in this popup.
          }}
        />
      )}
    </>
  );
}
