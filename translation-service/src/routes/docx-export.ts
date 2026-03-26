import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { normalizeUserFacingText } from "../lib/text.js";
import { exportBookDocx } from "../services/docx-export.js";

const router = Router();
const exportPayloadLimitBytes = config.maxUploadSizeMb * 1024 * 1024;
const upload = multer({
  limits: {
    fieldSize: exportPayloadLimitBytes,
    fields: 8,
  },
});
const uploadNone = upload.none() as unknown as RequestHandler;

const exportDocxSchema = z.object({
  bookName: z.string().trim().min(1, "Missing bookName"),
  startPage: z.coerce.number().int().min(1),
  endPage: z.coerce.number().int().min(1),
  totalPages: z.coerce.number().int().min(1),
  pages: z.array(
    z.object({
      id: z.coerce.number().int().min(1),
      translatedText: z.string().default(""),
    }),
  ).min(1, "Missing pages to export"),
});

function parseMultipartForm(req: Request, res: Response) {
  return new Promise<void>((resolve, reject) => {
    uploadNone(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

router.post("/", async (req, res) => {
  try {
    await parseMultipartForm(req, res);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FIELD_VALUE"
          ? `Export payload too large. Max request size is ${config.maxUploadSizeMb}MB.`
          : "Invalid export upload payload";

      return res.status(error.code === "LIMIT_FIELD_VALUE" ? 413 : 400).json({
        error: message,
        code: error.code,
      });
    }

    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid export upload payload",
    });
  }

  const rawPayload =
    typeof req.body.payload === "string"
      ? req.body.payload
      : typeof req.body === "string"
        ? req.body
        : null;

  if (!rawPayload) {
    return res.status(400).json({ error: "Missing export payload" });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawPayload);
  } catch {
    return res.status(400).json({ error: "Invalid export payload JSON" });
  }

  const parsed = exportDocxSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  if (parsed.data.endPage < parsed.data.startPage) {
    return res.status(400).json({ error: "Invalid page range" });
  }
  if (parsed.data.endPage > parsed.data.totalPages) {
    return res.status(400).json({ error: "Invalid page range" });
  }

  try {
    const result = await exportBookDocx({
      bookName: normalizeUserFacingText(parsed.data.bookName),
      startPage: parsed.data.startPage,
      endPage: parsed.data.endPage,
      totalPages: parsed.data.totalPages,
      pages: parsed.data.pages.map((page) => ({
        id: page.id,
        translatedText: normalizeUserFacingText(page.translatedText),
      })),
    });

    res.attachment(result.fileName);
    res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return res.send(result.buffer);
  } catch (error) {
    logger.error("DOCX export error", {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return res.status(500).json({
      error:
        error instanceof Error && error.message
          ? error.message
          : "Failed to export DOCX",
    });
  }
});

export default router;
