# Working_Shift

NOC 值班班表網站（GitHub Pages）。

- 更新班表：把 `data/All_YYYY.xlsx`（每月一個工作表 `01`…`12`）上傳或覆蓋到 `main`。GitHub Actions 會重新提取所有月份並重新部署網站。
- 工號與班別時間來自 `data/TPKC_NNOC班表模板_V1_3_DB版.xlsm` 的「工號」、「NNOC班別」工作表。
- 第一次設定：Settings → Pages → Source 選「GitHub Actions」。
- 本機預覽：`pnpm install && pnpm build && pnpm preview`
