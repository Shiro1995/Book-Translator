/**
 * Translation Service — server bootstrap.
 * Starts the Express server on the configured port.
 */

import { config, validateConfig } from "./config/index.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const app = createApp();

// Validate config and warn about issues
const warnings = validateConfig();
for (const warning of warnings) {
  logger.warn(warning);
}

app.listen(config.port, "0.0.0.0", () => {
  logger.info("Translation service started", {
    port: config.port,
    env: config.nodeEnv,
    webhookConfigured: Boolean(config.n8nWebhookUrl),
    queueConcurrency: config.queueConcurrency,
    cacheMaxSize: config.cacheMaxSize,
    cacheTtlSeconds: config.cacheTtlSeconds,
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received — shutting down");
  process.exit(0);
});
