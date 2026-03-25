# Architecture Overview

## Runtime split

- `:3000` root web server -> serves the SPA and can proxy `/api/*` when `USE_TRANSLATION_SERVICE=true`
- `:3100` `translation-service` -> translation jobs, selection insights, document parsing

## Translation flow

```text
FE -> /api/translate
   -> translation-service/routes/translation-jobs.ts
   -> services/translation.ts
   -> providers/cliproxy-chat-completions.ts
   -> lib/chat-completions.ts
   -> Cliproxy / OpenAI-compatible /v1/chat/completions
```

## Selection insights flow

```text
FE -> /api/selection-insights
   -> translation-service/routes/selection-insights.ts
   -> lib/chat-completions.ts
   -> Cliproxy / OpenAI-compatible /v1/chat/completions
```

## Notes

- Queue/cache/jobs remain in `translation-service`.
- Root web server should not contain translation business logic.
- Nginx can still route `/api/*` directly to `translation-service` in production.
