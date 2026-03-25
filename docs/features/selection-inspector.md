# Selection Inspector

`/api/selection-insights` is served by `translation-service`.

## Current backend flow

```text
FE selection tools
  -> /api/selection-insights
  -> translation-service/routes/selection-insights.ts
  -> lib/chat-completions.ts
  -> Cliproxy / OpenAI-compatible /v1/chat/completions
```

## Response behavior

- Preferred path: structured JSON with `translationNatural`, `alternatives`, `glossaryApplied`, `warnings`, `segmentation`, and `confidence`
- Fallback path: if the model does not return valid JSON, backend still returns the legacy fallback shape with `source: "fallback"`

## Stability goal

- FE keeps the same response contract.
- Provider changes stay backend-internal.
