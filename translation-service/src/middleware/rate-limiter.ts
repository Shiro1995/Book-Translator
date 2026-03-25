/**
 * Simple in-memory rate limiter per IP.
 * Suitable for single-process deployment.
 */

import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const clients = new Map<string, RateLimitEntry>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of clients) {
    if (now > entry.resetAt) clients.delete(ip);
  }
}, 5 * 60 * 1000);

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();

  let entry = clients.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.rateLimitWindowMs };
    clients.set(ip, entry);
  }

  entry.count++;

  res.setHeader("X-RateLimit-Limit", config.rateLimitMax);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, config.rateLimitMax - entry.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > config.rateLimitMax) {
    return res.status(429).json({
      error: "Too many requests",
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  }

  next();
}
