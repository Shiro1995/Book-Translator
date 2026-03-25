# Checklist: FE ↔ BE Sync

> Dùng checklist này mỗi khi thay đổi API hoặc shared types.

---

## Khi đổi API endpoint (request/response)

- [ ] Cập nhật `translation-service/API_CONTRACT.md`
- [ ] Cập nhật `docs/BACKEND_API.md` (FE repo)
- [ ] FE types match BE response? (check bảng mapping trong `SYNC_RULES.md`)
- [ ] BE Zod validation match request shape?
- [ ] Error codes/format consistent?
- [ ] Backward compatible? (nếu không → ghi BREAKING trong changelog)

## Khi thêm endpoint mới

- [ ] BE: tạo route file trong `routes/`
- [ ] BE: register trong `app.ts` (internal + `/api/*` compat)
- [ ] BE: thêm rate limiter nếu mutation endpoint
- [ ] Cập nhật `API_CONTRACT.md`
- [ ] FE: tạo service function gọi endpoint
- [ ] Cập nhật `docs/BACKEND_API.md`
- [ ] Ghi changelog trong `docs/changelog/fe-be-sync.md`

## Khi đổi shared types

- [ ] Check bảng mapping:

| FE type | BE type |
|---------|---------|
| `SelectionAiResult` | `SelectionInsightResponse` |
| `SelectionAiRequest` | `SelectionInsightsRequestBody` |
| `SelectionAiAlternative` | `SelectionInsightAlternative` |
| `SelectionAiGlossaryApplied` | `SelectionInsightGlossaryApplied` |
| `SelectionAiSegmentation` | `SelectionInsightSegmentation` |

- [ ] Đổi bên này → đổi bên kia
- [ ] Cập nhật `API_CONTRACT.md`

## Khi đổi model handling

- [ ] FE model fallback chain: kiểm `translationService.ts` + `selectionAiService.ts`
- [ ] BE forward `model` nguyên vẹn? (check `translation-jobs.ts` + `selection-insights.ts`)
- [ ] Cliproxy provider có dùng đúng model / env mapping?

## Khi thay đổi FE-only features

- [ ] Dictionary lookup → chỉ FE, **không cần sync BE**
- [ ] Vietnamese Assist → chỉ FE, **trừ khi đổi `/api/selection-insights`**
- [ ] Glossary lookup → chỉ FE
- [ ] Selection classifier → chỉ FE
- [ ] Analytics → chỉ FE

## Pre-deploy

- [ ] `API_CONTRACT.md` up to date?
- [ ] `SYNC_RULES.md` up to date?
- [ ] `docs/changelog/fe-be-sync.md` có entry mới?
- [ ] BE `npm run lint` pass?
- [ ] FE `npm run build` pass?
- [ ] Test BE: `curl localhost:3100/health` → `ok`
- [ ] Test BE: `curl localhost:3100/ready` → `ready: true`
- [ ] FE gọi `/api/translate` thành công?
- [ ] FE selection insights hoạt động?
