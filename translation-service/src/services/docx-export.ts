import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { normalizeUserFacingText } from "../lib/text.js";
import { logger } from "../lib/logger.js";
import type {
  ExportDocxPageInput,
  ExportDocxRequest,
  ExportDocxResult,
} from "../types/index.js";

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

function buildParagraphs(
  request: ExportDocxRequest,
  pagesToExport: ExportDocxPageInput[],
) {
  const fullSelection = request.startPage === 1 && request.endPage === request.totalPages;
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "BAN DICH TAI LIEU", bold: true })],
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: normalizeUserFacingText(request.bookName), bold: true })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      text: fullSelection
        ? `Pham vi trang: Tat ca (${request.startPage}-${request.endPage})`
        : `Pham vi trang: ${request.startPage}-${request.endPage}`,
      spacing: { after: 80 },
    }),
    new Paragraph({
      text: `Ngay xuat: ${formatExportDate()}`,
      spacing: { after: 280 },
    }),
  ];

  for (const page of pagesToExport) {
    const translated = normalizeLineBreaks(page.translatedText || "(chua dich)");
    const lines = translated.length > 0 ? translated.split("\n") : ["(chua dich)"];

    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `Trang ${page.id}`, bold: true })],
        spacing: { before: 180, after: 80 },
      }),
    );

    for (const line of lines) {
      paragraphs.push(
        new Paragraph({
          text: line || " ",
          spacing: { after: 80 },
        }),
      );
    }

    paragraphs.push(new Paragraph({ text: "", spacing: { after: 80 } }));
  }

  return paragraphs;
}

function createDocxDocument(
  request: ExportDocxRequest,
  pagesToExport: ExportDocxPageInput[],
) {
  return new Document({
    creator: "Book Translator",
    title: normalizeUserFacingText(request.bookName),
    description: "Translated export",
    sections: [
      {
        properties: {},
        children: buildParagraphs(request, pagesToExport),
      },
    ],
  });
}

export async function exportBookDocx(request: ExportDocxRequest): Promise<ExportDocxResult> {
  const pagesToExport = request.pages.filter(
    (page) => normalizeLineBreaks(page.translatedText ?? "").length > 0,
  );

  if (pagesToExport.length === 0) {
    throw new Error("No translated pages to export");
  }

  const doc = createDocxDocument(request, pagesToExport);
  const buffer = await Packer.toBuffer(doc);

  const baseName = sanitizeFileName(request.bookName);
  const fullSelection = request.startPage === 1 && request.endPage === request.totalPages;
  const fileSuffix = fullSelection ? "" : `_pages-${request.startPage}-${request.endPage}`;
  const fileName = `${baseName}_translated${fileSuffix}.docx`;

  logger.info("DOCX exported", {
    bookName: request.bookName,
    exportedPages: pagesToExport.length,
  });

  return {
    fileName,
    buffer,
    exportedPages: pagesToExport.length,
  };
}
