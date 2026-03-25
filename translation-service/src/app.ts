/**
 * Express app factory — creates and configures the Express application.
 */

import express from "express";
import healthRoutes from "./routes/health.js";
import translationJobRoutes from "./routes/translation-jobs.js";
import documentJobRoutes from "./routes/document-jobs.js";
import selectionInsightsRoutes from "./routes/selection-insights.js";
import pdfExportRoutes from "./routes/pdf-export.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { errorHandler } from "./middleware/error-handler.js";
import { rateLimiter } from "./middleware/rate-limiter.js";
import { logger } from "./lib/logger.js";

export function createApp() {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────
  app.use(express.json({ limit: "5mb" }));
  app.use(requestIdMiddleware);

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("request", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  // Rate limiting on mutation endpoints
  app.use("/translation-jobs", rateLimiter);
  app.use("/document-jobs", rateLimiter);
  app.use("/api/translate", rateLimiter);
  app.use("/api/parse-docx", rateLimiter);
  app.use("/api/selection-insights", rateLimiter);
  app.use("/api/export-pdf", rateLimiter);

  // ── Internal routes (job-based async API) ─────────────────────────
  app.use("/", healthRoutes);
  app.use("/translation-jobs", translationJobRoutes);
  app.use("/document-jobs", documentJobRoutes);
  app.use("/pdf-export", pdfExportRoutes);

  // ── FE-compatible /api/* routes ───────────────────────────────────
  // These match the paths the frontend currently calls,
  // so no FE changes are needed when Nginx routes /api/* here.

  // GET /api/health — lightweight health check for FE
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "translation-service" });
  });

  // POST /api/translate — sync compat endpoint (same as /translation-jobs/sync)
  app.post("/api/translate", (req, res, next) => {
    req.url = "/sync";
    translationJobRoutes(req, res, next);
  });

  // POST /api/parse-docx — sync compat endpoint (same as /document-jobs/parse-sync)
  app.post("/api/parse-docx", (req, res, next) => {
    req.url = "/parse-sync";
    documentJobRoutes(req, res, next);
  });

  // POST /api/selection-insights — selection AI analysis
  app.use("/api/selection-insights", selectionInsightsRoutes);
  app.use("/api/export-pdf", pdfExportRoutes);

  // ── Error handling ────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

