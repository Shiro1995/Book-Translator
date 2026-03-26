import { type Book } from "../types";
import { normalizeUserFacingText } from "../utils/text";

interface ExportPageSelection {
  startPage: number;
  endPage: number;
}

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

function buildFallbackFileName(
  bookName: string,
  startPage: number,
  endPage: number,
  totalPages: number,
) {
  const normalizedName = normalizeUserFacingText(bookName).trim() || "book";
  const normalizedRange =
    startPage === 1 && endPage === totalPages ? "" : `_pages-${startPage}-${endPage}`;
  return `${normalizedName}_translated${normalizedRange}.docx`;
}

async function extractErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

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
      data.error ?? "Kh\u00f4ng th\u1ec3 xu\u1ea5t DOCX",
      detailText,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const text = await response.text().catch(() => "");
  return text || "Kh\u00f4ng th\u1ec3 xu\u1ea5t DOCX";
}

export class ExportDocxService {
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
      throw new Error("Ch\u01b0a c\u00f3 trang n\u00e0o \u0111\u00e3 d\u1ecbch \u0111\u1ec3 xu\u1ea5t DOCX.");
    }

    const formData = new FormData();
    formData.append(
      "payload",
      JSON.stringify({
        bookName: normalizeUserFacingText(book.name),
        startPage,
        endPage,
        totalPages: book.totalPages,
        pages,
      }),
    );

    const response = await fetch("/api/export-docx", {
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

export const exportDocxService = new ExportDocxService();
