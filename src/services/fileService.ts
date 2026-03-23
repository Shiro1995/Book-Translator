import * as pdfjsLib from 'pdfjs-dist';

// Use the bundled worker from the package
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function parsePDF(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
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
