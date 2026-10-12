# Working_Shift

NOC 值班班表網站。純靜態前端，由 Excel 班表在建置時轉成 JSON，部署到 GitHub Pages。

## 功能

- **個人班表**：輸入工號查詢，可切換月／週檢視，「本月／本週」回到今天；月曆點日期、週列表點列即可查看當天班別與時間。
  「匯出此月／此週 ICS」會下載目前顯示範圍內的出勤班別，匯入手機或電腦行事曆。
- **當前班表**：此刻值班的人員，依班別分組，每 30 秒更新。
- **當日班表**：任選日期（可前後一天切換），用「全／早／中／晚／N／休」按鈕篩選。
- **工號輸入**：網址帶 `?empno=工號` 直接顯示；沒帶且瀏覽器沒有記憶時會跳出視窗詢問，輸入後記在該瀏覽器；輸入時依工號開頭自動完成。
- 其他：深色模式、離線時顯示已儲存的班表並提示狀態、可加入主畫面（PWA）。

## 更新班表

1. 把 `data/All_YYYY.xlsx` 上傳或覆蓋到 `main`（每個月一個工作表，名稱 `01`…`12`）。
2. GitHub Actions 會執行測試、重新提取所有月份並部署。部署完成後使用者重新整理頁面即可看到新班表。

第一次設定：Settings → Pages → Source 選「GitHub Actions」。

### 資料格式

- 月份工作表：前 10 列內要有日期列（`1`、`2`、`3`…），姓名欄在第 1 天的左邊一格，`Total` 欄再左一格。姓名欄出現班別代碼（如 `1`）且 Total 為空的列視為下方統計區，解析到此為止。
- `data/TPKC_NNOC班表模板_V1_3_DB版.xlsm`：
  - 「工號」工作表：A／B 欄為在職人員的姓名／工號，E／F 欄為離職人員備援；同名取第一筆。
  - 「NNOC班別」工作表：班別名稱與上下班時間。
- 姓名在工號表找不到的人不會納入，頁面會顯示「來源資料提醒」。

## 班別規則

班別代碼、分類與時間定義在 [scripts/build.mjs](scripts/build.mjs)。

| 篩選 | 班別代碼 | 時間來源 |
|---|---|---|
| 早 | `1`、`M1`、`早`、`T早`、`日` | `M1`、`T早` 固定 08:00–19:00；其餘取「NNOC班別」 |
| 中 | `2`、`M2`、`中`、`T中`、`小夜` | `M2`、`T中` 固定 13:00–24:00；其餘取「NNOC班別」 |
| 晚 | `3`、`晚`、`大夜` | 取「NNOC班別」 |
| N | `N`、`N8` | 取「NNOC班別」 |
| 休 | `X`、`Y`、`Z`、`S`、`T` | 無時間 |

- 分類依班別顏色判斷：`morning`／`afternoon`／`night` 對應早／中／晚，沒有顏色且非休假的歸 N。
- 新增班別代碼時，到 `build.mjs` 補上 `SHIFT_TYPES`（代碼對應班別名稱）與 `COLORS`（決定分類與顏色）；時間要特別指定時加在 `FIXED_TIMES`，優先於 Excel 的設定。
- 沒有時間定義的出勤班別會出現在「時間未定義」，不納入當前班表，ICS 則匯出為全天事件。

## 本機開發

需要 Node.js 22 與 pnpm 10（`corepack enable` 即可）。`xlsx` 套件由 `cdn.sheetjs.com` 下載，需要能連到該網址。

```
pnpm install
pnpm test      # 檢查 Excel 結構、班別解析、當班判斷、ICS、篩選分類
pnpm build     # 產生 dist/（網站檔案 + data/YYYY-MM.json）
pnpm preview   # 預覽 dist/
```

- 不能直接用瀏覽器開啟 `index.html`（`file://` 無法下載班表），請用 `pnpm preview` 或任何 HTTP 伺服器。
- 測試只檢查資料結構，不比對特定人員或班別，因此更新班表不會因內容變動而失敗。

## 專案結構

```
index.html, app.js, style.css      頁面、互動邏輯、樣式
schedule-core.js                   共用邏輯：當班判斷、週起始日、班別分類、ICS 產生
sw.js, manifest.webmanifest        Service Worker（網路優先、離線備援）與 PWA 設定
assets/                            圖示
data/                              Excel 來源檔
scripts/build.mjs                  Excel → JSON 與網站打包
scripts/build.test.mjs             測試
.github/workflows/pages.yml        測試、建置與部署
```

## 資料公開範圍

網站沒有登入或存取控制，所有人員的英文姓名、工號與班別都會發布成 JSON，知道網址的人都能下載。`noindex` 只是請搜尋引擎不要收錄，不是保護。
`data/` 內的 Excel 原始檔也在 repository 中，請確認 repository 與 Pages 的可見性符合預期。
