import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config/index.js";

const REQUEST_HISTORY_ADMIN_HEADER = "x-request-history-admin-code";

function normalizeAdminCode(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue?.trim() ?? "";
}

function secureCodeEquals(input: string, expected: string) {
  const inputBuffer = Buffer.from(input, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

export function requestHistoryAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const providedCode = normalizeAdminCode(req.header(REQUEST_HISTORY_ADMIN_HEADER));
  const expectedCode = config.requestHistoryAdminCode;

  if (!providedCode || !secureCodeEquals(providedCode, expectedCode)) {
    return res.status(401).json({ error: "Unauthorized request history access" });
  }

  next();
}

export { REQUEST_HISTORY_ADMIN_HEADER };
