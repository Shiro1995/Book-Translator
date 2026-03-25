import { ArrowRight, BookOpen, Copy, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type {
  DictionaryLookupResult,
  SelectionSnapshot,
  VietnameseAssistResult,
} from "../types";

interface AsyncAssistState {
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  data: VietnameseAssistResult | null;
}

interface DictionaryTabProps {
  selection: SelectionSnapshot;
  isLoading: boolean;
  errorMessage?: string | null;
  result: DictionaryLookupResult | null;
  vietnameseAssistState: AsyncAssistState;
  hideVietnameseAssist?: boolean;
  allowAiActions?: boolean;
  allowGlossaryActions?: boolean;
  onOpenAiTab: () => void;
  onRetryVietnameseAssist: () => void;
  onCopyMeaning: () => void;
  onAddToGlossary: () => void;
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
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

function sourceLabel(source: DictionaryLookupResult["source"]) {
  switch (source) {
    case "glossary":
      return "Nguồn: glossary";
    case "generated-helper":
      return "Nguồn: helper nội bộ";
    case "vi-viet-dictionary":
      return "Nguồn: Việt-Việt";
    case "internal-dictionary":
      return "Nguồn: dictionary";
    default:
      return "Nguồn: chưa có adapter ngoài";
  }
}

export function DictionaryTab({
  selection,
  isLoading,
  errorMessage,
  result,
  vietnameseAssistState,
  hideVietnameseAssist = false,
  allowAiActions = true,
  allowGlossaryActions = true,
  onOpenAiTab,
  onRetryVietnameseAssist,
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
  const vietnameseAssistResult = vietnameseAssistState.data;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={selection.metrics.exactGlossaryMatch ? "success" : "default"}>
            {selection.metrics.exactGlossaryMatch ? "Khớp glossary" : "Tra cứu ngắn"}
          </Badge>
          <Badge tone={isUnsupported ? "warning" : "default"}>{sourceLabel(result.source)}</Badge>
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
        {result.suggestion && (
          <p className="mt-2 rounded-xl bg-black/5 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
            {result.suggestion}
          </p>
        )}
      </div>

      {!hideVietnameseAssist && (
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Giải thích tiếng Việt</div>
            {vietnameseAssistResult?.source && vietnameseAssistResult.source !== "none" && (
              <Badge>
                {vietnameseAssistResult.source === "internal-provider" && "Nguồn: nội bộ"}
                {vietnameseAssistResult.source === "laban" && "Nguồn: Laban"}
                {vietnameseAssistResult.source === "ai-micro" && "Nguồn: AI micro"}
              </Badge>
            )}
          </div>

          {vietnameseAssistState.status === "loading" && (
            <div className="space-y-2">
              <div className="h-4 w-[92%] animate-pulse rounded bg-black/5 dark:bg-white/5" />
              <div className="h-4 w-[74%] animate-pulse rounded bg-black/5 dark:bg-white/5" />
            </div>
          )}

          {vietnameseAssistState.status === "error" && (
            <div className="rounded-xl bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-300">
              <p>Không thể tải giải thích tiếng Việt: {vietnameseAssistState.error}</p>
              <button
                type="button"
                onClick={onRetryVietnameseAssist}
                className="mt-2 inline-flex items-center gap-2 rounded-full border border-red-500/20 px-3 py-1.5 font-medium hover:bg-red-500/10"
              >
                Thử lại
              </button>
            </div>
          )}

          {vietnameseAssistState.status === "success" && vietnameseAssistResult?.status === "success" && (
            <div className="space-y-3">
              {vietnameseAssistResult.explanation && (
                <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">
                  {vietnameseAssistResult.explanation}
                </p>
              )}
              {vietnameseAssistResult.note && (
                <p className="rounded-xl bg-black/5 px-3 py-2 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                  {vietnameseAssistResult.note}
                </p>
              )}
              {vietnameseAssistResult.englishAssist && (
                <div className="rounded-xl border border-black/10 p-3 text-xs dark:border-white/10">
                  <div className="font-semibold">{vietnameseAssistResult.englishAssist.word}</div>
                  {vietnameseAssistResult.englishAssist.pronunciation && (
                    <div className="mt-1 opacity-70">{vietnameseAssistResult.englishAssist.pronunciation}</div>
                  )}
                  {vietnameseAssistResult.englishAssist.definitions[0] && (
                    <div className="mt-2 leading-relaxed opacity-80">
                      EN: {vietnameseAssistResult.englishAssist.definitions[0]}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {vietnameseAssistState.status === "success" && vietnameseAssistResult?.status === "empty" && (
            <p className="text-xs text-zinc-500">{vietnameseAssistResult.note ?? "Chưa có diễn giải tiếng Việt."}</p>
          )}

          {vietnameseAssistState.status === "success" && vietnameseAssistResult?.status === "unsupported" && (
            <p className="text-xs text-zinc-500">
              {vietnameseAssistResult.note ??
                "Block này chỉ áp dụng cho từ/cụm ngắn. Với đoạn dài, hãy dùng tab AI ngữ cảnh."}
            </p>
          )}
        </div>
      )}

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

      {allowAiActions && (isUnsupported || isEmpty) && (
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
          {allowGlossaryActions && (
            <button
              type="button"
              onClick={onAddToGlossary}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <BookOpen size={14} />
              Thêm vào glossary
            </button>
          )}
          {allowAiActions && (
            <button
              type="button"
              onClick={onOpenAiTab}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <Sparkles size={14} />
              Giải thích bằng AI
            </button>
          )}
        </div>
      )}
    </div>
  );
}
