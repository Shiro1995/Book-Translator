import "dotenv/config";
import { z } from "zod";

const integerWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().positive(),
  );

const nonNegativeIntegerWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().min(0),
  );

const envSchema = z.object({
  PORT: integerWithDefault(3100),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  TRANSLATION_PROVIDER: z.enum(["cliproxy"]).default("cliproxy"),
  CLIPROXY_BASE_URL: z.string().trim().default(""),
  CLIPROXY_API_KEY: z.string().trim().default(""),
  CLIPROXY_TIMEOUT_MS: integerWithDefault(60_000),
  CLIPROXY_MAX_RETRIES: nonNegativeIntegerWithDefault(2),

  QUEUE_CONCURRENCY: integerWithDefault(2),
  CACHE_TTL_SECONDS: integerWithDefault(3600),
  CACHE_MAX_SIZE: integerWithDefault(500),
  RATE_LIMIT_MAX: integerWithDefault(30),
  RATE_LIMIT_WINDOW_MS: integerWithDefault(60_000),
  MAX_UPLOAD_SIZE_MB: integerWithDefault(50),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,

  translationProvider: env.TRANSLATION_PROVIDER,
  cliproxyBaseUrl: env.CLIPROXY_BASE_URL,
  cliproxyApiKey: env.CLIPROXY_API_KEY,
  cliproxyTimeoutMs: env.CLIPROXY_TIMEOUT_MS,
  cliproxyMaxRetries: env.CLIPROXY_MAX_RETRIES,

  queueConcurrency: env.QUEUE_CONCURRENCY,
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  cacheMaxSize: env.CACHE_MAX_SIZE,
  rateLimitMax: env.RATE_LIMIT_MAX,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
  logLevel: env.LOG_LEVEL,
} as const;

function isHttpUrl(value: string) {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized.includes("your_api_key_here") ||
    normalized.includes("replace_me")
  );
}

export function isTranslationProviderConfigured() {
  switch (config.translationProvider) {
    case "cliproxy":
      return (
        isHttpUrl(config.cliproxyBaseUrl) &&
        !isPlaceholderValue(config.cliproxyApiKey)
      );
    default:
      return false;
  }
}

export function validateConfig() {
  const warnings: string[] = [];

  if (config.translationProvider === "cliproxy") {
    if (!config.cliproxyBaseUrl) {
      warnings.push("CLIPROXY_BASE_URL is not set - translation requests will fail");
    } else if (!isHttpUrl(config.cliproxyBaseUrl)) {
      warnings.push("CLIPROXY_BASE_URL is invalid - expected an http(s) base URL");
    }

    if (!config.cliproxyApiKey || isPlaceholderValue(config.cliproxyApiKey)) {
      warnings.push("CLIPROXY_API_KEY is not set - provider authentication will fail");
    }

  }

  return warnings;
}
