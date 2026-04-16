import { Fragment, useDeferredValue, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { routePaths } from "@/app/router/paths";
import {
  clearStoredRequestHistoryAdminCode,
  getStoredRequestHistoryAdminCode,
  getRequestHistory,
  RequestHistoryApiError,
  setStoredRequestHistoryAdminCode,
  type RequestHistoryItem,
  type RequestHistoryResponse,
} from "@/app/services/requestHistoryService";

const DEFAULT_LIMIT = 120;
const AUTO_REFRESH_INTERVAL_MS = 5_000;

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDuration(durationMs: number) {
  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }

  return `${durationMs}ms`;
}

function getDurationTone(durationMs: number) {
  if (durationMs >= 60_000) {
    return "text-rose-600 dark:text-rose-300";
  }

  if (durationMs >= 10_000) {
    return "text-amber-600 dark:text-amber-300";
  }

  return "text-emerald-600 dark:text-emerald-300";
}

function getStatusTone(status: number) {
  if (status >= 500) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }

  if (status >= 400) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }

  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function toPrettyJson(value: unknown) {
  if (value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toSingleLinePreview(value: unknown) {
  const pretty = toPrettyJson(value).replace(/\s+/g, " ").trim();

  if (!pretty) {
    return "-";
  }

  if (pretty.length <= 160) {
    return pretty;
  }

  return `${pretty.slice(0, 160)}...`;
}

function matchesSearch(item: RequestHistoryItem, searchText: string) {
  if (!searchText) {
    return true;
  }

  const haystacks = [
    item.requestId,
    item.path,
    item.method,
    item.feature,
    item.jobStatus,
    item.jobId,
    item.bookName,
    item.model,
    item.errorCode,
    item.error,
    toSingleLinePreview(item.providerPayload),
    toSingleLinePreview(item.providerResponse),
    toSingleLinePreview(item.requestBody),
    toSingleLinePreview(item.responseBody),
  ];

  return haystacks.some((value) => value?.toString().toLowerCase().includes(searchText));
}

function buildRowKey(item: RequestHistoryItem) {
  return `${item.time}-${item.requestId ?? "na"}-${item.path}-${item.status}`;
}

function resolvePrimaryPayload(item: RequestHistoryItem) {
  return item.providerPayload ?? item.requestBody;
}

function resolvePrimaryResponse(item: RequestHistoryItem) {
  return item.providerResponse ?? item.responseBody;
}

export default function RequestHistoryPage() {
  const [history, setHistory] = useState<RequestHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [adminCode, setAdminCode] = useState(() => getStoredRequestHistoryAdminCode());
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [requiresAdminCode, setRequiresAdminCode] = useState(
    () => !getStoredRequestHistoryAdminCode(),
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [searchText, setSearchText] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const deferredSearchText = useDeferredValue(searchText.trim().toLowerCase());

  async function unlockWithCode(code: string) {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setAuthError("Nhap ma admin de xem history.");
      return;
    }

    setIsUnlocking(true);
    setAuthError(null);

    try {
      const result = await getRequestHistory(
        {
          limit,
          path: pathFilter.trim() || undefined,
          status: statusFilter ? Number(statusFilter) : undefined,
          jobStatus: jobStatusFilter.trim() || undefined,
        },
        undefined,
        trimmedCode,
      );

      setStoredRequestHistoryAdminCode(trimmedCode);
      setAdminCode(trimmedCode);
      setRequiresAdminCode(false);
      setHistory(result);
      setError(null);
      setAdminCodeInput("");
    } catch (unlockError) {
      if (unlockError instanceof RequestHistoryApiError && unlockError.status === 401) {
        setAuthError("Ma admin khong dung.");
      } else {
        setAuthError(unlockError instanceof Error ? unlockError.message : "Khong the xac thuc.");
      }
    } finally {
      setIsUnlocking(false);
    }
  }

  function lockHistoryView() {
    clearStoredRequestHistoryAdminCode();
    setAdminCode("");
    setRequiresAdminCode(true);
    setHistory(null);
    setError(null);
  }

  useEffect(() => {
    if (!adminCode) {
      setRequiresAdminCode(true);
      setIsLoading(false);
      setHistory(null);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    void getRequestHistory(
      {
        limit,
        path: pathFilter.trim() || undefined,
        status: statusFilter ? Number(statusFilter) : undefined,
        jobStatus: jobStatusFilter.trim() || undefined,
      },
      controller.signal,
      adminCode,
    )
      .then((result) => {
        if (!active) {
          return;
        }

        setHistory(result);
        setRequiresAdminCode(false);
      })
      .catch((fetchError) => {
        if (!active || controller.signal.aborted) {
          return;
        }

        if (fetchError instanceof RequestHistoryApiError && fetchError.status === 401) {
          clearStoredRequestHistoryAdminCode();
          setAdminCode("");
          setRequiresAdminCode(true);
          setHistory(null);
          setAuthError("Ma admin khong hop le hoac da thay doi tren server.");
          setError(null);
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to load request history");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [adminCode, jobStatusFilter, limit, pathFilter, refreshTick, statusFilter]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setRefreshTick((value) => value + 1);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefresh]);

  const filteredItems = (history?.items ?? []).filter((item) =>
    matchesSearch(item, deferredSearchText),
  );

  return (
    <main className="min-h-screen bg-[#F5F5F0] px-3 py-4 text-[#141414] dark:bg-[#0A0A0A] dark:text-[#E4E3E0] md:px-4">
      <div className="mx-auto max-w-[1600px]">
        <div className="sticky top-0 z-20 mb-3 rounded-2xl border border-black/10 bg-white/92 p-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-950/92">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={routePaths.home}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <ArrowLeft size={14} />
              Home
            </Link>

            <button
              type="button"
              onClick={() => setRefreshTick((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <RefreshCw size={14} />
              Refresh
            </button>

            <label className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-xs dark:border-white/10">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-black/20 text-emerald-600 focus:ring-emerald-500"
              />
              Auto 5s
            </label>

            {!requiresAdminCode && (
              <button
                type="button"
                onClick={lockHistoryView}
                className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
              >
                Lock
              </button>
            )}

            <input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value) || DEFAULT_LIMIT)}
              placeholder="Limit"
              className="h-8 w-20 rounded-xl border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
            />

            <input
              type="text"
              value={pathFilter}
              onChange={(event) => setPathFilter(event.target.value)}
              placeholder="Path"
              className="h-8 w-32 rounded-xl border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
            />

            <input
              type="number"
              min={100}
              max={599}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              placeholder="Status"
              className="h-8 w-24 rounded-xl border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
            />

            <input
              type="text"
              value={jobStatusFilter}
              onChange={(event) => setJobStatusFilter(event.target.value)}
              placeholder="Job status"
              className="h-8 w-32 rounded-xl border border-black/10 bg-transparent px-2 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
            />

            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search requestId, model, payload, response..."
              className="h-8 min-w-[240px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>
              rows: <strong>{filteredItems.length}</strong>
              {history ? ` / fetched ${history.count}` : ""}
            </span>
            {history && <span>retained: {history.maxEntries}</span>}
            {history?.filePath && <span className="truncate">file: {history.filePath}</span>}
          </div>
        </div>

        {requiresAdminCode && (
          <div className="mb-3 rounded-2xl border border-black/10 bg-white/90 p-3 shadow-sm dark:border-white/10 dark:bg-zinc-950/90">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              Admin code required
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={adminCodeInput}
                onChange={(event) => setAdminCodeInput(event.target.value)}
                placeholder="Nhap ma admin history"
                className="h-9 min-w-[220px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 text-xs outline-none focus:border-emerald-500 dark:border-white/10"
              />
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => void unlockWithCode(adminCodeInput)}
                className="inline-flex h-9 items-center rounded-xl bg-emerald-600 px-4 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUnlocking ? "Checking..." : "Unlock"}
              </button>
            </div>
            {authError && (
              <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">
                {authError}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/90 shadow-sm dark:border-white/10 dark:bg-zinc-950/90">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] table-fixed text-xs">
              <colgroup>
                <col className="w-10" />
                <col className="w-28" />
                <col className="w-[290px]" />
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-44" />
                <col className="w-[300px]" />
                <col className="w-[300px]" />
              </colgroup>
              <thead className="border-b border-black/10 bg-black/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
                <tr>
                  <th className="px-2 py-2 text-left">Open</th>
                  <th className="px-2 py-2 text-left">Time</th>
                  <th className="px-2 py-2 text-left">Request</th>
                  <th className="px-2 py-2 text-left">State</th>
                  <th className="px-2 py-2 text-left">Duration</th>
                  <th className="px-2 py-2 text-left">Meta</th>
                  <th className="px-2 py-2 text-left">Payload</th>
                  <th className="px-2 py-2 text-left">Response</th>
                </tr>
              </thead>
              <tbody>
                {!error && isLoading && !history && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      Loading request history...
                    </td>
                  </tr>
                )}

                {!error && !isLoading && filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      No matching entries.
                    </td>
                  </tr>
                )}

                {filteredItems.map((item) => {
                  const rowKey = buildRowKey(item);
                  const expanded = expandedKey === rowKey;

                  return (
                    <Fragment key={rowKey}>
                      <tr
                        className="border-b border-black/10 align-top hover:bg-black/[0.025] dark:border-white/10 dark:hover:bg-white/[0.025]"
                      >
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedKey((current) => (current === rowKey ? null : rowKey))}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                            aria-label={expanded ? "Collapse row" : "Expand row"}
                          >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>

                        <td className="px-2 py-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                          {formatTimestamp(item.time)}
                        </td>

                        <td className="px-2 py-2">
                          <div className="truncate font-medium">{item.path}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {item.requestId ?? "-"}
                          </div>
                        </td>

                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            <span className="rounded-full border border-black/10 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                              {item.method}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 font-semibold ${getStatusTone(item.status)}`}>
                              {item.status}
                            </span>
                            {item.jobStatus && (
                              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-700 dark:text-sky-300">
                                {item.jobStatus}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className={`px-2 py-2 font-semibold ${getDurationTone(item.durationMs)}`}>
                          {formatDuration(item.durationMs)}
                        </td>

                        <td className="px-2 py-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                          <div className="truncate">{item.model ?? "-"}</div>
                          <div className="mt-0.5 truncate">
                            {[item.feature, item.routeType, item.cacheHit === true ? "cache" : item.cacheHit === false ? "fresh" : undefined]
                              .filter(Boolean)
                              .join(" / ") || "-"}
                          </div>
                        </td>

                        <td className="px-2 py-2">
                          <code className="block truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                            {toSingleLinePreview(resolvePrimaryPayload(item))}
                          </code>
                        </td>

                        <td className="px-2 py-2">
                          <code className="block truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                            {toSingleLinePreview(resolvePrimaryResponse(item))}
                          </code>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="border-b border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]">
                          <td colSpan={8} className="px-3 py-3">
                            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                              <span>jobId: {item.jobId ?? "-"}</span>
                              <span>book: {item.bookName ?? "-"}</span>
                              <span>pageId: {item.pageId ?? "-"}</span>
                              <span>textLength: {item.textLength ?? "-"}</span>
                              <span>translatedLength: {item.translatedLength ?? "-"}</span>
                              <span>jobLifetime: {item.jobLifetimeMs ? formatDuration(item.jobLifetimeMs) : "-"}</span>
                              <span>errorCode: {item.errorCode ?? "-"}</span>
                            </div>

                            <div className="grid gap-3 xl:grid-cols-2">
                              <div className="min-w-0 rounded-xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-zinc-950/80">
                                <div className="border-b border-black/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                                  Model Payload
                                </div>
                                <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-300">
                                  {toPrettyJson(item.providerPayload)}
                                </pre>
                              </div>

                              <div className="min-w-0 rounded-xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-zinc-950/80">
                                <div className="border-b border-black/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                                  Model Response
                                </div>
                                <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-300">
                                  {toPrettyJson(item.providerResponse)}
                                </pre>
                              </div>

                              <div className="min-w-0 rounded-xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-zinc-950/80">
                                <div className="border-b border-black/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                                  API Payload
                                </div>
                                <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-300">
                                  {toPrettyJson(item.requestBody)}
                                </pre>
                              </div>

                              <div className="min-w-0 rounded-xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-zinc-950/80">
                                <div className="border-b border-black/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                                  API Response
                                </div>
                                <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-5 text-zinc-700 dark:text-zinc-300">
                                  {toPrettyJson(item.responseBody)}
                                </pre>
                              </div>
                            </div>

                            {item.error && (
                              <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                                {item.error}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
