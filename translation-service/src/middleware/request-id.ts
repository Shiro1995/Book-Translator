/**
 * Middleware: request ID / correlation ID.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId =
    (req.headers["x-request-id"] as string) ?? crypto.randomUUID().slice(0, 8);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
