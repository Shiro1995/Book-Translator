/**
 * Document parse job routes — async job-based API for DOCX parsing.
 *
 * POST /document-jobs/parse     → submit parse job (multipart upload)
 * GET  /document-jobs/:jobId    → poll status
 * GET  /document-jobs/:jobId/result → get parsed pages
 *
 * Also provides a sync compat endpoint:
 * POST /document-jobs/parse-sync → same interface as old /api/parse-docx
 */

import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import fs from "fs";
import { config } from "../config/index.js";
import { InMemoryQueue } from "../queues/in-memory-queue.js";
import { parseDocxFile } from "../services/document-parse.js";
import { logger } from "../lib/logger.js";
import type { DocumentParseResult } from "../types/index.js";

const router = Router();

// ── Upload Config ───────────────────────────────────────────────────

const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  dest: `${UPLOAD_DIR}/`,
  limits: { fileSize: config.maxUploadSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    // Accept by MIME or extension fallback
    const ext = file.originalname.toLowerCase();
    if (allowed.includes(file.mimetype) || ext.endsWith(".docx") || ext.endsWith(".doc")) {
      cb(null, true);
    } else {
      cb(new Error("Only DOCX/DOC files are allowed"));
    }
  },
});

const uploadSingle = upload.single("file") as unknown as RequestHandler;

type RequestWithFile = Request & { file?: Express.Multer.File };

// ── Parse Queue ─────────────────────────────────────────────────────

interface ParseJobInput {
  filePath: string;
  originalName: string;
  fileSize: number;
}

const parseQueue = new InMemoryQueue<ParseJobInput, DocumentParseResult>(
  "document-parse",
  1, // Parse one at a time to limit CPU usage
);

parseQueue.process(async (_jobId, input, updateProgress) => {
  updateProgress(10);
  const result = await parseDocxFile(input.filePath, input.originalName, input.fileSize);
  updateProgress(100);
  return result;
});

// ── Submit Parse Job ────────────────────────────────────────────────

router.post("/parse", uploadSingle, (req, res) => {
  const file = (req as RequestWithFile).file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const job = parseQueue.add({
    filePath: file.path,
    originalName: file.originalname,
    fileSize: file.size,
  });

  logger.info("Document parse job submitted", {
    requestId: req.requestId,
    jobId: job.jobId,
    fileName: file.originalname,
  });

  res.status(202).json({
    jobId: job.jobId,
    status: job.status,
  });
});

// ── Poll Status ─────────────────────────────────────────────────────

router.get("/:jobId", (req, res) => {
  const job = parseQueue.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress ?? 0,
    error: job.status === "failed" ? job.error : undefined,
  });
});

// ── Get Result ──────────────────────────────────────────────────────

router.get("/:jobId/result", (req, res) => {
  const job = parseQueue.getJob(req.params.jobId);
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

// ── Sync Compat Endpoint ────────────────────────────────────────────
// Same interface as the old /api/parse-docx — processes and returns result.

router.post("/parse-sync", uploadSingle, async (req, res) => {
  const file = (req as RequestWithFile).file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const result = await parseDocxFile(file.path, file.originalname, file.size);
    return res.json(result);
  } catch (error) {
    logger.error("DOCX parse error", {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return res.status(500).json({ error: "Failed to parse DOCX" });
  }
});

export default router;
