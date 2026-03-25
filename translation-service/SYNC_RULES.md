# FE <-> BE Sync Rules

## Stable Rules

1. Do not break `/api/translate`, `/api/parse-docx`, or `/api/selection-insights` request/response shapes without updating FE.
2. Internal provider changes are allowed if the public API stays compatible.
3. Queue, cache, and async job endpoints are internal backend details; FE should not depend on provider internals.

## When FE changes need BE changes

| FE change | BE action |
|---|---|
| Add request fields | Update route validation and forward the new fields if needed |
| Rename response fields | Breaking change, update FE and BE together |
| Change model options | Usually no BE change if FE still sends `model` as a string |
| Add new endpoint | Update `app.ts` and API docs |

## When BE changes need FE changes

| BE change | FE action |
|---|---|
| Add optional response fields | Usually none |
| Remove or rename required response fields | FE update required |
| Change error code handling | Update FE service layer if it relies on that code |
| Swap provider implementation | None if the response contract stays the same |

## Current Provider Contract

- `translation-service` uses `TRANSLATION_PROVIDER=cliproxy`.
- Requests go directly to a Cliproxy / OpenAI-compatible `/v1/chat/completions` endpoint.
- Root web server may proxy `/api/*` to `translation-service`, but it should not own translation business logic.
