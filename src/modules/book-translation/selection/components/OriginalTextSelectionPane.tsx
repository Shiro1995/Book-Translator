import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  DictionaryLookupResult,
  SelectionAiResult,
  SelectionAnalyticsPayload,
  SelectionSnapshot,
  SelectionTab,
} from "../types";
import { parseGlossaryEntries } from "../services/glossaryLookupService";
import { useTextSelection } from "../hooks/useTextSelection";
import { computeInspectorPosition, computeMiniBubblePosition } from "../utils/overlayPosition";
import { SelectionMiniBubble } from "./SelectionMiniBubble";
import { SelectionInspector } from "./SelectionInspector";
import { lookupDictionarySelection } from "../services/dictionaryLookupService";
import { requestSelectionAiInsights } from "../services/selectionAiService";
import { trackSelectionAnalytics } from "../services/selectionAnalytics";

interface AsyncState<T> {
  selectionId: string | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  data: T | null;
}

interface OriginalTextSelectionPaneProps {
  bookId: string;
  bookName: string;
  pageId: number;
  originalText: string;
  currentTranslation?: string;
  glossary: string;
  model: string;
  targetLanguage: string;
  instructions: string;
  readingFontStyle: CSSProperties;
  onAppendGlossaryEntry: (entry: string) => void;
  onApplyTranslation: (translation: string) => void;
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

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
}

function buildAnalyticsPayload(selection: SelectionSnapshot): SelectionAnalyticsPayload {
  return {
    documentId: selection.bookId,
    pageId: selection.pageId,
    selectionLengthChars: selection.metrics.charCount,
    selectionLengthTokens: selection.metrics.tokenCount,
    classifierMode: selection.classifier.mode,
    defaultTab: selection.classifier.defaultTab,
    language: selection.metrics.language,
    glossaryHit: selection.metrics.exactGlossaryMatch || selection.metrics.partialGlossaryMatch,
  };
}

export function OriginalTextSelectionPane({
  bookId,
  bookName,
  pageId,
  originalText,
  currentTranslation,
  glossary,
  model,
  targetLanguage,
  instructions,
  readingFontStyle,
  onAppendGlossaryEntry,
  onApplyTranslation,
}: OriginalTextSelectionPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const hideBubbleTimerRef = useRef<number | null>(null);
  const lastTrackedSelectionIdRef = useRef<string | null>(null);
  const currentSelectionRef = useRef<SelectionSnapshot | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const glossaryEntries = useMemo(() => parseGlossaryEntries(glossary), [glossary]);
  const { selection, clearSelection } = useTextSelection({
    containerRef,
    enabled: Boolean(bookId && pageId),
    bookId,
    pageId,
    pageText: originalText,
    glossaryEntries,
  });
  const [currentSelection, setCurrentSelection] = useState<SelectionSnapshot | null>(null);
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SelectionTab>("dictionary");
  const [pinned, setPinned] = useState(false);
  const [inspectorSize, setInspectorSize] = useState({ width: 420, height: 520 });
  const [dictionaryState, setDictionaryState] = useState<AsyncState<DictionaryLookupResult>>(
    IDLE_DICTIONARY_STATE,
  );
  const [aiState, setAiState] = useState<AsyncState<SelectionAiResult>>(IDLE_AI_STATE);

  useEffect(() => {
    currentSelectionRef.current = currentSelection;
  }, [currentSelection]);

  useEffect(() => {
    return () => {
      if (hideBubbleTimerRef.current) {
        window.clearTimeout(hideBubbleTimerRef.current);
      }
      aiAbortRef.current?.abort();
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
  }, [activeTab, aiState.status, dictionaryState.status, isInspectorOpen]);

  useEffect(() => {
    aiAbortRef.current?.abort();
    setCurrentSelection(null);
    setIsBubbleVisible(false);
    setIsInspectorOpen(false);
    setPinned(false);
    setDictionaryState(IDLE_DICTIONARY_STATE);
    setAiState(IDLE_AI_STATE);
    lastTrackedSelectionIdRef.current = null;
    clearSelection();
  }, [bookId, clearSelection, originalText, pageId]);

  useEffect(() => {
    if (selection) {
      if (hideBubbleTimerRef.current) {
        window.clearTimeout(hideBubbleTimerRef.current);
      }

      const isNewSelection = selection.id !== lastTrackedSelectionIdRef.current;
      setCurrentSelection(selection);

      if (isNewSelection) {
        lastTrackedSelectionIdRef.current = selection.id;
        trackSelectionAnalytics("selection_created", buildAnalyticsPayload(selection));
      }

      if (isInspectorOpen && isNewSelection) {
        setActiveTab(selection.classifier.defaultTab);
        setDictionaryState(IDLE_DICTIONARY_STATE);
        setAiState(IDLE_AI_STATE);
        trackSelectionAnalytics("default_tab_assigned", buildAnalyticsPayload(selection));
      }

      if (!isInspectorOpen) {
        setIsBubbleVisible(true);
      }
      if (isNewSelection) {
        trackSelectionAnalytics("mini_popup_shown", buildAnalyticsPayload(selection));
      }
      return;
    }

    if (isInspectorOpen || pinned) {
      return;
    }

    hideBubbleTimerRef.current = window.setTimeout(() => {
      setIsBubbleVisible(false);
      setCurrentSelection(null);
    }, 120);
  }, [isInspectorOpen, pinned, selection]);

  useEffect(() => {
    if (!currentSelection || !isInspectorOpen) {
      return;
    }

    if (activeTab === "dictionary" && dictionaryState.selectionId !== currentSelection.id) {
      const startedAt = performance.now();
      const payload = buildAnalyticsPayload(currentSelection);
      trackSelectionAnalytics("dictionary_lookup_started", payload);
      setDictionaryState({
        selectionId: currentSelection.id,
        status: "loading",
        error: null,
        data: null,
      });

      const dictionaryController = new AbortController();

      void lookupDictionarySelection(
        {
          text: currentSelection.trimmedText,
          glossary,
          classifier: currentSelection.classifier,
        },
        { signal: dictionaryController.signal },
      )
        .then((result) => {
          if (dictionaryController.signal.aborted || currentSelectionRef.current?.id !== currentSelection.id) {
            return;
          }

          setDictionaryState({
            selectionId: currentSelection.id,
            status: "success",
            error: null,
            data: result,
          });
          trackSelectionAnalytics("dictionary_lookup_succeeded", {
            ...payload,
            responseTime: performance.now() - startedAt,
          });
        })
        .catch((error) => {
          if (dictionaryController.signal.aborted) {
            return;
          }

          const message = error instanceof Error ? error.message : "Lookup failed";
          setDictionaryState({
            selectionId: currentSelection.id,
            status: "error",
            error: message,
            data: null,
          });
          trackSelectionAnalytics("dictionary_lookup_failed", {
            ...payload,
            responseTime: performance.now() - startedAt,
            errorCode: "dictionary_lookup_failed",
          });
        });
    }

    if (activeTab === "ai" && aiState.selectionId !== currentSelection.id) {
      const startedAt = performance.now();
      const payload = buildAnalyticsPayload(currentSelection);
      aiAbortRef.current?.abort();
      const controller = new AbortController();
      aiAbortRef.current = controller;
      trackSelectionAnalytics("ai_lookup_started", payload);
      setAiState({
        selectionId: currentSelection.id,
        status: "loading",
        error: null,
        data: null,
      });

      void requestSelectionAiInsights(
        {
          bookId,
          bookName,
          pageId,
          selectedText: currentSelection.trimmedText,
          normalizedText: currentSelection.normalizedText,
          sourceLanguage: currentSelection.metrics.language,
          targetLanguage,
          model,
          glossary,
          instructions,
          beforeText: currentSelection.contextWindow.beforeText,
          afterText: currentSelection.contextWindow.afterText,
          paragraphText: currentSelection.contextWindow.paragraphText,
          pageText: currentSelection.contextWindow.pageText,
          existingTranslation: currentTranslation,
          documentMetadata: {
            title: bookName,
          },
          contextHash: currentSelection.contextWindow.contextHash,
        },
        { signal: controller.signal },
      )
        .then((result) => {
          if (controller.signal.aborted || currentSelectionRef.current?.id !== currentSelection.id) {
            return;
          }

          setAiState({
            selectionId: currentSelection.id,
            status: "success",
            error: null,
            data: result,
          });
          trackSelectionAnalytics("ai_lookup_succeeded", {
            ...payload,
            responseTime: performance.now() - startedAt,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }

          const message = error instanceof Error ? error.message : "AI lookup failed";
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "ai_lookup_failed";

          setAiState({
            selectionId: currentSelection.id,
            status: "error",
            error: message,
            data: null,
          });
          trackSelectionAnalytics("ai_lookup_failed", {
            ...payload,
            responseTime: performance.now() - startedAt,
            errorCode,
          });
        });
    }
  }, [
    activeTab,
    aiState.selectionId,
    bookId,
    bookName,
    currentSelection,
    currentTranslation,
    dictionaryState.selectionId,
    glossary,
    instructions,
    isInspectorOpen,
    model,
    pageId,
    targetLanguage,
  ]);

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
        containerRef.current?.contains(target)
      ) {
        return;
      }

      setIsBubbleVisible(false);
      if (isInspectorOpen && !pinned) {
        setIsInspectorOpen(false);
        setCurrentSelection(null);
        setDictionaryState(IDLE_DICTIONARY_STATE);
        setAiState(IDLE_AI_STATE);
        clearSelection();
      } else if (!isInspectorOpen) {
        setCurrentSelection(null);
        clearSelection();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setIsBubbleVisible(false);
      setIsInspectorOpen(false);
      setCurrentSelection(null);
      setPinned(false);
      setDictionaryState(IDLE_DICTIONARY_STATE);
      setAiState(IDLE_AI_STATE);
      clearSelection();
      if (currentSelectionRef.current) {
        trackSelectionAnalytics("popup_closed", buildAnalyticsPayload(currentSelectionRef.current));
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [clearSelection, isBubbleVisible, isInspectorOpen, pinned]);

  const handleOpenInspector = () => {
    if (!currentSelection) {
      return;
    }

    if (hideBubbleTimerRef.current) {
      window.clearTimeout(hideBubbleTimerRef.current);
    }
    setIsInspectorOpen(true);
    setIsBubbleVisible(false);
    setActiveTab(currentSelection.classifier.defaultTab);
    setDictionaryState(IDLE_DICTIONARY_STATE);
    setAiState(IDLE_AI_STATE);
    if (currentSelection.classifier.defaultTab === "ai") {
      setAiState({
        selectionId: null,
        status: "loading",
        error: null,
        data: null,
      });
    }

    const payload = buildAnalyticsPayload(currentSelection);
    trackSelectionAnalytics("mini_popup_clicked", payload);
    trackSelectionAnalytics("inspector_opened", payload);
    trackSelectionAnalytics("default_tab_assigned", payload);
  };

  const handleSwitchTab = (tab: SelectionTab) => {
    if (!currentSelection) {
      return;
    }

    setActiveTab(tab);
    if (tab === "ai" && aiState.selectionId !== currentSelection.id) {
      setAiState({
        selectionId: null,
        status: "loading",
        error: null,
        data: null,
      });
    }
    trackSelectionAnalytics("tab_switched", buildAnalyticsPayload(currentSelection));
  };

  const handleAddToGlossary = (translation: string | undefined) => {
    if (!currentSelection || !translation) {
      return;
    }

    onAppendGlossaryEntry(`${currentSelection.trimmedText} -> ${translation}`);
    setDictionaryState(IDLE_DICTIONARY_STATE);
    trackSelectionAnalytics("glossary_action_clicked", buildAnalyticsPayload(currentSelection));
  };

  const handleApplyTranslation = () => {
    const translation = aiState.data?.translationNatural;
    if (!currentSelection || !translation) {
      return;
    }

    onApplyTranslation(translation);
    trackSelectionAnalytics("apply_translation_clicked", buildAnalyticsPayload(currentSelection));
  };

  const bubblePosition = currentSelection ? computeMiniBubblePosition(currentSelection.rect) : null;
  const inspectorPosition = currentSelection
    ? computeInspectorPosition(currentSelection.rect, inspectorSize)
    : null;

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/5 dark:bg-zinc-900">
        <div className="border-b border-black/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest opacity-50 dark:border-white/5">
          Bản gốc
        </div>
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-base leading-relaxed md:p-8 md:text-lg"
          style={readingFontStyle}
        >
          {originalText}
        </div>
      </div>

      {currentSelection && isBubbleVisible && bubblePosition && (
        <SelectionMiniBubble
          selection={currentSelection}
          position={bubblePosition}
          onOpenInspector={handleOpenInspector}
          onCopySelection={() => {
            void copyToClipboard(currentSelection.trimmedText);
          }}
        />
      )}

      {currentSelection && isInspectorOpen && inspectorPosition && inspectorPosition.placement === "center" && (
        <button
          type="button"
          aria-label="Đóng inspector vùng chọn"
          className="fixed inset-0 z-[63] bg-black/30"
          onClick={() => {
            setIsInspectorOpen(false);
            setCurrentSelection(null);
            setPinned(false);
            setDictionaryState(IDLE_DICTIONARY_STATE);
            setAiState(IDLE_AI_STATE);
            clearSelection();
            trackSelectionAnalytics("popup_closed", buildAnalyticsPayload(currentSelection));
          }}
        />
      )}

      {currentSelection && isInspectorOpen && inspectorPosition && (
        <SelectionInspector
          selection={currentSelection}
          position={inspectorPosition}
          inspectorRef={inspectorRef}
          activeTab={activeTab}
          pinned={pinned}
          dictionaryState={dictionaryState}
          aiState={aiState}
          onClose={() => {
            setIsInspectorOpen(false);
            setCurrentSelection(null);
            setPinned(false);
            setDictionaryState(IDLE_DICTIONARY_STATE);
            setAiState(IDLE_AI_STATE);
            clearSelection();
            trackSelectionAnalytics("popup_closed", buildAnalyticsPayload(currentSelection));
          }}
          onTogglePin={() => setPinned((prev) => !prev)}
          onTabChange={handleSwitchTab}
          onCopySelection={() => {
            void copyToClipboard(currentSelection.trimmedText);
          }}
          onCopyDictionaryMeaning={() => {
            void copyToClipboard(dictionaryState.data?.primaryMeaning ?? "");
          }}
          onCopyAiTranslation={() => {
            void copyToClipboard(aiState.data?.translationNatural ?? "");
          }}
          onOpenAiTab={() => handleSwitchTab("ai")}
          onAddGlossaryFromDictionary={() => handleAddToGlossary(dictionaryState.data?.primaryMeaning)}
          onAddGlossaryFromAi={() => handleAddToGlossary(aiState.data?.translationNatural)}
          onApplyAiTranslation={handleApplyTranslation}
        />
      )}
    </>
  );
}
