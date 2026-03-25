import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GlossaryEntry, SelectionSnapshot } from "../types";
import { buildSelectionMetrics } from "../utils/selectionMetrics";
import {
  buildContextHash,
  normalizeLookupText,
  normalizeSelectionText,
} from "../utils/selectionNormalization";
import { getSelectionAnchorRect } from "../utils/overlayPosition";
import { classifySelection } from "../services/selectionClassifier";
import { findExactGlossaryMatch, findGlossaryCandidates } from "../services/glossaryLookupService";

function containsNode(container: HTMLElement, node: Node | null) {
  if (!node) {
    return false;
  }

  return container.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

function shouldIgnoreEventTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest("[data-selection-inspector='true']") ||
        target.closest("[data-selection-bubble='true']"),
    )
  );
}

function getRangeOffsets(container: HTMLElement, range: Range) {
  const startRange = range.cloneRange();
  startRange.selectNodeContents(container);
  startRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = startRange.toString().length;

  const selectedLength = range.toString().length;
  return {
    startOffset,
    endOffset: startOffset + selectedLength,
  };
}

function extractParagraph(pageText: string, startOffset: number, endOffset: number) {
  const paragraphStart = pageText.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1;
  const paragraphEndCandidate = pageText.indexOf("\n", endOffset);
  const paragraphEnd = paragraphEndCandidate === -1 ? pageText.length : paragraphEndCandidate;
  return pageText.slice(paragraphStart, paragraphEnd).trim();
}

function buildSelectionSnapshot(args: {
  bookId: string;
  pageId: number;
  pageText: string;
  selectionText: string;
  rect: NonNullable<SelectionSnapshot["rect"]>;
  glossary: GlossaryEntry[];
  startOffset: number;
  endOffset: number;
}): SelectionSnapshot {
  const exactGlossaryMatch = Boolean(findExactGlossaryMatch(args.selectionText, args.glossary));
  const partialGlossaryMatch = findGlossaryCandidates(args.selectionText, args.glossary).length > 0;
  const metrics = buildSelectionMetrics(args.selectionText, {
    exactGlossaryMatch,
    partialGlossaryMatch,
  });
  const classifier = classifySelection(metrics);
  const trimmedText = normalizeSelectionText(args.selectionText).trim();
  const normalizedText = normalizeLookupText(trimmedText, metrics.language);
  const beforeText = args.pageText.slice(Math.max(0, args.startOffset - 180), args.startOffset).trim();
  const afterText = args.pageText.slice(args.endOffset, args.endOffset + 180).trim();
  const paragraphText = extractParagraph(args.pageText, args.startOffset, args.endOffset);
  const contextHash = buildContextHash([
    normalizedText,
    beforeText,
    afterText,
    paragraphText,
    String(args.pageId),
  ]);

  return {
    id: `${args.bookId}-${args.pageId}-${contextHash}`,
    bookId: args.bookId,
    pageId: args.pageId,
    text: args.selectionText,
    trimmedText,
    normalizedText,
    rect: args.rect,
    metrics,
    classifier,
    contextWindow: {
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      beforeText,
      afterText,
      paragraphText,
      pageText: args.pageText,
      contextHash,
    },
  };
}

interface UseTextSelectionOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  bookId?: string;
  pageId?: number;
  pageText: string;
  glossaryEntries: GlossaryEntry[];
}

export function useTextSelection(options: UseTextSelectionOptions) {
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const updateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!options.enabled || !options.bookId || options.pageId == null) {
      setSelection(null);
      return;
    }

    const scheduleSelectionSync = (event?: Event) => {
      if (shouldIgnoreEventTarget(event?.target ?? null)) {
        return;
      }

      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
      }

      updateTimerRef.current = window.setTimeout(() => {
        const container = options.containerRef.current;
        const domSelection = window.getSelection();

        if (
          !container ||
          !domSelection ||
          domSelection.rangeCount === 0 ||
          domSelection.isCollapsed
        ) {
          setSelection(null);
          return;
        }

        const range = domSelection.getRangeAt(0);
        if (
          !containsNode(container, range.commonAncestorContainer) ||
          !containsNode(container, range.startContainer) ||
          !containsNode(container, range.endContainer)
        ) {
          setSelection(null);
          return;
        }

        const selectionText = domSelection.toString();
        if (!normalizeSelectionText(selectionText).trim()) {
          setSelection(null);
          return;
        }

        const rect = getSelectionAnchorRect(range);
        if (!rect) {
          setSelection(null);
          return;
        }

        const offsets = getRangeOffsets(container, range);
        setSelection(
          buildSelectionSnapshot({
            bookId: options.bookId,
            pageId: options.pageId,
            pageText: options.pageText,
            selectionText,
            rect,
            glossary: options.glossaryEntries,
            startOffset: offsets.startOffset,
            endOffset: offsets.endOffset,
          }),
        );
      }, 70);
    };

    document.addEventListener("selectionchange", scheduleSelectionSync);
    document.addEventListener("mouseup", scheduleSelectionSync);
    document.addEventListener("keyup", scheduleSelectionSync);
    document.addEventListener("touchend", scheduleSelectionSync);
    window.addEventListener("scroll", scheduleSelectionSync, true);
    window.addEventListener("resize", scheduleSelectionSync);

    return () => {
      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
      }
      document.removeEventListener("selectionchange", scheduleSelectionSync);
      document.removeEventListener("mouseup", scheduleSelectionSync);
      document.removeEventListener("keyup", scheduleSelectionSync);
      document.removeEventListener("touchend", scheduleSelectionSync);
      window.removeEventListener("scroll", scheduleSelectionSync, true);
      window.removeEventListener("resize", scheduleSelectionSync);
    };
  }, [
    options.bookId,
    options.containerRef,
    options.enabled,
    options.glossaryEntries,
    options.pageId,
    options.pageText,
  ]);

  const clearSelection = useCallback(() => {
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    setSelection(null);
  }, []);

  return {
    selection,
    clearSelection,
  };
}
