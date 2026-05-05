# AGENTS.md

## Cursor Cloud specific instructions

### 概覽

Tokinosora Bus 是一個 Next.js 16 (App Router) 即時公車追蹤應用。使用 Turbopack 進行開發。

### 開發指令

參見 `package.json` scripts：

- `pnpm dev` — 啟動 Turbopack dev server（port 3000）
- `pnpm build` — 生產建置
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript 型別檢查
- `pnpm format` — Prettier 格式化

### 環境變數

需在 `.env.local` 設定（此檔不應提交到 git）：

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps JavaScript API key
- `TDX_ACCESS_TOKEN` 或 `TDX_CLIENT_ID` + `TDX_CLIENT_SECRET` — TDX 運輸資料交換平台憑證

沒有有效 API key 時，app 仍可啟動，地圖會顯示 Google Maps 錯誤，API endpoint 會回 401。

### 注意事項

- `pnpm install` 會出現 ignored build scripts 警告（msw, sharp, unrs-resolver），不影響開發功能。
- 沒有資料庫或本地外部服務依賴，只需 Node.js + pnpm 即可完整開發。
- Node.js 22 LTS 已驗證可用。
- 此專案使用 ESM (`"type": "module"`)。
