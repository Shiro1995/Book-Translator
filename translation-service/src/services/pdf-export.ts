import { fileURLToPath } from "url";
import path from "path";
import PDFDocument from "pdfkit";
import { normalizeUserFacingText } from "../lib/text.js";
import { logger } from "../lib/logger.js";
import type {
  ExportPdfPageInput,
  ExportPdfRequest,
  ExportPdfResult,
} from "../types/index.js";

const FONT_REGULAR_FILE = "NotoSans-Regular.ttf";
const FONT_BOLD_FILE = "NotoSans-Bold.ttf";
const FONT_REGULAR_NAME = "NotoSans";
const FONT_BOLD_NAME = "NotoSans-Bold";

const MARGIN_TOP = 50;
const MARGIN_RIGHT = 68;
const MARGIN_BOTTOM = 50;
const MARGIN_LEFT = 68;
const BODY_FONT_SIZE = 12.5;
const TITLE_FONT_SIZE = 22;
const BLOCK_SPACING_LINES = 0.9;
const TITLE_SPACING_LINES = 0.5;
const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

function resolveFontPath(fileName: string) {
  return path.resolve(FONT_DIR, fileName);
}

function sanitizeFileName(value: string) {
  const normalized = normalizeUserFacingText(value).trim();
  const asciiSafe = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D");
  const withoutReserved = asciiSafe.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  const collapsed = withoutReserved.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : "book";
}

function normalizeLineBreaks(value: string) {
  return normalizeUserFacingText(value).replace(/\r\n/g, "\n").trim();
}

function formatExportDate() {
  return new Intl.DateTimeFormat("vi-VN").format(new Date());
}

function buildExportBlocks(
  request: ExportPdfRequest,
  pagesToExport: ExportPdfPageInput[],
) {
  const fullSelection = request.startPage === 1 && request.endPage === request.totalPages;
  const blocks: Array<{
    kind: "title" | "body";
    text: string;
  }> = [
      { kind: "title", text: "BẢN DỊCH TÀI LIỆU" },
      { kind: "body", text: normalizeUserFacingText(request.bookName) },
      {
        kind: "body",
        text: fullSelection
          ? `Phạm vi trang: Tất cả (${request.startPage}-${request.endPage})`
          : `Phạm vi trang: ${request.startPage}-${request.endPage}`,
      },
      {
        kind: "body",
        text: `Ngày xuất: ${formatExportDate()}`,
      },
    ];

  for (const page of pagesToExport) {
    const translated = normalizeLineBreaks(page.translatedText || "(chưa dịch)");

    blocks.push({
      kind: "body",
      text: translated,
    });
    blocks.push({ kind: "body", text: "" });
  }

  return blocks;
}

function createPdfDocument(request: ExportPdfRequest) {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: MARGIN_TOP,
      right: MARGIN_RIGHT,
      bottom: MARGIN_BOTTOM,
      left: MARGIN_LEFT,
    },
    compress: true,
    info: {
      Title: normalizeUserFacingText(request.bookName),
      Subject: "Translated export",
      Author: "Book Translator",
      CreationDate: new Date(),
    },
  });

  doc.registerFont(FONT_REGULAR_NAME, resolveFontPath(FONT_REGULAR_FILE));
  doc.registerFont(FONT_BOLD_NAME, resolveFontPath(FONT_BOLD_FILE));

  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;
  return doc;
}

function writeContent(
  doc: PDFKit.PDFDocument,
  request: ExportPdfRequest,
  pagesToExport: ExportPdfPageInput[],
) {
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const blocks = buildExportBlocks(request, pagesToExport);

  for (const block of blocks) {
    if (block.kind === "title") {
      doc
        .font(FONT_BOLD_NAME)
        .fontSize(TITLE_FONT_SIZE)
        .text(block.text, {
          width: contentWidth,
          align: "left",
          lineGap: 4,
        });
      doc.moveDown(TITLE_SPACING_LINES);
      continue;
    }

    doc
      .font(FONT_REGULAR_NAME)
      .fontSize(BODY_FONT_SIZE)
      .text(block.text, {
        width: contentWidth,
        align: "left",
        lineGap: 4,
      });
    doc.moveDown(BLOCK_SPACING_LINES);
  }
}

function finalizePdf(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);

    doc.end();
  });
}

export async function exportBookPdf(request: ExportPdfRequest): Promise<ExportPdfResult> {
  const startTime = Date.now();
  const pagesToExport = request.pages.filter(
    (page) => normalizeLineBreaks(page.translatedText ?? "").length > 0,
  );

  if (pagesToExport.length === 0) {
    throw new Error("No translated pages to export");
  }

  const doc = createPdfDocument(request);
  writeContent(doc, request, pagesToExport);
  const buffer = await finalizePdf(doc);

  const baseName = sanitizeFileName(request.bookName);
  const fullSelection = request.startPage === 1 && request.endPage === request.totalPages;
  const fileSuffix = fullSelection ? "" : `_pages-${request.startPage}-${request.endPage}`;
  const fileName = `${baseName}_translated${fileSuffix}.pdf`;

  logger.info("PDF exported", {
    bookName: request.bookName,
    exportedPages: pagesToExport.length,
    durationMs: Date.now() - startTime,
  });

  return {
    fileName,
    buffer,
    exportedPages: pagesToExport.length,
  };
}
