import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3100),
  nodeEnv: process.env.NODE_ENV ?? "development",

  // n8n webhook
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
  n8nAuthToken: process.env.N8N_AUTH_TOKEN ?? "",
  webhookTimeoutMs: Number(process.env.N8N_TIMEOUT_MS ?? 120_000),

  // Queue
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY ?? 2),

  // Cache
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 3600),
  cacheMaxSize: Number(process.env.CACHE_MAX_SIZE ?? 500),

  // Rate limiting
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 30),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),

  // Upload
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 50),

  // Logging
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

// Validate critical config at startup
export function validateConfig() {
  const warnings: string[] = [];

  if (!config.n8nWebhookUrl) {
    warnings.push("N8N_WEBHOOK_URL is not set — translation jobs will fail");
  }
  if (!config.n8nAuthToken) {
    warnings.push("N8N_AUTH_TOKEN is not set — webhook auth will fail");
  }

  return warnings;
}
