/**
 * Translation job orchestration service.
 * Manages the lifecycle: cache check -> dedupe -> enqueue -> process -> cache result.
 */

import { config } from "../config/index.js";
import { MemoryCache } from "../cache/memory-cache.js";
import { resolveChatCompletionModel } from "../lib/chat-completions.js";
import { InMemoryQueue } from "../queues/in-memory-queue.js";
import { createTranslationProvider } from "../providers/index.js";
import type { TranslationProvider } from "../providers/types.js";
import type {
  JobInfo,
  TranslationJobInput,
  TranslationJobResult,
  TranslateRequest,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

const translationCache = new MemoryCache<TranslationJobResult>(
  config.cacheMaxSize,
  config.cacheTtlSeconds,
);

const translationQueue = new InMemoryQueue<TranslationJobInput, TranslationJobResult>(
  "translation",
  config.queueConcurrency,
);

let provider: TranslationProvider = createTranslationProvider();

export function setTranslationProvider(nextProvider: TranslationProvider) {
  provider = nextProvider;
  logger.info("Translation provider set", { provider: nextProvider.name });
}

function nestedHash(label: string, value: string) {
  return value ? MemoryCache.hashKey({ [label]: value }) : "";
}

export function buildTranslationCacheKey(input: TranslationJobInput): string {
  return MemoryCache.hashKey({
    provider: provider.name,
    text: input.text,
    model: resolveChatCompletionModel(input.settings.model),
    targetLang: input.settings.targetLang,
    style: input.settings.style,
    glossaryHash: nestedHash("glossary", input.settings.glossary),
    instructionsHash: nestedHash("instructions", input.settings.instructions),
  });
}

translationQueue.process(async (jobId, input, updateProgress) => {
  const startedAt = input.debugTiming ? Date.now() : 0;
  if (input.debugTiming) {
    logger.info("Translation job processing started", {
      jobId,
      requestId: input.requestId,
      pageId: input.pageId,
      bookName: input.bookName,
      model: input.settings.model,
      textLength: input.text.length,
    });
  }
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
    requestId: input.requestId,
    jobId,
    debugTiming: input.debugTiming,
  };

  updateProgress(20);

  const result = await provider.translate(request);
  const jobResult: TranslationJobResult = {
    translatedText: result.translatedText,
    providerPayload: result.providerPayload,
    providerResponse: result.providerResponse,
  };

  updateProgress(90);

  const cacheKey = buildTranslationCacheKey(input);
  translationCache.set(cacheKey, jobResult);

  updateProgress(100);
  if (input.debugTiming) {
    logger.info("Translation job processing completed", {
      jobId,
      requestId: input.requestId,
      pageId: input.pageId,
      durationMs: Date.now() - startedAt,
      translatedLength: result.translatedText.length,
    });
  }
  return jobResult;
});

export function submitTranslationJob(input: TranslationJobInput): JobInfo<TranslationJobResult> {
  const cacheKey = buildTranslationCacheKey(input);
  const cached = translationCache.get(cacheKey);

  if (cached) {
    logger.info("Translation cache hit", {
      cacheKey,
      provider: provider.name,
      requestId: input.requestId,
    });

    return {
      jobId: `cache-${cacheKey}`,
      status: "completed",
      progress: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: cached,
    };
  }

  return translationQueue.add(input, cacheKey);
}

export function getTranslationJob(jobId: string): JobInfo<TranslationJobResult> | undefined {
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

export function cancelTranslationJob(jobId: string): boolean {
  return translationQueue.cancel(jobId);
}

export function getTranslationStats() {
  return {
    queue: translationQueue.stats(),
    cache: translationCache.stats(),
    provider: provider.name,
    configuredProvider: config.translationProvider,
  };
}
