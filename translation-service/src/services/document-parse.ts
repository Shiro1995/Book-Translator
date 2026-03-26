/**
 * Document parsing service — handles DOCX files using mammoth.
 */

import { promises as fsPromises } from "fs";
import mammoth from "mammoth";
import { logger } from "../lib/logger.js";
import type { DocumentParseResult, ParsedPage } from "../types/index.js";

const DEFAULT_PAGE_SIZE = 2000;

function splitTextIntoPages(text: string, pageSize = DEFAULT_PAGE_SIZE) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const pages: string[] = [];

  for (let index = 0; index < normalized.length; index += pageSize) {
    pages.push(normalized.slice(index, index + pageSize));
  }

  return pages.length > 0 ? pages : [""];
}

export async function parseDocxFile(
  filePath: string,
  originalName: string,
  fileSize: number,
): Promise<DocumentParseResult> {
  try {
    const buffer = await fsPromises.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    const pages: ParsedPage[] = splitTextIntoPages(result.value).map(
      (content, index) => ({
        id: index + 1,
        originalText: content,
        translatedText: "",
        status: "idle" as const,
      }),
    );

    logger.info("DOCX parsed", { originalName, pages: pages.length });

    return {
      name: originalName,
      size: fileSize,
      pages,
    };
  } finally {
    // Always clean up uploaded file
    await fsPromises.unlink(filePath).catch(() => undefined);
  }
}
