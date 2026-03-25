# BE Architecture - translation-service

`translation-service` stays responsible for heavy backend work:

- translation jobs and sync compatibility endpoints
- document parsing jobs
- selection insights AI calls
- queue, cache, readiness, and provider abstraction

## Current Flow

```text
/api/translate
  -> routes/translation-jobs.ts
  -> services/translation.ts
  -> providers/cliproxy-chat-completions.ts
  -> lib/chat-completions.ts
  -> Cliproxy / OpenAI-compatible /v1/chat/completions

/api/selection-insights
  -> routes/selection-insights.ts
  -> lib/chat-completions.ts
  -> Cliproxy / OpenAI-compatible /v1/chat/completions

/api/parse-docx
  -> routes/document-jobs.ts
  -> services/document-parse.ts

/api/export-pdf
  -> routes/pdf-export.ts
  -> services/pdf-export.ts
```

## Internal Structure

```text
translation-service/
  src/
    app.ts
    server.ts
    config/index.ts
    lib/
      chat-completions.ts
      extract.ts
      logger.ts
      provider-errors.ts
      text.ts
      vietnamese.ts
    providers/
      index.ts
      types.ts
      cliproxy-chat-completions.ts
    services/
      translation.ts
      document-parse.ts
    routes/
      health.ts
      translation-jobs.ts
      document-jobs.ts
      selection-insights.ts
    cache/
      memory-cache.ts
    queues/
      in-memory-queue.ts
```

## Design Notes

- Queue and cache stay unchanged; only provider/integration changed.
- The translation provider is selected by `TRANSLATION_PROVIDER`.
- Provider HTTP concerns live in one place: `lib/chat-completions.ts`.
- Response normalization still uses `lib/extract.ts`, `lib/text.ts`, and `lib/vietnamese.ts`.
- Root web server can proxy `/api/*` to this service when `USE_TRANSLATION_SERVICE=true`, or Nginx can route directly here.
