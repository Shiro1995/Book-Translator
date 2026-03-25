/**
 * Structured logger with levels, timestamps, and request context.
 */

import { config } from "../config/index.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (config.logLevel as LogLevel) ?? "info";

function shouldLog(level: LogLevel) {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg: message,
  };

  if (meta) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog("debug")) console.debug(formatEntry("debug", msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog("info")) console.log(formatEntry("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog("warn")) console.warn(formatEntry("warn", msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog("error")) console.error(formatEntry("error", msg, meta));
  },
};
