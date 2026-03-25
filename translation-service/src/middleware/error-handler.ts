/**
 * Global error handler middleware.
 * Hides sensitive error details in production.
 */

import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error("Unhandled error", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: config.nodeEnv !== "production" ? err.stack : undefined,
  });

  res.status(500).json({
    error: config.nodeEnv === "production"
      ? "Internal server error"
      : err.message,
    requestId: req.requestId,
  });
}
