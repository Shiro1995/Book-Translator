import { AlertCircle, CheckCircle2, Copy, Loader2, Sparkles } from "lucide-react";
import type { SelectionAiResult, SelectionSnapshot } from "../types";

interface AiContextTabProps {
  selection: SelectionSnapshot;
  isLoading: boolean;
  errorMessage?: string | null;
  result: SelectionAiResult | null;
  onCopyTranslation: () => void;
  onApplyTranslation: () => void;
  onAddToGlossary: () => void;
}

function LoadingSection({
  title,
  lines = 3,
}: {
  title: string;
  lines?: number;
}) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={`${title}-${index}`}
            className="h-4 animate-pulse rounded bg-black/5 dark:bg-white/5"
            style={{ width: `${100 - index * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AiContextTab({
  selection,
  isLoading,
  errorMessage,
  result,
  onCopyTranslation,
  onApplyTranslation,
  onAddToGlossary,
}: AiContextTabProps) {
  const isPending = isLoading || (!result && !errorMessage);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            Dịch ngữ cảnh AI
          </span>
          <span className="inline-flex rounded-full bg-black/5 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
            {selection.classifier.reason}
          </span>
          {isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
              <Loader2 size={12} className="animate-spin" />
              Đang phân tích
            </span>
          )}
        </div>
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Bản dịch tự nhiên</div>
        {result?.translationNatural ? (
          <div className="mt-2 text-lg font-semibold leading-relaxed">{result.translationNatural}</div>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="h-5 w-[88%] animate-pulse rounded bg-emerald-500/10" />
            <div className="h-5 w-[72%] animate-pulse rounded bg-emerald-500/10" />
          </div>
        )}
        {result?.translationLiteral ? (
          <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-medium">Bản sát nghĩa:</span> {result.translationLiteral}
          </div>
        ) : (
          isPending && <div className="mt-3 h-4 w-[62%] animate-pulse rounded bg-black/5 dark:bg-white/5" />
        )}
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-300">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            AI chưa phản hồi được
          </div>
          <div>{errorMessage}</div>
        </div>
      ) : result?.explanation ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Giải thích ngữ cảnh</div>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">{result.explanation}</p>
        </div>
      ) : (
        <LoadingSection title="Giải thích ngữ cảnh" lines={4} />
      )}

      {result?.warnings && result.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-zinc-700 dark:text-zinc-200">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <AlertCircle size={16} />
            Lưu ý
          </div>
          <ul className="space-y-1 text-sm">
            {result.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : (
        <LoadingSection title="Cảnh báo và nuance" lines={2} />
      )}

      {result?.alternatives && result.alternatives.length > 0 ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">Các cách hiểu khác</div>
          <div className="space-y-2">
            {result.alternatives.map((alternative) => (
              <div
                key={`${alternative.text}-${alternative.note ?? ""}`}
                className="rounded-xl bg-black/5 p-3 dark:bg-white/5"
              >
                <div className="font-medium">{alternative.text}</div>
                {alternative.note && <div className="mt-1 text-xs text-zinc-500">{alternative.note}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <LoadingSection title="Các cách hiểu khác" lines={3} />
      )}

      {result?.glossaryApplied && result.glossaryApplied.length > 0 ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">Glossary áp dụng</div>
          <div className="space-y-2">
            {result.glossaryApplied.map((entry) => (
              <div
                key={`${entry.sourceTerm}-${entry.targetTerm}`}
                className="flex items-start gap-3 rounded-xl bg-black/5 p-3 dark:bg-white/5"
              >
                <CheckCircle2 size={16} className="mt-0.5 text-emerald-600" />
                <div>
                  <div className="font-medium">
                    {entry.sourceTerm} → {entry.targetTerm}
                  </div>
                  {entry.note && <div className="mt-1 text-xs text-zinc-500">{entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <LoadingSection title="Glossary áp dụng" lines={2} />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopyTranslation}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <Copy size={14} />
          Copy bản dịch
        </button>
        <button
          type="button"
          onClick={onApplyTranslation}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          <Sparkles size={14} />
          Đưa sang cột dịch
        </button>
        <button
          type="button"
          onClick={onAddToGlossary}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <CheckCircle2 size={14} />
          Lưu vào glossary
        </button>
      </div>
    </div>
  );
}
