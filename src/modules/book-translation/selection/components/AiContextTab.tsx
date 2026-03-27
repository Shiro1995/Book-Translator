import { useEffect, useMemo, useState } from "react";
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

function EmptySection({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{message}</p>
    </div>
  );
}

function hasInsightDetails(result: SelectionAiResult | null) {
  if (!result) return false;

  return Boolean(
    result.translationLiteral ||
      result.confidence !== undefined ||
      (result.warnings?.length ?? 0) > 0 ||
      (result.alternatives?.length ?? 0) > 0 ||
      (result.glossaryApplied?.length ?? 0) > 0 ||
      (result.segmentation?.length ?? 0) > 0,
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
  const [showDetails, setShowDetails] = useState(false);
  const canShowDetails = useMemo(() => hasInsightDetails(result), [result]);
  const missingExplanationMessage =
    result?.detailLevel === "quick"
      ? "B\u1ea3n d\u1ecbch nhanh \u0111\u00e3 c\u00f3, gi\u1ea3i th\u00edch s\u1ebd hi\u1ec7n khi insights ho\u00e0n t\u1ea5t."
      : "Ch\u01b0a c\u00f3 ghi ch\u00fa ng\u1eef c\u1ea3nh b\u1ed5 sung.";

  useEffect(() => {
    setShowDetails(false);
  }, [selection.id]);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {"D\u1ecbch ng\u1eef c\u1ea3nh AI"}
          </span>
          {isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
              <Loader2 size={12} className="animate-spin" />
              {"\u0110ang ph\u00e2n t\u00edch"}
            </span>
          )}
        </div>
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          {"B\u1ea3n d\u1ecbch t\u1ef1 nhi\u00ean"}
        </div>
        {result?.translationNatural ? (
          <div className="mt-2 text-lg font-semibold leading-relaxed">{result.translationNatural}</div>
        ) : isPending ? (
          <div className="mt-3 space-y-2">
            <div className="h-5 w-[88%] animate-pulse rounded bg-emerald-500/10" />
            <div className="h-5 w-[72%] animate-pulse rounded bg-emerald-500/10" />
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {"Ch\u01b0a c\u00f3 b\u1ea3n d\u1ecbch t\u1eeb AI."}
          </div>
        )}
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-300">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            {"AI ch\u01b0a ph\u1ea3n h\u1ed3i \u0111\u01b0\u1ee3c"}
          </div>
          <div>{errorMessage}</div>
        </div>
      ) : result?.explanation ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"Gi\u1ea3i th\u00edch ng\u1eef c\u1ea3nh"}
          </div>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">{result.explanation}</p>
        </div>
      ) : isPending ? (
        <LoadingSection title={"Gi\u1ea3i th\u00edch ng\u1eef c\u1ea3nh"} lines={2} />
      ) : (
        <EmptySection
          title={"Gi\u1ea3i th\u00edch ng\u1eef c\u1ea3nh"}
          message={missingExplanationMessage}
        />
      )}

      {canShowDetails && (
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          aria-expanded={showDetails}
        >
          {showDetails ? "\u1ea8n chi ti\u1ebft" : "Xem chi ti\u1ebft"}
        </button>
      )}

      {showDetails && result?.translationLiteral ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"B\u1ea3n s\u00e1t ngh\u0129a"}
          </div>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">{result.translationLiteral}</p>
        </div>
      ) : null}

      {showDetails && result?.warnings && result.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-zinc-700 dark:text-zinc-200">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <AlertCircle size={16} />
            {"L\u01b0u \u00fd"}
          </div>
          <ul className="space-y-1 text-sm">
            {result.warnings.map((warning) => (
              <li key={warning}>
                {"\u2022"} {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showDetails && result?.alternatives && result.alternatives.length > 0 ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"C\u00e1c c\u00e1ch hi\u1ec3u kh\u00e1c"}
          </div>
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
      ) : null}

      {showDetails && result?.glossaryApplied && result.glossaryApplied.length > 0 ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"Glossary \u00e1p d\u1ee5ng"}
          </div>
          <div className="space-y-2">
            {result.glossaryApplied.map((entry) => (
              <div
                key={`${entry.sourceTerm}-${entry.targetTerm}`}
                className="flex items-start gap-3 rounded-xl bg-black/5 p-3 dark:bg-white/5"
              >
                <CheckCircle2 size={16} className="mt-0.5 text-emerald-600" />
                <div>
                  <div className="font-medium">
                    {entry.sourceTerm} {"\u2192"} {entry.targetTerm}
                  </div>
                  {entry.note && <div className="mt-1 text-xs text-zinc-500">{entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showDetails && result?.confidence !== undefined ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"\u0110\u1ed9 tin c\u1eady"}
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{Math.round(result.confidence * 100)}%</p>
        </div>
      ) : null}

      {showDetails && result?.segmentation && result.segmentation.length > 0 ? (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {"T\u00e1ch \u0111o\u1ea1n"}
          </div>
          <div className="space-y-2">
            {result.segmentation.map((segment) => (
              <div
                key={`${segment.source}-${segment.explanation ?? ""}`}
                className="rounded-xl bg-black/5 p-3 dark:bg-white/5"
              >
                <div className="font-medium">{segment.source}</div>
                {segment.explanation && (
                  <div className="mt-1 text-xs text-zinc-500">{segment.explanation}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopyTranslation}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <Copy size={14} />
          {"Copy b\u1ea3n d\u1ecbch"}
        </button>
        <button
          type="button"
          onClick={onApplyTranslation}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          <Sparkles size={14} />
          {"\u0110\u01b0a sang c\u1ed9t d\u1ecbch"}
        </button>
        <button
          type="button"
          onClick={onAddToGlossary}
          disabled={!result?.translationNatural}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <CheckCircle2 size={14} />
          {"L\u01b0u v\u00e0o glossary"}
        </button>
      </div>
    </div>
  );
}
