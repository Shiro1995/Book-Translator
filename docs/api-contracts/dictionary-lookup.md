# API Contract: Dictionary Lookup

> **Không qua BE.** Feature này chạy 100% client-side.
> File này document cho AI biết flow + data shape.

## Tổng quan

Khi user bôi đen 1 từ/cụm ngắn → tab "Tra cứu" hiện kết quả từ điển.
Data lấy từ: glossary nội bộ + dictionaryapi.dev (Free Dictionary API).

## FE service file

`src/modules/book-translation/selection/services/dictionaryLookupService.ts`

## Entry point

```typescript
export async function lookupDictionarySelection(
  input: {
    text: string;
    glossary: string;
    classifier: SelectionClassification;
  },
  options?: { signal?: AbortSignal },
): Promise<DictionaryLookupResult>
```

## Flow

```
1. Parse glossary entries từ user input
2. Normalize text + detect language + split tokens
3. Nếu classifier.allowDictionary = false → return "unsupported"
4. Nếu Latin script + ≤ 3 tokens:
   a. Gọi dictionaryapi.dev cho full text
   b. Nếu không match → thử từng token
   c. Map API response → DictionaryLookupResult
5. Fallback: glossary exact match
6. Fallback: glossary partial token matches
7. Cuối cùng: return empty/partial
```

## External API

**URL**: `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`

**Method**: GET (no auth needed, public CORS)

**Response shape** (relevant fields):
```json
[{
  "word": "hello",
  "phonetics": [{ "text": "/həˈloʊ/", "audio": "..." }],
  "meanings": [{
    "partOfSpeech": "noun",
    "definitions": [{ "definition": "...", "example": "...", "synonyms": [], "antonyms": [] }],
    "synonyms": ["greeting"],
    "antonyms": []
  }]
}]
```

## DictionaryLookupResult shape

```typescript
interface DictionaryLookupResult {
  status: "success" | "partial" | "empty" | "unsupported";
  source: "glossary" | "internal-dictionary" | "generated-helper" | "none";
  selectedText: string;
  normalizedText: string;
  glossaryMatches: GlossaryEntry[];
  tokenBreakdown: DictionaryTokenBreakdown[];
  primaryMeaning?: string;
  secondaryMeanings: string[];
  pronunciation?: string;       // IPA from dictionaryapi.dev
  partOfSpeech?: string;        // "noun, verb" etc.
  domain?: string;
  examples: string[];           // max 3 from API
  relatedTerms: string[];       // "≈ synonym" / "≠ antonym"
  message?: string;
  suggestion?: string;
}
```

## Cache

- In-memory `Map<string, DictionaryApiEntry[] | null>` (FE level)
- Key: word.toLowerCase().trim()
- No TTL (session lifetime)

## Khi thay đổi

| Thay đổi | Ảnh hưởng |
|----------|-----------|
| Đổi API URL | Chỉ FE — sửa fetch URL trong `dictionaryLookupService.ts` |
| Đổi result shape | Sửa `DictionaryLookupResult` trong `selection/types.ts` + update components |
| Thêm API mới (ví dụ Jisho cho Japanese) | Thêm adapter trong `dictionaryLookupService.ts` |
| **BE không cần biết** | ✅ |
