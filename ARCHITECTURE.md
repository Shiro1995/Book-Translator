# Architecture

## Module-first structure

- `src/app`
  App bootstrap, router, layouts, app-level pages.
- `src/modules/<module-name>`
  Mỗi module tự sở hữu `pages`, `services`, `types`, và route của riêng nó.
- `src/shared`
  Dành cho code dùng chung nhiều module. Hiện chưa cần tạo vội.

## Router strategy

- Module registry nằm tại `src/app/router/modules.ts`.
- Mỗi module export một `AppModuleDefinition` qua public API `index.ts`.
- App router chỉ biết registry, không import sâu vào internals của module.

## Expansion rule

1. Tạo `src/modules/<new-module>`.
2. Thêm `module.tsx` và export qua `index.ts`.
3. Đăng ký module trong `src/app/router/modules.ts`.
4. Chỉ đưa reusable code sang `src/shared` khi đã có ít nhất 2 module cùng cần.

## Boundary guideline

- `app` có thể import public API của `modules`.
- Một module không nên import internals của module khác.
- Nếu sau này dùng tool kiểm soát kiến trúc, nên enforce theo public API `index.ts`.
