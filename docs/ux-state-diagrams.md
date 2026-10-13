# UX 狀態圖

依程式碼實際行為整理（`web/js/app.js`、`router.js`、`store.js`、`theme.js`、`web/index.html`、`web/manifest.webmanifest`）。

路由：`#/personal`、`#/personal/:empId`、`#/on-duty`；月份、週、選定日一律不進網址。

---

## 情境一：開啟網站（瀏覽器網址、書籤、分享連結）

```mermaid
stateDiagram-v2
    state "舊網址改寫<br/>?empno=X 改成 /personal/X<br/>其他查詢參數（含 ?theme）全部捨棄" as Legacy
    state "載入中<br/>工號表單停用（分頁連結可點，載入完才生效）" as Loading
    state "致命錯誤" as Fatal
    state route <<choice>>
    state "個人班表 /personal 或 /personal/:empId" as Personal
    state "當日班表 /on-duty<br/>（進入路由時才繪製）" as OnDuty

    [*] --> Legacy: 網址帶 ?empno=
    [*] --> Loading: 一般網址
    Legacy --> Loading
    Loading --> Fatal: file:// / index.json 或當月下載失敗 / 逾時
    Fatal --> [*]: 只能手動重新整理
    Loading --> route: 載入完成
    route --> Personal: /personal 開頭
    route --> OnDuty: /on-duty
    route --> Personal: 其他或空白（replace 成 /personal）
    Personal --> OnDuty: 點分頁（新增瀏覽紀錄）
    OnDuty --> Personal: 點分頁 / 上一頁
    note right of OnDuty
        可直接加書籤或分享 /on-duty、/personal/工號
        重新整理會停在同一分頁與同一工號
        舊網址改寫為相容用途，程式內以 legacy 註記，日後可移除
    end note
```

## 情境二：從主畫面圖示開啟（PWA）

```mermaid
stateDiagram-v2
    state "從主畫面圖示開啟<br/>manifest start_url = ./（無 hash，不綁路由）" as Pwa
    state "載入中" as Loading
    state "replace 成 /personal" as Root
    state pick <<choice>>
    state "檢視班表 /personal/工號<br/>本月、月檢視、今天" as Viewing
    state "對話框：請輸入員工編號" as Dialog

    [*] --> Pwa
    Pwa --> Loading
    Loading --> Root: 空白 hash
    Root --> pick
    pick --> Viewing: localStorage 記住的工號仍有效
    pick --> Dialog: 沒記住
    Dialog --> Viewing: 送出有效工號（記住）
    note right of Viewing
        加入主畫面不保存當下網址與時期，避免卡在某段班表
        iOS 主畫面 App 與 Safari 的 localStorage 可能分開，第一次開啟會跳對話框
        之前用 ?empno= 加入的 iOS 舊圖示仍開啟舊網址，經情境一改寫後可用
    end note
```

## 情境三：個人班表的工號（由路由驅動）

```mermaid
stateDiagram-v2
    state pick <<choice>>
    state norm <<choice>>
    state "對話框：請輸入員工編號<br/>（本次開啟只問一次）" as Dialog
    state "對話框內錯誤" as DialogErr
    state "工號表單<br/>提示：請輸入工號以檢視個人班表" as FormHint
    state "工號表單（空白）<br/>網址 /personal" as Form
    state "工號表單＋錯誤<br/>網址停在 /personal/錯誤工號<br/>記住的工號保持不變" as FormErr
    state "檢視班表<br/>網址 /personal/工號，記住工號" as Viewing

    [*] --> pick
    pick --> norm: 網址有工號
    norm --> norm: 大小寫等未正規化 → replace 成正規化網址
    norm --> Viewing: 有效
    norm --> FormErr: 無效
    pick --> Viewing: 無工號，但目前已選人或 localStorage 記住且有效（replace 補上工號）
    pick --> Dialog: 無工號、沒記住、本次尚未問過
    pick --> Form: 無工號、沒記住、已問過

    Dialog --> DialogErr: 送出無效工號
    DialogErr --> Viewing: 送出有效工號（replace 網址）
    Dialog --> Viewing: 送出有效工號（replace 網址）
    Dialog --> FormHint: 稍後再說 / Esc
    DialogErr --> FormHint: 稍後再說 / Esc

    FormHint --> norm: 查詢（replace 網址）
    Form --> norm: 查詢（replace 網址）
    FormErr --> norm: 查詢（replace 網址）
    Viewing --> Form: 清除工號（push /personal）
    Form --> Viewing: 上一頁（回到 /personal/工號，並重新記住）
    note right of Viewing
        直接改網址成另一個工號 = 換人，不必先清除
        從當日班表切回來：同一人，月份與選定日保留
        清除後按上一頁會重新記住工號
    end note
```

## 情境四：瀏覽個人班表（月 / 週檢視）

```mermaid
stateDiagram-v2
    state "月檢視<br/>月曆格＋選定日明細＋本月統計、連續上班、下個休假日" as Month
    state "週檢視<br/>7 列清單＋選定日明細＋本週統計、連續上班、下個休假日" as Week

    [*] --> Month: 每次載入、每次換人都從本月開始（上次選週則進週檢視）
    Month --> Week: 點「週」（記在 noc.view）
    Week --> Month: 點「月」（記在 noc.view）

    Month --> Month: ← / → / 左右滑：上下一個已發布月份（兩端停用）
    Month --> Month: 點日期格：改選定日
    Week --> Week: ← / → / 左右滑：±7 天，夾在發布範圍內
    Week --> Week: 點某一列：改選定日（可跨月）
    Month --> Month: 「今」或標題：跳回今天（今天不在範圍則停用）
    Week --> Week: 「今」或標題：跳回今天
    note right of Month
        起始月份 = 本月（未發布則最新月份），選定日 = 今天（不在該月則 1 號）
        月份、週、選定日都不進網址也不存 localStorage：重新整理後回到本月（月／週檢視例外，存在 noc.view）
        換成不同員工時重設為：本月、記住的檢視、今天
        月份下載失敗：頂端顯示錯誤，仍以已載入資料繪製
    end note
```

## 情境五：查看當日班表 /on-duty

```mermaid
stateDiagram-v2
    state "今天・目前值班<br/>值班中 N 人，時間未定義的另列折疊區<br/>每 30 秒、回到前景時刷新" as LiveNow
    state "今天・全部或指定班別<br/>出勤 / 休假人數" as LiveAll
    state "其他日期・全部或指定班別<br/>「目前值班」按鈕停用" as Other
    state "超出發布期間<br/>提示：此日期不在已發布資料期間" as Out

    [*] --> LiveNow: 預設今天＋目前值班
    LiveNow --> LiveAll: 點全部 / 某班別
    LiveAll --> LiveNow: 點目前值班
    LiveNow --> Other: 換日期（篩選自動改成全部）
    LiveAll --> Other: 換日期（保留篩選）
    Other --> LiveAll: 換回今天（日期選擇器或 ← →）
    Other --> LiveNow: 按「今天」
    LiveAll --> LiveNow: 按「今天」
    Other --> Out: 日期選擇器選到範圍外（← → 在範圍邊界停用）
    Out --> Other: 換回範圍內日期
    Out --> LiveNow: 按「今天」
    note right of Other
        日期與篩選不進網址
        今天本身不在發布範圍時，「今天」會落在「其他日期・全部」
        日期欄清空時：日期標籤空白，← → 停用
    end note
```

## 情境六：切換主題（三態圓形按鈕，圖示顯示目前選擇）

```mermaid
stateDiagram-v2
    state "跟隨系統<br/>即時跟著 prefers-color-scheme 切換<br/>localStorage 不存值" as System
    state "淺色（存 light）" as Light
    state "深色（存 dark）" as Dark

    [*] --> System: 沒存值
    [*] --> Light: 已存 light（含舊 key 遷移）
    [*] --> Dark: 已存 dark（含舊 key 遷移）
    System --> Light: 點主題按鈕
    Light --> Dark: 點主題按鈕
    Dark --> System: 點主題按鈕（清除存值）
    note right of System
        在 head 同步執行，首次繪製前就套用，不閃爍
        不支援 ?theme= 網址參數
    end note
```

## 情境七：連線與資料更新（標題旁狀態列，獨立於其他狀態）

```mermaid
stateDiagram-v2
    state "已連線，班表已同步" as Synced
    state "無法連線，目前顯示已儲存的班表" as Offline
    state "今日不在班表涵蓋期間" as OutRange
    state check <<choice>>

    [*] --> Synced
    [*] --> Offline: 資料來自 SW 快取
    [*] --> OutRange
    Synced --> Offline: offline 事件
    Offline --> check: online 事件 / 回到前景
    Synced --> check: 回到前景
    check --> [*]: 發現新版班表 → 整頁重新載入
    check --> Synced: 沒新版且連線正常
    check --> Offline: 仍拿到快取或失敗
```
