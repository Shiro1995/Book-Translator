/**
 * Translation job routes — async job-based API.
 *
 * POST /translation-jobs         → submit job
 * GET  /translation-jobs/:jobId  → poll status
 * GET  /translation-jobs/:jobId/result → get result
 * POST /translation-jobs/:jobId/cancel → cancel queued job
 *
 * Also provides a synchronous compat endpoint for the existing web server:
 * POST /translate-sync → same interface as the old /api/translate
 */

import { Router } from "express";
import { z } from "zod";
import {
  submitTranslationJob,
  getTranslationJob,
  cancelTranslationJob,
} from "../services/translation.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Validation ──────────────────────────────────────────────────────

const translationSettingsSchema = z.object({
  model: z.string().trim().min(1).default("gemini-3-flash-preview"),
  targetLang: z.string().trim().min(1).default("Vietnamese"),
  style: z.enum(["natural", "literal", "literary", "academic"]).default("natural"),
  glossary: z.string().default(""),
  instructions: z.string().default(""),
});

const translationJobSchema = z.object({
  text: z.string().trim().min(1, "Missing text to translate"),
  settings: translationSettingsSchema.optional(),
  pageId: z.number().optional(),
  bookName: z.string().optional(),
});

// ── Submit Job ──────────────────────────────────────────────────────

router.post("/", (req, res) => {
  const parsed = translationJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { text, settings, pageId, bookName } = parsed.data;
  const fullSettings = {
    model: settings?.model ?? "gemini-3-flash-preview",
    targetLang: settings?.targetLang ?? "Vietnamese",
    style: settings?.style ?? ("natural" as const),
    glossary: settings?.glossary ?? "",
    instructions: settings?.instructions ?? "",
  };

  const job = submitTranslationJob({
    text,
    settings: fullSettings,
    pageId,
    bookName,
  });

  logger.info("Translation job submitted", {
    requestId: req.requestId,
    jobId: job.jobId,
    status: job.status,
  });

  res.status(202).json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress ?? 0,
  });
});

// ── Poll Status ─────────────────────────────────────────────────────

router.get("/:jobId", (req, res) => {
  const job = getTranslationJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress ?? 0,
    error: job.status === "failed" ? job.error : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

// ── Get Result ──────────────────────────────────────────────────────

router.get("/:jobId/result", (req, res) => {
  const job = getTranslationJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "completed") {
    return res.status(409).json({
      error: "Job not completed yet",
      status: job.status,
      progress: job.progress ?? 0,
    });
  }

  res.json(job.result);
});

// ── Cancel ──────────────────────────────────────────────────────────

router.post("/:jobId/cancel", (req, res) => {
  const canceled = cancelTranslationJob(req.params.jobId);
  if (!canceled) {
    return res.status(409).json({
      error: "Cannot cancel job — only queued jobs can be canceled",
    });
  }

  res.json({ jobId: req.params.jobId, status: "canceled" });
});

// ── Sync Compat Endpoint ────────────────────────────────────────────
// This endpoint provides backward compatibility with the existing
// /api/translate interface. It submits a job and polls until completion.

router.post("/sync", async (req, res) => {
  const parsed = translationJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { text, settings, pageId, bookName } = parsed.data;
  const fullSettings = {
    model: settings?.model ?? "gemini-3-flash-preview",
    targetLang: settings?.targetLang ?? "Vietnamese",
    style: settings?.style ?? ("natural" as const),
    glossary: settings?.glossary ?? "",
    instructions: settings?.instructions ?? "",
  };

  const job = submitTranslationJob({
    text,
    settings: fullSettings,
    pageId,
    bookName,
  });

  // If cache hit, return immediately
  if (job.status === "completed" && job.result) {
    return res.json({ translatedText: job.result.translatedText });
  }

  // Poll until completion (max ~120s)
  const maxWaitMs = 120_000;
  const pollIntervalMs = 500;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const current = getTranslationJob(job.jobId);
    if (!current) {
      return res.status(500).json({ error: "Job disappeared" });
    }

    if (current.status === "completed" && current.result) {
      return res.json({ translatedText: current.result.translatedText });
    }

    if (current.status === "failed") {
      return res.status(502).json({
        error: current.error ?? "Translation failed",
      });
    }

    if (current.status === "canceled") {
      return res.status(409).json({ error: "Job was canceled" });
    }
  }

  return res.status(504).json({ error: "Translation timed out" });
});

export default router;
