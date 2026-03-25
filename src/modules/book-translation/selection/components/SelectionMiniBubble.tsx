import { BookOpen, Copy, Sparkles } from "lucide-react";
import type { SelectionSnapshot } from "../types";
import type { OverlayCoordinates } from "../utils/overlayPosition";

interface SelectionMiniBubbleProps {
  selection: SelectionSnapshot;
  position: OverlayCoordinates;
  onOpenInspector: () => void;
  onCopySelection: () => void;
}

export function SelectionMiniBubble({
  selection,
  position,
  onOpenInspector,
  onCopySelection,
}: SelectionMiniBubbleProps) {
  const isDictionary = selection.classifier.defaultTab === "dictionary";

  return (
    <div
      data-selection-bubble="true"
      className="fixed z-[64] flex items-center gap-2 rounded-full border border-black/10 bg-white/95 px-2 py-2 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-zinc-900/95"
      style={{
        top: position.top,
        left: position.left,
      }}
      role="toolbar"
      aria-label="Thao tác nhanh cho vùng chọn"
    >
      <button
        type="button"
        onClick={onOpenInspector}
        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
      >
        {isDictionary ? <BookOpen size={14} /> : <Sparkles size={14} />}
        {isDictionary ? "Tra cứu" : "Dịch AI"}
      </button>
      <button
        type="button"
        onClick={onCopySelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 text-zinc-600 transition hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
        aria-label="Sao chép vùng chọn"
      >
        <Copy size={14} />
      </button>
    </div>
  );
}
