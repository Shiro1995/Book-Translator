import type { RefObject } from "react";
import { BookOpen, Copy, Pin, PinOff, Sparkles, X } from "lucide-react";
import type { DictionaryLookupResult, SelectionAiResult, SelectionSnapshot, SelectionTab } from "../types";
import type { OverlayCoordinates } from "../utils/overlayPosition";
import { DictionaryTab } from "./DictionaryTab";
import { AiContextTab } from "./AiContextTab";

interface AsyncTabState<T> {
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  data: T | null;
}

interface SelectionInspectorProps {
  selection: SelectionSnapshot;
  position: OverlayCoordinates;
  inspectorRef: RefObject<HTMLElement | null>;
  activeTab: SelectionTab;
  pinned: boolean;
  dictionaryState: AsyncTabState<DictionaryLookupResult>;
  aiState: AsyncTabState<SelectionAiResult>;
  onClose: () => void;
  onTogglePin: () => void;
  onTabChange: (tab: SelectionTab) => void;
  onCopySelection: () => void;
  onCopyDictionaryMeaning: () => void;
  onCopyAiTranslation: () => void;
  onOpenAiTab: () => void;
  onAddGlossaryFromDictionary: () => void;
  onAddGlossaryFromAi: () => void;
  onApplyAiTranslation: () => void;
}

function tabClassName(isActive: boolean) {
  return isActive
    ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
    : "text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5";
}

export function SelectionInspector({
  selection,
  position,
  inspectorRef,
  activeTab,
  pinned,
  dictionaryState,
  aiState,
  onClose,
  onTogglePin,
  onTabChange,
  onCopySelection,
  onCopyDictionaryMeaning,
  onCopyAiTranslation,
  onOpenAiTab,
  onAddGlossaryFromDictionary,
  onAddGlossaryFromAi,
  onApplyAiTranslation,
}: SelectionInspectorProps) {
  const isCentered = position.placement === "center";
  const width = isCentered ? "min(calc(100vw - 24px), 480px)" : 420;
  const maxHeight = isCentered ? "calc(100vh - 24px)" : "min(calc(100vh - 24px), 560px)";

  return (
    <section
      ref={inspectorRef}
      data-selection-inspector="true"
      className="fixed z-[65] flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-black/10 bg-white/98 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-zinc-900/98"
      style={{
        top: position.top,
        left: position.left,
        width,
        maxHeight,
      }}
      role="dialog"
      aria-modal={isCentered}
      aria-labelledby="selection-inspector-title"
    >
      <header className="border-b border-black/10 p-4 dark:border-white/10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Vùng chọn</div>
            <h3 id="selection-inspector-title" className="mt-1 line-clamp-2 text-base font-semibold leading-relaxed">
              {selection.trimmedText}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{selection.classifier.reason}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCopySelection}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              aria-label="Sao chép vùng chọn"
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              onClick={onTogglePin}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              aria-label={pinned ? "Bỏ ghim inspector" : "Ghim inspector"}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              aria-label="Đóng inspector"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="inline-flex rounded-full bg-black/5 p-1 dark:bg-white/5" role="tablist" aria-label="Tab tra cứu và AI">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "dictionary"}
            onClick={() => onTabChange("dictionary")}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${tabClassName(
              activeTab === "dictionary",
            )}`}
          >
            <BookOpen size={15} />
            Tra cứu
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ai"}
            onClick={() => onTabChange("ai")}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${tabClassName(
              activeTab === "ai",
            )}`}
          >
            <Sparkles size={15} />
            AI ngữ cảnh
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "dictionary" ? (
          <DictionaryTab
            selection={selection}
            isLoading={dictionaryState.status === "loading"}
            errorMessage={dictionaryState.status === "error" ? dictionaryState.error : null}
            result={dictionaryState.data}
            onOpenAiTab={onOpenAiTab}
            onCopyMeaning={onCopyDictionaryMeaning}
            onAddToGlossary={onAddGlossaryFromDictionary}
          />
        ) : (
          <AiContextTab
            selection={selection}
            isLoading={aiState.status === "loading"}
            errorMessage={aiState.status === "error" ? aiState.error : null}
            result={aiState.data}
            onCopyTranslation={onCopyAiTranslation}
            onApplyTranslation={onApplyAiTranslation}
            onAddToGlossary={onAddGlossaryFromAi}
          />
        )}
      </div>
    </section>
  );
}
