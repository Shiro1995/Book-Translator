import { type Book } from "../types";
import { normalizeUserFacingText } from "../utils/text";

interface ExportPageSelection {
  startPage: number;
  endPage: number;
}

type CompressionStreamConstructor = new (format: "gzip") => TransformStream;

function parseContentDispositionFilename(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const basicMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return basicMatch?.[1] ?? null;
}

async function buildExportRequestBody(payload: {
  bookName: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  pages: Array<{
    id: number;
    translatedText: string;
  }>;
}) {
  const payloadJson = JSON.stringify(payload);
  const formData = new FormData();
  const CompressionStreamClass = (
    globalThis as typeof globalThis & { CompressionStream?: CompressionStreamConstructor }
  ).CompressionStream;

  if (CompressionStreamClass) {
    try {
      const compressedStream = new Blob([payloadJson], { type: "application/json" })
        .stream()
        .pipeThrough(new CompressionStreamClass("gzip"));
      const compressedBlob = await new Response(compressedStream).blob();

      if (compressedBlob.size > 0 && compressedBlob.size < new Blob([payloadJson]).size) {
        formData.append("payloadGzip", compressedBlob, "payload.json.gz");
        return formData;
      }
    } catch {
      // Fall back to the plain multipart field if the browser cannot gzip the request body.
    }
  }

  formData.append("payload", payloadJson);
  return formData;
}

function buildFallbackFileName(
  bookName: string,
  startPage: number,
  endPage: number,
  totalPages: number,
) {
  const normalizedName = normalizeUserFacingText(bookName).trim() || "book";
  const normalizedRange =
    startPage === 1 && endPage === totalPages ? "" : `_pages-${startPage}-${endPage}`;
  return `${normalizedName}_translated${normalizedRange}.pdf`;
}

async function extractErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (response.status === 413) {
    return "Yêu cầu xuất file quá lớn (413). Nếu đang deploy qua nginx, tăng client_max_body_size hoặc thử xuất ít trang hơn.";
  }

  if (contentType.includes("application/json")) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      details?: unknown;
    };

    const detailText =
      typeof data.details === "string"
        ? data.details
        : data.details
          ? JSON.stringify(data.details)
          : undefined;

    return [
      data.error ?? "Kh\u00f4ng th\u1ec3 xu\u1ea5t PDF",
      detailText,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const text = await response.text().catch(() => "");
  if (/413 Request Entity Too Large/i.test(text)) {
    return "Yêu cầu xuất file quá lớn (413). Reverse proxy đã chặn request trước khi tới backend.";
  }

  return text || "Kh\u00f4ng th\u1ec3 xu\u1ea5t PDF";
}

export class ExportPdfService {
  async exportBook(
    book: Book,
    selection?: ExportPageSelection,
  ) {
    const startPage = selection?.startPage ?? 1;
    const endPage = selection?.endPage ?? book.totalPages;
    const pages = book.pages
      .filter(
        (page, idx) =>
          idx + 1 >= startPage &&
          idx + 1 <= endPage &&
          normalizeUserFacingText(page.translatedText ?? "").trim().length > 0,
      )
      .map((page) => ({
        id: page.id,
        translatedText: page.translatedText,
      }));

    if (pages.length === 0) {
      throw new Error("Ch\u01b0a c\u00f3 trang n\u00e0o \u0111\u00e3 d\u1ecbch \u0111\u1ec3 xu\u1ea5t PDF.");
    }

    const formData = await buildExportRequestBody({
      bookName: normalizeUserFacingText(book.name),
      startPage,
      endPage,
      totalPages: book.totalPages,
      pages,
    });

    const response = await fetch("/api/export-pdf", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const fileName =
      parseContentDispositionFilename(response.headers.get("content-disposition")) ??
      buildFallbackFileName(book.name, startPage, endPage, book.totalPages);

    try {
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    }
  }
}

export const exportPdfService = new ExportPdfService();
