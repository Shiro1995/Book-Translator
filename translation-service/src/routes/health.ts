/**
 * Health and readiness endpoints.
 */

import { Router } from "express";
import { getTranslationStats } from "../services/translation.js";
import { config } from "../config/index.js";

const router = Router();
const startedAt = Date.now();

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "translation-service",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: "1.0.0",
  });
});

router.get("/ready", (_req, res) => {
  const stats = getTranslationStats();
  const ready = Boolean(config.n8nWebhookUrl);

  res.status(ready ? 200 : 503).json({
    ready,
    ...stats,
  });
});

router.get("/metrics", (_req, res) => {
  const stats = getTranslationStats();

  res.json({
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    ...stats,
  });
});

export default router;
