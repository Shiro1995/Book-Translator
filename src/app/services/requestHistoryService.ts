export interface RequestHistoryItem {
  time: string;
  requestId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
  userAgent?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  providerPayload?: unknown;
  providerResponse?: unknown;
  feature?: string;
  routeType?: string;
  pageId?: number;
  bookName?: string;
  model?: string;
  textLength?: number;
  jobId?: string;
  jobStatus?: string;
  jobInitialStatus?: string;
  jobLifetimeMs?: number;
  translatedLength?: number;
  cacheHit?: boolean;
  debugTiming?: boolean;
  errorCode?: string;
  error?: string;
}

export interface RequestHistoryResponse {
  filePath: string;
  maxEntries: number;
  count: number;
  items: RequestHistoryItem[];
}

export interface RequestHistoryQuery {
  limit?: number;
  requestId?: string;
  path?: string;
  method?: string;
  status?: number;
  feature?: string;
  jobStatus?: string;
}

export class RequestHistoryApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestHistoryApiError";
    this.status = status;
  }
}

const REQUEST_HISTORY_ADMIN_CODE_STORAGE_KEY = "bt_request_history_admin_code";
const REQUEST_HISTORY_ADMIN_HEADER = "x-request-history-admin-code";

export function getStoredRequestHistoryAdminCode() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(REQUEST_HISTORY_ADMIN_CODE_STORAGE_KEY)?.trim() ?? "";
}

export function setStoredRequestHistoryAdminCode(code: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(REQUEST_HISTORY_ADMIN_CODE_STORAGE_KEY, code.trim());
}

export function clearStoredRequestHistoryAdminCode() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(REQUEST_HISTORY_ADMIN_CODE_STORAGE_KEY);
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") {
    return;
  }

  params.set(key, String(value));
}

export async function getRequestHistory(
  query: RequestHistoryQuery = {},
  signal?: AbortSignal,
  adminCodeOverride?: string,
): Promise<RequestHistoryResponse> {
  const params = new URLSearchParams();

  appendQueryParam(params, "limit", query.limit ?? 100);
  appendQueryParam(params, "requestId", query.requestId);
  appendQueryParam(params, "path", query.path);
  appendQueryParam(params, "method", query.method);
  appendQueryParam(params, "status", query.status);
  appendQueryParam(params, "feature", query.feature);
  appendQueryParam(params, "jobStatus", query.jobStatus);

  const adminCode = adminCodeOverride?.trim() || getStoredRequestHistoryAdminCode();
  const headers = new Headers();
  if (adminCode) {
    headers.set(REQUEST_HISTORY_ADMIN_HEADER, adminCode);
  }

  const response = await fetch(`/api/request-history?${params.toString()}`, {
    signal,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as Partial<RequestHistoryResponse> & {
    error?: string;
  };

  if (!response.ok) {
    throw new RequestHistoryApiError(data.error ?? "Failed to load request history", response.status);
  }

  return {
    filePath: data.filePath ?? "",
    maxEntries: data.maxEntries ?? 0,
    count: data.count ?? 0,
    items: data.items ?? [],
  };
}
