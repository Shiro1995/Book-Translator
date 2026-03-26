# API Contract - Book-Translator

This file documents the FE <-> BE contract. Internal provider swaps are allowed as long as these endpoint shapes stay stable.

## Overview

- Root web server serves the SPA.
- `translation-service` handles `/api/*`.
- Translation and selection insights now call Cliproxy through an OpenAI-compatible Chat Completions API.

## `POST /api/translate`

Request:

```ts
{
  text: string;
  settings: {
    model: string;
    targetLang?: string;
    style?: "natural" | "literal" | "literary" | "academic";
    glossary?: string;
    instructions?: string;
  };
  pageId?: number;
  bookName?: string;
}
```

Success:

```ts
{ translatedText: string }
```

Errors:

```ts
{ error: string; code?: string }
```

Notes:

- FE sends `model` as-is and BE forwards that exact value upstream.
- `settings.model` is required for translation requests.

## `POST /api/parse-docx`

Request: `multipart/form-data` with field `file`

Success:

```ts
{
  name: string;
  size: number;
  pages: Array<{
    id: number;
    originalText: string;
    translatedText: string;
    status: "idle";
  }>;
}
```

## `POST /api/selection-insights`

Request:

```ts
{
  selectedText: string;
  bookId?: string;
  bookName?: string;
  pageId?: number;
  normalizedText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  model?: string;
  glossary?: string;
  instructions?: string;
  beforeText?: string;
  afterText?: string;
  paragraphText?: string;
  pageText?: string;
  existingTranslation?: string;
  documentMetadata?: {
    title?: string;
    genre?: string;
    domain?: string;
  };
  contextHash?: string;
}
```

Success:

```ts
{
  translationNatural: string;
  translationLiteral?: string;
  explanation?: string;
  alternatives: Array<{ text: string; note?: string }>;
  glossaryApplied: Array<{
    sourceTerm: string;
    targetTerm: string;
    status: "applied" | "suggested" | "conflict";
    note?: string;
  }>;
  warnings: string[];
  segmentation: Array<{ source: string; explanation?: string }>;
  confidence?: number;
  source: "api" | "fallback";
}
```

Errors:

```ts
{ code: string; error: string; details?: string }
```

## `POST /api/export-pdf`

Request: `multipart/form-data` with field `payload` containing JSON

```ts
{
  bookName: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  pages: Array<{
    id: number;
    translatedText: string;
  }>;
}
```

Success:

- Response body: PDF binary
- Response headers include:

```ts
{
  "Content-Type": "application/pdf",
  "Content-Disposition": "attachment; filename=..."
}
```

## `POST /api/export-docx`

Request: `multipart/form-data` with field `payload` containing JSON

```ts
{
  bookName: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  pages: Array<{
    id: number;
    translatedText: string;
  }>;
}
```

Success:

- Response body: DOCX binary
- Response headers include:

```ts
{
  "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "Content-Disposition": "attachment; filename=..."
}
```

## Required Translation-Service Env

```env
TRANSLATION_PROVIDER=cliproxy
CLIPROXY_BASE_URL=http://69.87.219.202:8317
CLIPROXY_API_KEY=your_api_key_here
CLIPROXY_TIMEOUT_MS=60000
CLIPROXY_MAX_RETRIES=2
```
