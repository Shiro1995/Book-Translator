# Changelog: FE ↔ BE Sync

> Ghi lại mọi thay đổi ảnh hưởng giữa FE và BE.
> AI đọc file này để biết history thay đổi.

---

## 2026-03-25 — Initial Decoupling

### Tách BE ra khỏi monolith

**Before**: `server.ts` (809 lines) chứa tất cả: SPA + translate + parse-docx + selection-insights

**After**:
- `server.ts` → ~35 lines (SPA-only)
- `translation-service/` → Express standalone (:3100)
- Nginx split routing: `/api/*` → :3100, `/*` → :3000

### Endpoints migrated

| Endpoint | From | To |
|----------|------|----|
| `POST /api/translate` | `server.ts` | `translation-service/routes/translation-jobs.ts` |
| `POST /api/parse-docx` | `server.ts` | `translation-service/routes/document-jobs.ts` |
| `POST /api/selection-insights` | `server.ts` | `translation-service/routes/selection-insights.ts` |

### FE changes: NONE
- Zero FE code changes required
- All `/api/*` calls continue working via Nginx routing

---

## 2026-03-25 — Dictionary API Integration

### Added dictionaryapi.dev to FE dictionary lookup

**FE changes**:
- `dictionaryLookupService.ts`: now async, calls `dictionaryapi.dev` for Latin-script words
- `OriginalTextSelectionPane.tsx`: dictionary lookup uses async/await + AbortController

**BE changes**: NONE (dictionary runs client-side)

---

## 2026-03-25 — Vietnamese Assist Feature

### Added Vietnamese Assist block to Dictionary tab

**FE changes**:
- New: `vietnameseAssistService.ts` (provider chain: internal → botudien → AI micro)
- New: `VietnameseAssistResult`, `EnglishDictionaryAssist` types in `selection/types.ts`
- Modified: `OriginalTextSelectionPane.tsx` (new state + effect + abort management)
- Modified: `SelectionInspector.tsx` (render Vietnamese Assist block)

**BE changes**: NONE (uses existing `/api/selection-insights` as fallback)

---

## 2026-03-25 — Documentation

### Created FE/BE sync documentation

- `translation-service/API_CONTRACT.md`
- `translation-service/SYNC_RULES.md`
- `translation-service/ARCHITECTURE.md`
- `docs/BACKEND_API.md`
- `docs/architecture/overview.md`
- `docs/api-contracts/dictionary-lookup.md`
- `docs/api-contracts/translation-jobs.md`
- `docs/features/selection-inspector.md`
- `docs/features/vietnamese-assist.md`
- `docs/changelog/fe-be-sync.md`
- `docs/checklists/fe-be-sync-checklist.md`

---

## Template cho entries mới

```markdown
## YYYY-MM-DD — Title

### Mô tả ngắn

**FE changes**:
- File: `path/to/file.ts` — mô tả thay đổi

**BE changes**:
- File: `path/to/file.ts` — mô tả thay đổi
- Hoặc: NONE

**Contract changes**:
- `API_CONTRACT.md` updated: thêm/sửa endpoint X

**Breaking?**: Yes/No
```
