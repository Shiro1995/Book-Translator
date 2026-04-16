import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { Response } from "express";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";

export interface RequestHistoryEntry {
  time: string;
  requestId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}

export type RequestHistoryMeta = Record<string, unknown>;

export interface RequestHistoryFilters {
  requestId?: string;
  path?: string;
  method?: string;
  status?: number;
  feature?: string;
  jobStatus?: string;
}

const requestHistoryDirectoryPath = fileURLToPath(new URL("../../data/", import.meta.url));
const requestHistoryFilePath = fileURLToPath(
  new URL("../../data/request-history.jsonl", import.meta.url),
);

let writeQueue = Promise.resolve();
let writesSinceTrim = 0;

const REQUEST_HISTORY_TRIM_INTERVAL_WRITES = 100;
const REQUEST_HISTORY_MAX_DEPTH = 5;
const REQUEST_HISTORY_MAX_KEYS = 40;
const REQUEST_HISTORY_MAX_ARRAY_ITEMS = 20;
const REQUEST_HISTORY_MAX_STRING_LENGTH = 4_000;

declare global {
  namespace Express {
    interface Locals {
      requestHistoryMeta?: RequestHistoryMeta;
    }
  }
}

async function ensureRequestHistoryDirectory() {
  await mkdir(requestHistoryDirectoryPath, { recursive: true });
}

export function getRequestHistoryFilePath() {
  return requestHistoryFilePath;
}

export function getRequestHistoryMaxEntries() {
  return config.requestHistoryMaxEntries;
}

export function mergeRequestHistoryMeta(res: Response, meta: RequestHistoryMeta) {
  const normalizedMeta = Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [key, snapshotRequestHistoryValue(value)]),
  );

  res.locals.requestHistoryMeta = {
    ...(res.locals.requestHistoryMeta ?? {}),
    ...normalizedMeta,
  };
}

function truncateRequestHistoryString(value: string) {
  if (value.length <= REQUEST_HISTORY_MAX_STRING_LENGTH) {
    return value;
  }

  const extraChars = value.length - REQUEST_HISTORY_MAX_STRING_LENGTH;
  return `${value.slice(0, REQUEST_HISTORY_MAX_STRING_LENGTH)}\n...[truncated ${extraChars} chars]`;
}

export function snapshotRequestHistoryValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncateRequestHistoryString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.byteLength} bytes]`;
  }

  if (depth >= REQUEST_HISTORY_MAX_DEPTH) {
    return "[Depth limit reached]";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, REQUEST_HISTORY_MAX_ARRAY_ITEMS)
      .map((item) => snapshotRequestHistoryValue(item, depth + 1));

    if (value.length > REQUEST_HISTORY_MAX_ARRAY_ITEMS) {
      items.push(`[... ${value.length - REQUEST_HISTORY_MAX_ARRAY_ITEMS} more items]`);
    }

    return items;
  }

  if (typeof value === "object") {
    const objectEntries = Object.entries(value as Record<string, unknown>);
    const snapshot: Record<string, unknown> = {};

    for (const [key, entryValue] of objectEntries.slice(0, REQUEST_HISTORY_MAX_KEYS)) {
      snapshot[key] = snapshotRequestHistoryValue(entryValue, depth + 1);
    }

    if (objectEntries.length > REQUEST_HISTORY_MAX_KEYS) {
      snapshot.__truncatedKeys = objectEntries.length - REQUEST_HISTORY_MAX_KEYS;
    }

    return snapshot;
  }

  return String(value);
}

export function appendRequestHistory(entry: RequestHistoryEntry) {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await ensureRequestHistoryDirectory();
      await appendFile(requestHistoryFilePath, `${JSON.stringify(entry)}\n`, "utf8");
      writesSinceTrim += 1;

      if (writesSinceTrim >= REQUEST_HISTORY_TRIM_INTERVAL_WRITES) {
        writesSinceTrim = 0;
        await trimRequestHistoryIfNeeded();
      }
    });

  return writeQueue;
}

function matchesRequestHistoryFilters(
  entry: RequestHistoryEntry,
  filters: RequestHistoryFilters,
) {
  if (filters.requestId && entry.requestId !== filters.requestId) {
    return false;
  }

  if (filters.path && typeof entry.path === "string" && !entry.path.includes(filters.path)) {
    return false;
  }

  if (filters.method && entry.method.toUpperCase() !== filters.method.toUpperCase()) {
    return false;
  }

  if (filters.status && entry.status !== filters.status) {
    return false;
  }

  if (filters.feature && entry.feature !== filters.feature) {
    return false;
  }

  if (filters.jobStatus && entry.jobStatus !== filters.jobStatus) {
    return false;
  }

  return true;
}

async function trimRequestHistoryIfNeeded() {
  try {
    const content = await readFile(requestHistoryFilePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    if (lines.length <= config.requestHistoryMaxEntries) {
      return;
    }

    const retainedLines = lines.slice(-config.requestHistoryMaxEntries);
    await writeFile(requestHistoryFilePath, `${retainedLines.join("\n")}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export async function readRecentRequestHistory(
  limit = 100,
  filters: RequestHistoryFilters = {},
) {
  try {
    const content = await readFile(requestHistoryFilePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const entries: RequestHistoryEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RequestHistoryEntry;

        if (matchesRequestHistoryFilters(entry, filters)) {
          entries.push(entry);
        }
      } catch {
        // Skip malformed lines so one bad write does not block the whole history view.
      }
    }

    return entries.slice(-Math.max(0, limit)).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
