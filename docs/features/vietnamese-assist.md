# Feature: Vietnamese Assist

> Block giải thích tiếng Việt xuất hiện dưới Dictionary tab cho từ/cụm ngắn.

## Mô tả

Sau khi dictionary lookup hoàn tất, nếu selection là word/phrase ngắn → tự động load block "Giải thích tiếng Việt" bên dưới.

## Provider chain (chạy client-side)

```
1. English Dictionary (dictionaryapi.dev)
   → Lấy pronunciation, definitions, examples cho từ tiếng Anh
   → Kết quả lưu vào englishAssist field

2. Internal Provider (glossary match)
   → Nếu glossary có match → tạo explanation tiếng Việt
   → "Theo glossary nội bộ, X được hiểu là Y"

3. Botudien Provider (optional — VITE_BOTUDIEN_API_URL)
   → External Vietnamese dictionary API
   → Nếu env var không set → skip

4. AI Micro Fallback (qua POST /api/selection-insights)
   → Build short prompt: "giải thích ngắn gọn bằng tiếng Việt, tối đa 2 câu"
   → Dùng selectionAiService.ts → gọi BE
   → Extract explanation từ response
```

## Điều kiện load

`shouldLoadVietnameseAssistBlock(selection)` → `true` khi:

```
- classifier.mode !== "ai"
- classifier.allowDictionary === true
- Không có lineBreak, không looks like sentence/multi-sentence
- tokenCount: 1-5
- charCount: ≤ 48
- lookupType: "word" hoặc "phrase"
```

## FE service file

`src/modules/book-translation/selection/services/vietnameseAssistService.ts` (408 lines)

## Types

```typescript
interface VietnameseAssistResult {
  status: "success" | "empty" | "unsupported";
  source: "internal-provider" | "botudien" | "ai-micro" | "none";
  title: string;              // luôn "Giải thích tiếng Việt"
  explanation?: string;       // nội dung giải thích
  note?: string;              // ghi chú thêm
  englishAssist?: EnglishDictionaryAssist;  // data từ dictionaryapi.dev
}

interface EnglishDictionaryAssist {
  word: string;
  pronunciation?: string;     // IPA
  partOfSpeech?: string;
  definitions: string[];      // max 3
  example?: string;
  source: "dictionaryapi.dev";
}

interface VietnameseAssistRequest {
  selection: SelectionSnapshot;
  dictionaryResult: DictionaryLookupResult | null;
  bookName: string;
  glossary: string;
  instructions: string;
  model: string;
  targetLanguage: string;
}
```

## Cache

- `vietnameseAssistCache`: `Map<string, VietnameseAssistResult>` (session lifetime)
- `englishDictionaryCache`: `Map<string, EnglishDictionaryAssist | null>` (session lifetime)
- Cache key: `bookId::pageId::normalizedText::contextHash::glossaryHash::primaryMeaning`

## Lifecycle trong OriginalTextSelectionPane

```
1. Dictionary tab active + dictionaryState.status === "success"
2. shouldLoadVietnameseAssistBlock(selection) → true/false
3. Nếu true → requestVietnameseAssistBlock(request, { signal })
4. Nếu false → set UNSUPPORTED result
5. Result hiển thị dưới dictionary content
```

## BE involvement

- **Direct**: KHÔNG — Vietnamese Assist chạy client-side
- **Indirect**: AI micro fallback gọi `POST /api/selection-insights` (cùng endpoint với tab AI)
- Nếu BE down → AI fallback fail → vẫn hiển thị glossary/botudien result

## Khi thay đổi

| Thay đổi | Ảnh hưởng |
|----------|-----------|
| Thêm provider mới (ví dụ Wiktionary) | Chỉ FE — thêm vào `vietnameseAssistProviders` array |
| Đổi VietnameseAssistResult shape | Chỉ FE — types.ts + SelectionInspector |
| Thêm AI model cho fallback | FE dùng `selectionAiService.ts` → model list ở đó |
| Đổi shouldLoad conditions | Chỉ FE — `vietnameseAssistService.ts` |
| **BE không cần biết** | ✅ (trừ khi đổi `/api/selection-insights` response) |
