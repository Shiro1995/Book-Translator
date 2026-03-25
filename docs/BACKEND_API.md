# Backend API Reference — FE Repo

> **Dành cho AI/dev làm việc trên FE repo (Book-Translator).**
> BE nằm ở repo riêng (`translation-service/`).
> Đọc file này để biết FE gọi BE ở đâu, response shape là gì.
> File đầy đủ nằm tại BE repo: `API_CONTRACT.md`

---

## FE gọi BE ở 4 endpoint duy nhất

| # | Endpoint | FE Service | Mục đích |
|---|----------|-----------|----------|
| 1 | `POST /api/translate` | `services/translationService.ts` | Dịch text |
| 2 | `POST /api/parse-docx` | `services/fileService.ts` | Parse DOCX → pages |
| 3 | `POST /api/selection-insights` | `selection/services/selectionAiService.ts` | AI phân tích vùng chọn |
| 4 | `POST /api/export-pdf` | `services/exportPdfService.ts` | Xuất PDF từ backend |

---

## FE nối sang BE thế nào

- FE code vẫn gọi relative path như `/api/translate`
- root web server proxy `/api/*` sang backend project riêng qua biến env `BACKEND_API_URL`
- không cần FE gọi thẳng absolute URL nếu root proxy đang bật

---

## FE features KHÔNG qua BE

| Feature | Service FE | Data source |
|---------|-----------|-------------|
| Dictionary lookup | `dictionaryLookupService.ts` | `dictionaryapi.dev` (public API) + glossary nội bộ |
| Vietnamese Assist | `vietnameseAssistService.ts` | `dictionaryapi.dev` + `VITE_BOTUDIEN_API_URL` + AI fallback* |
| Glossary lookup | `glossaryLookupService.ts` | Parse user glossary text (pure logic) |
| Selection classifier | `selectionClassifier.ts` | Token count → mode (pure logic) |
| Analytics | `selectionAnalytics.ts` | CustomEvent + console.debug |

> *Vietnamese Assist dùng `/api/selection-insights` làm AI fallback cuối cùng, nhưng logic chọn provider chạy ở FE.

---

## Response types FE phải match

### `/api/translate` → `{ translatedText: string }`

### `/api/parse-docx`:
```typescript
{
  name: string;
  size: number;
  pages: Array<{ id: number; originalText: string; translatedText: ""; status: "idle" }>;
}
```

### `/api/selection-insights` → `SelectionAiResult`:
```typescript
{
  translationNatural: string;       // REQUIRED
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

> Type FE: `SelectionAiResult` trong `selection/types.ts`
> Type BE: `SelectionInsightResponse` trong `selection-insights.ts`

---

## Model handling

- FE translation: fallback chain `gemini-3-flash-preview` → `gemini-2.5-pro` → `gemini-2.5-flash`
- FE selection AI: `["gemini-2.5-flash", "gemini-3-flash-preview"]`
- **BE forward `model` nguyên vẹn** — không override

---

## Khi cần thay đổi API

1. Đọc `API_CONTRACT.md` ở BE repo (hoặc bản copy này)
2. Cập nhật FE types trong `selection/types.ts` hoặc service files
3. Nếu cần endpoint mới → ghi yêu cầu → BE implement + cập nhật contract
4. **KHÔNG BAO GIỜ** đổi response shape phía FE mà không thông báo BE
