import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function isTextItem(
  item: TextItem | TextMarkedContent,
): item is TextItem {
  return 'str' in item;
}

export async function parsePDF(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter(isTextItem)
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({
      id: i,
      originalText: text,
      translatedText: "",
      status: 'idle' as const
    });
  }

  return {
    name: file.name,
    size: file.size,
    totalPages: numPages,
    pages
  };
}

export async function parseDOCX(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/parse-docx', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) throw new Error("Failed to parse DOCX");
  return await response.json();
}
