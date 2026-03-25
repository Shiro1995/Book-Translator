/**
 * Translation job orchestration service.
 * Manages the lifecycle: cache check → dedupe → enqueue → process → cache result.
 */

import { config } from "../config/index.js";
import { MemoryCache } from "../cache/memory-cache.js";
import { InMemoryQueue } from "../queues/in-memory-queue.js";
import { N8nWebhookProvider } from "../providers/n8n-webhook.js";
import type { TranslationProvider } from "../providers/types.js";
import type {
  JobInfo,
  TranslationJobInput,
  TranslationJobResult,
  TranslateRequest,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

// ── Instances ───────────────────────────────────────────────────────

const translationCache = new MemoryCache<TranslationJobResult>(
  config.cacheMaxSize,
  config.cacheTtlSeconds,
);

const translationQueue = new InMemoryQueue<TranslationJobInput, TranslationJobResult>(
  "translation",
  config.queueConcurrency,
);

let provider: TranslationProvider = new N8nWebhookProvider();

/** Allow swapping the translation provider (useful for testing or future providers) */
export function setTranslationProvider(p: TranslationProvider) {
  provider = p;
  logger.info("Translation provider set", { provider: p.name });
}

// ── Cache Key ───────────────────────────────────────────────────────

function buildCacheKey(input: TranslationJobInput): string {
  return MemoryCache.hashKey({
    text: input.text,
    model: input.settings.model,
    targetLang: input.settings.targetLang,
    style: input.settings.style,
    glossary: input.settings.glossary,
    instructions: input.settings.instructions,
  });
}

// ── Register Queue Processor ────────────────────────────────────────

translationQueue.process(async (_jobId, input, updateProgress) => {
  updateProgress(10);

  const request: TranslateRequest = {
    text: input.text,
    model: input.settings.model,
    targetLang: input.settings.targetLang,
    style: input.settings.style,
    glossary: input.settings.glossary,
    instructions: input.settings.instructions,
    pageId: input.pageId,
    bookName: input.bookName,
  };

  updateProgress(20);

  const result = await provider.translate(request);
  const jobResult: TranslationJobResult = {
    translatedText: result.translatedText,
  };

  updateProgress(90);

  // Cache the result
  const cacheKey = buildCacheKey(input);
  translationCache.set(cacheKey, jobResult);

  updateProgress(100);
  return jobResult;
});

// ── Public API ──────────────────────────────────────────────────────

/**
 * Submit a new translation job.
 * Returns immediately with job info — the job processes asynchronously.
 */
export function submitTranslationJob(input: TranslationJobInput): JobInfo<TranslationJobResult> {
  const cacheKey = buildCacheKey(input);

  // Check cache first
  const cached = translationCache.get(cacheKey);
  if (cached) {
    logger.info("Translation cache hit", { cacheKey });
    return {
      jobId: `cache-${cacheKey}`,
      status: "completed",
      progress: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: cached,
    };
  }

  // Submit to queue with dedupe key
  return translationQueue.add(input, cacheKey);
}

/**
 * Get job status by ID.
 */
export function getTranslationJob(jobId: string): JobInfo<TranslationJobResult> | undefined {
  // Handle cached results
  if (jobId.startsWith("cache-")) {
    const cacheKey = jobId.slice(6);
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return {
        jobId,
        status: "completed",
        progress: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        result: cached,
      };
    }
    return undefined;
  }

  return translationQueue.getJob(jobId);
}

/**
 * Cancel a queued translation job.
 */
export function cancelTranslationJob(jobId: string): boolean {
  return translationQueue.cancel(jobId);
}

/**
 * Get queue and cache stats for monitoring.
 */
export function getTranslationStats() {
  return {
    queue: translationQueue.stats(),
    cache: translationCache.stats(),
    provider: provider.name,
  };
}
