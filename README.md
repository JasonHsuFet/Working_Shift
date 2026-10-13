# Working_Shift

NOC 值班班表網站。純靜態前端，由 Excel 班表在建置時轉成 JSON，部署到 GitHub Pages。

## 功能

- **個人班表**：輸入工號查詢，可切換月／週檢視，「本月／本週」回到今天；月曆點日期、週列表點列即可查看當天班別與時間。
  「匯出此月／此週 ICS」會下載目前顯示範圍內的出勤班別，匯入手機或電腦行事曆。
  下方顯示該月（週）的早／中／晚／N／休天數，以及到所選日期為止的連續上班天數與下個休假日（只看已載入的月份，即所選月與前後各一個月）；所選日是出勤時，會列出當天同組（`ROSTER_GROUPS`，例如 `M1` 與 `1`）的同事。
- **當日班表**：預設為今天的「現」（此刻值班人員，每 30 秒更新）；可用日期列切換日期，或用「全／早／中／晚／N／休」按鈕篩選。「現」只在今天可用，按「今天」會回到「現」。
- **左右滑動**（觸控，或桌機用滑鼠拖曳）：個人班表切上／下月或週，當日班表切前／後一天。
- **工號輸入**：網址 `#/personal/工號` 直接顯示；沒帶且瀏覽器沒有記憶時會跳出視窗詢問，輸入後記在該瀏覽器；輸入時依工號開頭自動完成。
- **網址（hash 路由）**：

  | 路由 | 說明 |
  |---|---|
  | `#/personal` | 個人班表；有記憶的工號會自動帶入 |
  | `#/personal/工號` | 直接顯示該人員班表 |
  | `#/on-duty` | 當日班表 |

  月份、週、日期與篩選不進網址也不記憶，每次開啟都是本月／今天，存成主畫面後不會卡在舊的時期。月／週檢視是偏好設定，會記在瀏覽器（`noc.view`）。
  舊的 `?empno=工號` 連結仍會自動轉成 `#/personal/工號`（`?theme=` 已移除）。
- **按需載入**：開啟時只下載當前月與前後各一個月，其他月份在切換到時才下載；今天所在月份尚未發布時，預設開最新月份。工號查詢與自動完成只認得已載入月份中的人員。
- **主題**：右上圓形按鈕循環「跟隨系統 → 淺色 → 深色」。預設跟隨系統（`prefers-color-scheme`，系統切換時即時變色）；手動選淺色／深色才會記在瀏覽器。
- 其他：離線時顯示已儲存的班表並提示狀態、可加入主畫面（PWA）。

### 加入主畫面（iOS）

- `manifest.webmanifest` 的 `start_url` 為站台根目錄 `./`（不綁路由）：從主畫面圖示開啟時由路由導向 `#/personal`，並帶入已記住的工號；第一次開啟（主畫面 App 與瀏覽器的儲存空間可能分開）會詢問工號並記住，之後一律從本月開始。已加入的舊圖示需刪除後重新加入。
- 主畫面圖示使用 `assets/apple-touch-icon.png`（180x180、不透明方形）；透明圓形圖在 iOS 深色圖示模式下四角會變黑。

## 更新班表

1. 把 `data/All_YYYY.xlsx` 上傳或覆蓋到 `main`（每個月一個工作表，名稱 `01`…`12`）。
2. GitHub Actions 會執行測試、重新提取所有月份並部署。部署完成後使用者重新整理頁面即可看到新班表。

第一次設定：Settings → Pages → Source 選「GitHub Actions」。

### 資料格式

- 月份工作表：名稱為 `01`…`12`，其他名稱的工作表會警告後略過。前 10 列內要有日期列：連續的 `1`…`N`（N 等於該月天數），第 1 天不能在 A、B 欄。姓名欄在第 1 天的左邊一格，`Total` 欄再左一格。姓名欄出現班別代碼（如 `1`）且 Total 為空的列視為下方統計區，解析到此為止。
- 班別代碼會先轉成大寫再比對。
- `data/TPKC_NNOC班表模板_V1_3_DB版.xlsm`：
  - 「工號」工作表：A／B 欄為在職人員的姓名／工號，E／F 欄為離職人員備援；同名取第一筆。工號只接受 `T` 加數字或純數字（使用者輸入時開頭的 `f`／`F` 會被去掉）。
  - 「NNOC班別」工作表：班別名稱與上下班時間。
- 姓名在工號表找不到的人不會納入，頁面會顯示「來源資料提醒」。

### 會讓部署失敗的情況

`pnpm test` 與 `pnpm build` 遇到以下情況會中止，網站維持上一版：

- 不認得的班別代碼（先到 `shift-rules.mjs` 補上，見下節）
- 同一個月同一個工號出現兩次
- 日期欄天數和該月不符，或前 10 列找不到日期列
- 整個月沒有任何可用排班
- 同一個月份出現在多個 `All_YYYY.xlsx`
- DB 檔缺少「工號」或「NNOC班別」工作表

## 班別規則

班別代碼、分類與時間定義在 [scripts/lib/shift-rules.mjs](scripts/lib/shift-rules.mjs)。

| 篩選 | 班別代碼 | 時間來源 |
|---|---|---|
| 早 | `1`、`M1`、`早`、`T早`、`日` | `M1`、`T早` 值班 08:00–16:00；其餘取「NNOC班別」 |
| 中 | `2`、`M2`、`中`、`T中`、`小夜` | `M2`、`T中` 值班 16:00–24:00；其餘取「NNOC班別」 |
| 晚 | `3`、`晚`、`大夜` | 取「NNOC班別」 |
| N | `N`、`N8` | 取「NNOC班別」 |
| 休 | `X`、`Y`、`Z`、`S`、`T` | 無時間 |

- 分類依班別顏色判斷：`morning`／`afternoon`／`night` 對應早／中／晚，沒有顏色且非休假的歸 N。
- `M1`、`T早`、`M2`、`T中` 實際工作時間分別是 08:00–19:00、13:00–24:00，但 16:00 以後（M1、T早）與 16:00 以前（M2、T中）是支援，不值班。當前班表、當日班表與同班同事都依值班時間計算，且會和 `1`、`早`、`2`、`中` 編在同一組（`ROSTER_GROUPS`）；個人班表與 ICS 則顯示完整工作時間（例如「08:00–19:00（值班 08:00–16:00）」）。
- 新增班別代碼時，到 `shift-rules.mjs` 補上：
  - `SHIFT_TYPES`（必填）：代碼對應「NNOC班別」的班別名稱
  - `COLORS`：決定分類與顏色（早／中／晚）；不填且非休假歸 N
  - `REST_CODES`：休假類代碼要加在這裡，否則會被當成出勤
  - `TIME_ALIASES`：要沿用其他代碼在「NNOC班別」的時間時
  - `ROSTER_GROUPS`：要和其他代碼併成同一組（當日班表分組、同班同事）時
  - `GROUP_LABELS`：群組顯示名稱
  - `DUTY_TIMES`（值班時間）／`FULL_TIMES`（完整工作時間）：要特別指定時間時，優先於 Excel 的設定
- 沒有時間定義的出勤班別會出現在「時間未定義」，不納入「現」（目前值班），ICS 則匯出為全天事件。

## 本機開發

需要 Node.js 22 與 pnpm 10（`corepack enable` 即可）。`xlsx` 套件由 `cdn.sheetjs.com` 下載，需要能連到該網址。

```
pnpm install
pnpm test      # test/*.test.mjs：Excel 結構與班別解析、當班判斷、ICS、分類統計、路由
pnpm build     # 產生 dist/（網站檔案 + data/YYYY-MM.json）
pnpm preview   # 預覽 dist/（先 pnpm build）
```

- 不能直接用瀏覽器開啟 `web/index.html`（`file://` 無法下載班表），請用 `pnpm preview` 或任何 HTTP 伺服器。
- 測試不比對特定人員或班別，換人或改班不會讓測試失敗；但結構錯誤會（見「會讓部署失敗的情況」）。
- `test/excel.test.mjs` 會讀 `data/` 裡的真實 Excel，沒有這些檔案時會失敗。

## 專案結構

```
web/                               網站原始檔，build 時整包複製到 dist/
  index.html, manifest.webmanifest 頁面（含 SVG 圖示 sprite）與 PWA 設定
  sw.js                            Service Worker（網路優先、離線備援），需放在站台根目錄
  css/style.css                    樣式
  js/app.js                        畫面繪製與事件、路由對應
  js/schedule.js                   班表業務邏輯：當班判斷、班別分類與統計、值班分組、時間標籤、ICS
  js/store.js                      班表 JSON 按需下載與合併、檢查新版
  js/router.js                     hash 路由（navigo 風格 API）
  js/theme.js                      主題（在 <head> 同步執行，避免閃爍）
  assets/                          圖示（icon.svg、PWA 用 icon-*.png、iOS 用 apple-touch-icon.png）
data/                              Excel 來源檔
docs/ux-state-diagrams.md          UX 狀態圖（行為規格，改 UI 行為時一起更新）
scripts/build.mjs                  Excel → JSON 與網站打包
scripts/lib/excel.mjs              Excel 讀取與解析（工號表、班別表、月份工作表）
scripts/lib/shift-rules.mjs        班別代碼規則
test/                              測試（node --test）
.github/workflows/pages.yml        測試、建置與部署
package.json                       package 名稱為 not-shift（站名沿用 Working_Shift）
```

### 維護注意事項

- 命名規則：檔名 kebab-case、以領域命名；瀏覽器端 `.js`（ES module），Node 端 `.mjs`；員工編號一律 `empId`；當日班表一律 `on-duty`；localStorage key 為 `noc.<名稱>`。
- 瀏覽器端沒有打包工具，也沒有執行期依賴，`web/` 原樣部署。
- 新增或搬移 `web/` 下的檔案時，更新 `web/sw.js` 的 `SHELL` 並調高 `CACHE` 版本號，否則已安裝的使用者離線時會拿到舊或不完整的檔案。
- 程式註解用英文，介面文字用繁體中文。
- `legacy:` 註解標記相容舊版的程式（`?empno=` 轉址、舊 localStorage key `noc-static-theme`／`nnoc-static-empId`／`nnoc-static-view` 搬到 `noc.*`），日後可移除；`ponytail:` 註解標記刻意簡化的已知限制。

## 資料公開範圍

網站沒有登入或存取控制，所有人員的英文姓名、工號與班別都會發布成 JSON，知道網址的人都能下載。`noindex` 只是請搜尋引擎不要收錄，不是保護。
`data/` 內的 Excel 原始檔也在 repository 中，請確認 repository 與 Pages 的可見性符合預期。
