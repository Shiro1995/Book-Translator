import type { SelectionAnchorRect } from "../types";

export interface OverlayCoordinates {
  top: number;
  left: number;
  placement: "top" | "bottom" | "right" | "left" | "center" | "docked-right";
}

const EDGE_PADDING = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getViewportRect() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function computeMiniBubblePosition(
  anchor: SelectionAnchorRect,
  size = { width: 196, height: 44 },
): OverlayCoordinates {
  const viewport = getViewportRect();
  const fitsAbove = anchor.top >= size.height + EDGE_PADDING * 2;
  const top = fitsAbove
    ? anchor.top - size.height - 10
    : clamp(anchor.bottom + 10, EDGE_PADDING, viewport.height - size.height - EDGE_PADDING);
  const left = clamp(
    anchor.left + anchor.width / 2 - size.width / 2,
    EDGE_PADDING,
    viewport.width - size.width - EDGE_PADDING,
  );

  return {
    top,
    left,
    placement: fitsAbove ? "top" : "bottom",
  };
}

export function computeInspectorPosition(
  anchor: SelectionAnchorRect,
  size = { width: 420, height: 520 },
): OverlayCoordinates {
  const viewport = getViewportRect();
  const safeWidth = Math.min(size.width, viewport.width - EDGE_PADDING * 2);
  const safeHeight = Math.min(size.height, viewport.height - EDGE_PADDING * 2);

  if (viewport.width < 960) {
    return {
      top: clamp(viewport.height - safeHeight - EDGE_PADDING, EDGE_PADDING, viewport.height - safeHeight),
      left: clamp((viewport.width - safeWidth) / 2, EDGE_PADDING, viewport.width - safeWidth),
      placement: "center",
    };
  }

  const availableRight = viewport.width - anchor.right - EDGE_PADDING;
  if (availableRight >= safeWidth) {
    return {
      top: clamp(anchor.top - 20, EDGE_PADDING, viewport.height - safeHeight - EDGE_PADDING),
      left: clamp(anchor.right + 16, EDGE_PADDING, viewport.width - safeWidth - EDGE_PADDING),
      placement: "right",
    };
  }

  if (anchor.left - EDGE_PADDING >= safeWidth) {
    return {
      top: clamp(anchor.top - 20, EDGE_PADDING, viewport.height - safeHeight - EDGE_PADDING),
      left: clamp(anchor.left - safeWidth - 16, EDGE_PADDING, viewport.width - safeWidth - EDGE_PADDING),
      placement: "left",
    };
  }

  return {
    top: EDGE_PADDING,
    left: clamp(viewport.width - safeWidth - EDGE_PADDING, EDGE_PADDING, viewport.width - safeWidth),
    placement: "docked-right",
  };
}

export function rectFromDomRect(rect: DOMRect): SelectionAnchorRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function getSelectionAnchorRect(range: Range): SelectionAnchorRect | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  const targetRect = rects.at(-1) ?? range.getBoundingClientRect();

  if (!targetRect || (targetRect.width === 0 && targetRect.height === 0)) {
    return null;
  }

  return rectFromDomRect(targetRect);
}
