import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { normalizeUserFacingText } from "../lib/text.js";
import { exportBookPdf } from "../services/pdf-export.js";

const router = Router();
const uploadNone = multer().none() as unknown as RequestHandler;

const exportPdfSchema = z.object({
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

router.post("/", uploadNone, async (req, res) => {
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

  const parsed = exportPdfSchema.safeParse(parsedJson);
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
    const result = await exportBookPdf({
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
    res.type("application/pdf");
    return res.send(result.buffer);
  } catch (error) {
    logger.error("PDF export error", {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return res.status(500).json({
      error:
        error instanceof Error && error.message
          ? error.message
          : "Failed to export PDF",
    });
  }
});

export default router;
