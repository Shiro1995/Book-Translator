# Translation Jobs API

Frontend calls `POST /api/translate`. The backend still returns:

```ts
{ translatedText: string }
```

Internally the flow is now:

```text
/api/translate
  -> translation-service/routes/translation-jobs.ts
  -> services/translation.ts
  -> CliproxyChatCompletionsProvider
  -> Cliproxy /v1/chat/completions
```

## Request

```ts
{
  text: string;
  settings?: {
    model?: string;
    targetLang?: string;
    style?: "natural" | "literal" | "literary" | "academic";
    glossary?: string;
    instructions?: string;
  };
  pageId?: number;
  bookName?: string;
}
```

## Error shape

```ts
{ error: string; code?: string }
```

## Compatibility note

Legacy FE `gemini-*` model values are mapped to `CLIPROXY_MODEL` so the current UI keeps working without a forced FE rewrite.
