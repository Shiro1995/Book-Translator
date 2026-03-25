import { ArrowRight, BookOpen, Copy, Sparkles } from "lucide-react";
import type { DictionaryLookupResult, SelectionSnapshot } from "../types";

interface DictionaryTabProps {
  selection: SelectionSnapshot;
  isLoading: boolean;
  errorMessage?: string | null;
  result: DictionaryLookupResult | null;
  onOpenAiTab: () => void;
  onCopyMeaning: () => void;
  onAddToGlossary: () => void;
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const toneClassName =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-black/5 text-zinc-700 dark:bg-white/5 dark:text-zinc-300";

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${toneClassName}`}>
      {children}
    </span>
  );
}

export function DictionaryTab({
  selection,
  isLoading,
  errorMessage,
  result,
  onOpenAiTab,
  onCopyMeaning,
  onAddToGlossary,
}: DictionaryTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-28 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-16 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
        <div className="h-24 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-300">
        Không thể tải tab tra cứu: {errorMessage}
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const isUnsupported = result.status === "unsupported";
  const isEmpty = result.status === "empty";

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={selection.metrics.exactGlossaryMatch ? "success" : "default"}>
            {selection.metrics.exactGlossaryMatch ? "Khớp glossary" : "Tra cứu ngắn"}
          </Badge>
          <Badge tone={isUnsupported ? "warning" : "default"}>
            {result.source === "glossary"
              ? "Nguồn: glossary"
              : result.source === "generated-helper"
                ? "Nguồn: helper nội bộ"
                : "Nguồn: chưa có adapter ngoài"}
          </Badge>
        </div>
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Vùng chọn</div>
        <div className="mt-2 text-base font-medium leading-relaxed">{selection.trimmedText}</div>
      </div>

      <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Kết quả tra cứu</div>
            <div className="mt-1 text-lg font-semibold">
              {result.primaryMeaning ?? "Chưa có mục khớp trực tiếp"}
            </div>
          </div>
          {result.primaryMeaning && (
            <button
              type="button"
              onClick={onCopyMeaning}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <Copy size={14} />
              Copy
            </button>
          )}
        </div>

        {result.partOfSpeech && <div className="text-xs text-zinc-500">Loại từ: {result.partOfSpeech}</div>}
        {result.message && <p className="mt-3 leading-relaxed text-zinc-600 dark:text-zinc-300">{result.message}</p>}
        {result.suggestion && (
          <p className="mt-2 rounded-xl bg-black/5 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
            {result.suggestion}
          </p>
        )}
      </div>

      {result.tokenBreakdown.length > 0 && !isUnsupported && (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">Token breakdown</div>
          <div className="flex flex-wrap gap-2">
            {result.tokenBreakdown.map((item) => (
              <div
                key={`${item.normalizedToken}-${item.token}`}
                className="rounded-2xl border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <div className="font-medium">{item.token}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {item.glossaryMatch ? item.glossaryMatch.targetTerm : "Chưa có glossary match"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(isUnsupported || isEmpty) && (
        <button
          type="button"
          onClick={onOpenAiTab}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-black"
        >
          <Sparkles size={15} />
          Mở AI ngữ cảnh
          <ArrowRight size={14} />
        </button>
      )}

      {!isUnsupported && result.primaryMeaning && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddToGlossary}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <BookOpen size={14} />
            Thêm vào glossary
          </button>
          <button
            type="button"
            onClick={onOpenAiTab}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Sparkles size={14} />
            Giải thích bằng AI
          </button>
        </div>
      )}
    </div>
  );
}
