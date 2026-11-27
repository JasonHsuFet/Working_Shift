# Working_Shift

NOC 值班班表網站。Excel 班表在建置時轉成 JSON，網站本身是純靜態頁面，部署在 GitHub Pages。

## 功能

### 個人班表

- 輸入工號後顯示該人員的班表，可以切換月檢視與週檢視。
- 點月曆的日期或週列表的某一列，下方會顯示當天的班別與時間。
- 月檢視點標題（年月）會開啟選擇器，可以跳到任何已發布的月份。
- 「今天」按鈕回到今天。今天不在已發布範圍時，按鈕會停用。
- 「匯出 ICS」下載目前範圍內的出勤班別，可以匯入手機或電腦的行事曆。
- 下方統計：
  - 這個月（或這週）早、中、晚、N、休各幾天。
  - 到所選日期為止連續上班幾天，以及下一個休假日。
  - 統計只看已載入的月份，也就是所選月份與前後各一個月。
- 所選日期是出勤日時，會列出當天同組的同事。同組由 `ROSTER_GROUPS` 決定，例如 `M1` 與 `1` 是同一組。

### 當日班表

- 預設顯示「現」：此刻正在值班的人員，每 30 秒更新一次。
- 用日期列切換日期，或用「全、早、中、晚、N、休」按鈕篩選。
- 「現」只能用在今天。按「今天」會回到今天並切回「現」。

### 共通

- **左右滑動**：觸控滑動，或在桌機用滑鼠拖曳。個人班表切換上／下個月（週），當日班表切換前／後一天。
- **工號**：
  - 網址帶 `#/personal/工號` 時直接顯示該人員。
  - 網址沒帶工號、瀏覽器也沒記住時，會跳出視窗詢問。輸入後會記在這個瀏覽器。
  - 輸入時會依工號開頭自動完成。
- **按需載入**：
  - 開啟時只下載當月與前後各一個月，其他月份切換到時才下載。
  - 今天所在的月份還沒發布時，預設開啟最新的月份。
  - 工號查詢與自動完成只認得已載入月份裡的人員。
- **主題**：右上角的圓形按鈕依序切換「跟隨系統 → 淺色 → 深色」。
  - 預設跟隨系統（`prefers-color-scheme`），系統切換時會即時變色。
  - 只有手動選擇淺色或深色時才會記在瀏覽器。
- **離線**：沒有網路時顯示上次儲存的班表，並在狀態列提示。網站可以加入主畫面（PWA）。

### 網址

網站使用 hash 路由：

| 路由 | 說明 |
|---|---|
| `#/personal` | 個人班表。瀏覽器記住的工號會自動帶入。 |
| `#/personal/工號` | 直接顯示該人員的班表。 |
| `#/on-duty` | 當日班表。 |

- 月份、週、日期與篩選都不寫進網址，也不會記住。每次開啟都從本月或今天開始，存成主畫面後不會停在舊的月份。
- 月檢視或週檢視是偏好設定，會記在瀏覽器（`noc.view`）。
- 舊的 `?empno=工號` 連結會自動轉成 `#/personal/工號`。`?theme=` 已經移除。

### 加入主畫面（iOS）

- `manifest.webmanifest` 的 `start_url` 是站台根目錄 `./`，不綁定路由。從主畫面開啟時，路由會導向 `#/personal` 並帶入記住的工號。
- 主畫面 App 與瀏覽器的儲存空間可能是分開的。第一次從主畫面開啟時會再詢問一次工號，之後都從本月開始。
- 已經加入主畫面的舊圖示，需要刪除後重新加入。
- 主畫面圖示是 `assets/apple-touch-icon.png`，180×180 的不透明方形。透明的圓形圖示在 iOS 深色圖示模式下，四個角會變黑。

## 更新班表

1. 把 `data/All_YYYY.xlsx` 上傳或覆蓋到 `main`。每個月一個工作表，名稱為 `01`…`12`。
   - 可以只放已經開始排的月份。
   - 月份也可以只排到一半，見下方「資料格式」。
2. GitHub Actions 會執行測試、重新提取所有月份，然後部署。部署完成後，使用者重新整理頁面就會看到新班表。

第一次設定時，到 Settings → Pages → Source 選「GitHub Actions」。

### 資料格式

**月份工作表**

- 名稱必須是 `01`…`12`。其他名稱的工作表會印出警告並略過。
- 前 10 列內要有日期列，也就是連續的 `1`、`2`、`3`…`N`。第 1 天不能在 A、B 欄。
- 第 1 天左邊一格是姓名欄，再左邊一格是 `Total` 欄。
- `N` 等於該月天數時，是完整的月份。
- `N` 比較少時，表示這個月還在排：
  - 第 `N` 天之後，網站顯示「尚未排班」，build log 也會印出警告。
  - 這時日期列的同一列或上一列，`Total` 欄必須有文字 `Total`，用來確認這一列真的是日期列。
- 姓名欄出現班別代碼（例如 `1`）而且 Total 是空的那一列，視為下方的統計區，解析到這裡為止。
- 班別代碼會先轉成大寫再比對。

**DB 檔 `data/TPKC_NNOC班表模板_V1_3_DB版.xlsm`**

- 「工號」工作表：
  - A、B 欄是在職人員的姓名與工號，E、F 欄是離職人員，作為備援。
  - 同一個姓名出現多次時，取第一筆。
  - 工號只接受 `T` 加數字，或純數字。使用者輸入時，開頭的 `f` 或 `F` 會被去掉。
- 「NNOC班別」工作表：班別名稱與上下班時間。
- 在工號表找不到的姓名不會納入，頁面會顯示「來源資料提醒」。

### 會讓部署失敗的情況

遇到以下情況時，`pnpm test` 或 `pnpm build` 會中止，網站維持上一版：

- 出現不認得的班別代碼。先到 `shift-rules.mjs` 補上，見「班別規則」。
- 同一個月裡，同一個工號出現兩次。
- 日期列的天數超過該月天數，或前 10 列找不到日期列。
- 整個月沒有任何可用的排班。
- 同一個月份出現在多個 `All_YYYY.xlsx` 裡。
- DB 檔缺少「工號」或「NNOC班別」工作表。
- `data/` 裡沒有任何 `All_YYYY.xlsx` 月份班表。

## 班別規則

班別代碼、分類與時間定義在 [scripts/lib/shift-rules.mjs](scripts/lib/shift-rules.mjs)。

| 篩選 | 班別代碼 | 時間來源 |
|---|---|---|
| 早 | `1`、`M1`、`早`、`T早`、`日` | `M1`、`T早` 值班 08:00–16:00，其餘取「NNOC班別」 |
| 中 | `2`、`M2`、`中`、`T中`、`小夜` | `M2`、`T中` 值班 16:00–24:00，其餘取「NNOC班別」 |
| 晚 | `3`、`晚`、`大夜` | 取「NNOC班別」 |
| N | `N`、`N8` | 取「NNOC班別」 |
| 休 | `X`、`Y`、`Z`、`S`、`T` | 無時間 |

- 分類依班別顏色判斷。`morning`、`afternoon`、`night` 分別對應早、中、晚。沒有顏色而且不是休假的班別歸到 N。
- **支援時段**：`M1`、`T早` 實際工作 08:00–19:00，`M2`、`T中` 實際工作 13:00–24:00。多出來的時段是支援，不算值班。
  - 「現」、當日班表與同班同事都依值班時間計算，並和 `1`、`早`、`2`、`中` 編在同一組（`ROSTER_GROUPS`）。
  - 個人班表與 ICS 顯示完整的工作時間，例如「08:00–19:00（值班 08:00–16:00）」。
- 沒有時間定義的出勤班別會列在「時間未定義」，不納入「現」。ICS 會把它匯出成全天事件。

新增班別代碼時，在 `shift-rules.mjs` 補上：

| 設定 | 用途 |
|---|---|
| `SHIFT_TYPES` | 必填。代碼對應到「NNOC班別」裡的班別名稱。 |
| `COLORS` | 決定分類與顏色（早、中、晚）。不填而且不是休假時，歸到 N。 |
| `REST_CODES` | 休假類代碼要加在這裡，否則會被當成出勤。 |
| `TIME_ALIASES` | 要沿用另一個代碼在「NNOC班別」裡的時間時。 |
| `ROSTER_GROUPS` | 要和另一個代碼併成同一組時（當日班表分組、同班同事）。 |
| `GROUP_LABELS` | 群組的顯示名稱。 |
| `DUTY_TIMES`、`FULL_TIMES` | 指定值班時間與完整工作時間，優先於 Excel 的設定。 |

## 本機開發

需要 Node.js 22 與 pnpm 12。執行 `corepack enable` 即可，版本由 `package.json` 的 `packageManager` 決定。

```bash
pnpm install
pnpm test      # 單元測試：Excel 解析、當班判斷、統計、ICS、路由、CSS 尺寸規則
pnpm build     # 產生 dist/：網站檔案與 data/YYYY-MM.json
pnpm preview   # 預覽 dist/，要先 pnpm build
pnpm test:e2e  # 瀏覽器測試：先 build，再用無頭 Chromium 以桌機與手機（Pixel 7）尺寸操作網站
pnpm perf      # 效能剖析：要先 pnpm build 並開著 pnpm preview；可以給多個網址並排比較
```

- 不能直接用瀏覽器開啟 `web/index.html`，因為 `file://` 無法下載班表。請用 `pnpm preview` 或任何 HTTP 伺服器。
- `test/excel.test.mjs` 會讀 `data/` 裡的真實 Excel，沒有這些檔案時會失敗。

### 測試

- 測試只涵蓋核心流程：資料能不能正確部署，以及使用者能不能看到自己的班表。
- 測試不寫死人員或班別。換人或改班不會讓測試失敗，結構錯誤才會（見「會讓部署失敗的情況」）。
- 瀏覽器測試從已發布的資料挑最後一個完整月份與第一位人員，並把時鐘固定在該月 15 號。
- 「只排到一半的月份」用攔截 JSON 的方式模擬，不需要另外準備 Excel。
- 瀏覽器測試只在本機跑，CI 不跑。第一次執行前，要先下載瀏覽器並安裝系統套件（Ubuntu）：

  ```bash
  pnpm exec playwright install --only-shell chromium
  ```

  ```bash
  sudo apt-get install -y libnss3 libnspr4 fonts-noto-cjk
  ```

### 依賴

- `xlsx`（SheetJS）不在 npm registry 上，從 `cdn.sheetjs.com` 下載。`pnpm-lock.yaml` 記錄了它的 sha512，CDN 上的檔案被換掉時安裝會失敗。
  - 必須用 pnpm 12：pnpm 10 不會替網址安裝的套件記錄 integrity。
  - 自動更新工具不會追蹤它，安全性修正要自己留意 SheetJS 的發布。
- `alpinejs` 是唯一的瀏覽器端依賴。`pnpm build` 把它從 `node_modules/alpinejs/dist/module.esm.min.js` 複製成 `dist/js/alpine.js`，不走 CDN。
- CI 用 `pnpm install --prod`，只裝 `xlsx` 與 `alpinejs`，所以這兩個必須留在 `dependencies`。`vite` 與 `@playwright/test` 只在本機使用。
- Node 版本：CI 固定 22。程式用到 `import.meta.dirname`，至少要 Node 20.11。
- 升級 SheetJS：

  ```bash
  pnpm add https://cdn.sheetjs.com/xlsx-<版本>/xlsx-<版本>.tgz
  ```

  確認 `pnpm-lock.yaml` 的 `xlsx` 項目有 `integrity`，再一起 commit。

## 架構

### 共用的資料形狀

建置端 `parseMonthSheet` 的輸出、`dist/data/YYYY-MM.json`、前端合併後的 `store.data` 是同一個形狀。所以 `schedule.js` 的函式在建置端的測試和前端都能直接使用。

```js
{
  dates: ['YYYY-MM-01', …],        // 整月每一天（只在單月檔案）
  writtenDays: { 'YYYY-MM': n },   // 日期列寫到第幾天；合併後每個已載入月份一筆
  shifts: { [code]: { type, label, group, color, rest, start, end, fullStart?, fullEnd? } },
  employees: [{ empId, name }],    // 前端合併成 Map
  records: [{ empId, date, code, leader? }],
  warnings: [string]
}
// dist/data/index.json；generatedAt 也用來判斷有沒有新版
{ months: ['2025-01', …], generatedAt: ISO }
```

某人某天的狀態一律由 `schedule.dayState(data, empId, date)` 判斷：

| 狀態 | 條件 | 畫面 |
|---|---|---|
| `work`、`rest` | 有班別代碼 | 班別、時間、顏色 |
| `unwritten` | 月份已載入，但日期列還沒寫到這天。對所有人都一樣。 | 虛線框、「尚未排班」 |
| `none` | 日期列已寫到這天，但此人沒有代碼，例如新進、離職或空白格。 | 「—」、「此日期沒有排班資料」 |
| `unpublished` | 月份沒發布，或還沒載入。 | 「—」、「無資料」 |

整天是否已排（日期列有沒有寫到）由 `schedule.isWritten(data, date)` 判斷，用在當日班表與狀態列。

### 前端

- **啟動順序**：`context.js` 先下載索引與當月班表（top-level `await`），並建立 `Alpine.store('app')`。各分頁模組接著用 `Alpine.data()` 註冊元件，`app.js` 呼叫 `Alpine.start()` 之後才解析路由。
- **`version`**：班表資料有幾千筆，刻意不放進 Alpine 的響應式系統。每次真的合併進新月份，`$store.app.version` 就加一；讀 `data` 的 getter 都會讀 `version`，所以會跟著重算。
- **載入**：兩個分頁都是先 `await ensure()`，月份下載完才改畫面狀態，並用序號丟掉晚回來的舊請求。
- **效能**：Alpine 每個繫結都會重跑 getter，所以較重的 getter 用 `memo()` 快取，迴圈裡只用純值，隱藏中的檢視回傳空陣列。用 `pnpm perf` 量測改動前後的差異。

### 已知限制

- 統計（早、中、晚、N、休）不計「尚未排班」的天數，月份排到一半時，加總會少於該月天數。
- Alpine 用 `new AsyncFunction` 執行樣板裡的運算式。若之後加上禁止 `unsafe-eval` 的 CSP，要改用 Alpine 的 CSP 版本。
- 瀏覽器測試沒有涵蓋：年月選擇器、在對話框內滑動、跨午夜、清除工號、WebKit 與 iOS Safari、Service Worker 離線、主畫面 App。
- 最低瀏覽器版本約為 Chrome 92、Safari 15.4、Firefox 90，受限於 top-level `await` 與 `Array.prototype.at`。

## 專案結構

```
web/                               網站原始檔，build 時整包複製到 dist/
  index.html                       頁面、Alpine 樣板與 SVG 圖示 sprite
  manifest.webmanifest             PWA 設定
  sw.js                            Service Worker（網路優先、離線備援），必須放在站台根目錄
  css/style.css                    樣式
  js/app.js                        外框（Alpine 元件 page）：狀態列、來源提醒、分頁、路由、時鐘；啟動 Alpine
  js/context.js                    啟動流程與共用狀態：舊 key 搬移、Service Worker、載入班表、Alpine store、路由器
  js/personal.js                   個人班表（Alpine 元件 personal）
  js/on-duty.js                    當日班表（Alpine 元件 onDuty）
  js/employee.js                   工號表單、詢問視窗、自動完成、#/personal 路由
  js/dom.js                        共用小工具：取元素、日期標籤、快取、滑動手勢
  js/schedule.js                   班表邏輯：每日狀態、當班判斷、分類與統計、值班分組、ICS
  js/store.js                      按需下載班表 JSON 並合併、檢查新版
  js/router.js                     hash 路由
  js/theme.js                      主題（在 <head> 同步執行，避免閃爍）
  assets/                          圖示：icon.svg、PWA 用的 icon-*.png、iOS 用的 apple-touch-icon.png
data/                              Excel 來源檔
docs/ux-state-diagrams.md          UX 狀態圖（行為規格，改 UI 行為時一起更新）
scripts/build.mjs                  Excel 轉 JSON，並打包網站
scripts/lib/excel.mjs              讀取與解析 Excel：工號表、班別表、月份工作表、leader 底色
scripts/lib/shift-rules.mjs        班別代碼規則
test/                              單元測試（node --test）
e2e/site.spec.mjs                  瀏覽器測試（Playwright）
e2e/perf.mjs                       效能剖析
playwright.config.mjs              瀏覽器測試設定
.github/workflows/pages.yml        測試、建置與部署
package.json                       package 名稱是 not-shift，站名沿用 Working_Shift
```

## 維護注意事項

- **命名**：
  - 檔名用 kebab-case，以領域命名。
  - 瀏覽器端用 `.js`（ES module），Node 端用 `.mjs`。
  - 員工編號一律叫 `empId`，當日班表一律叫 `on-duty`。
  - localStorage 的 key 是 `noc.<名稱>`。
- **前端沒有打包工具**，`web/` 原樣部署。畫面結構寫在 `index.html` 的 Alpine 樣板裡；改 UI 時，通常是改樣板與元件的 getter，不需要手動組 DOM。
- **Service Worker**：在 `web/` 新增或搬移檔案時，要更新 `web/sw.js` 的 `SHELL`，並調高 `CACHE` 的版本號。否則已安裝的使用者離線時，會拿到舊的或不完整的檔案。
- **CSS 尺寸規則**（`test/css.test.mjs` 會檢查，CI 也會跑）：
  - `font-size`、`padding`、`margin`、`gap` 只能用 `style.css` 開頭定義的 `--space-*`、`--text-*` token，或明確的 rem。
  - 除了 `border*` 與 `*shadow`，不寫 px，`@media` 也用 rem。不用 em。
  - 版面用 flex 或 grid，搭配 fr 或 %。
  - 標題用 `clamp()` 定義的 `--text-title` 與 `--text-display`。
- **語言**：程式註解用英文，介面文字用繁體中文。註解只寫程式碼本身看不出來的原因。
- **標記**：
  - `legacy:` 標記相容舊版的程式，日後可以移除。目前有 `?empno=` 轉址，以及舊 localStorage key（`noc-static-theme`、`nnoc-static-empId`、`nnoc-static-view`）搬到 `noc.*`。
  - `ponytail:` 標記刻意簡化、已知有限制的地方。

## 資料公開範圍

- 網站沒有登入或存取控制。所有人員的英文姓名、工號與班別都會發布成 JSON，知道網址的人都能下載。
- `noindex` 只是請搜尋引擎不要收錄，不是保護。
- `data/` 裡的 Excel 原始檔也在 repository 中。請確認 repository 與 Pages 的可見性符合預期。
