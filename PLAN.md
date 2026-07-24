# 嘖嘖線上文案系統 — Plan
> 把原系統文案交接包重現為嘖嘖（zeczec）內容中心版：帳號資源全換、認證改共用雲端硬碟路線、平台字眼全面反轉、模型升級
> 狀態：in-progress
> 最後更新：2026-07-24

## 為什麼做
Jerry（原開發者，jerry@ontoo.cc → jerry@zeczec.com）從原系統換到嘖嘖，手上有一包完整交接檔（`~/Downloads/【銜接資料夾】/線上文案系統 - 開發交接包/`：程式碼＋12 Skills＋8 Memory＋兩份手冊）。目標是在嘖嘖重建同等系統給內容中心團隊用——非工程師在瀏覽器裡「選產品 → AI 依方法論串流產文案 → 一鍵存 Google 雲端」。原架構依賴的雲端資源（Cloudflare 專案、ontoo.cc Workspace、flyingfive 帳號、金鑰）全不可沿用，且 Jerry 無 zeczec Workspace 管理員權限，原「Service Account 全網域委派冒充」路線不可行，改走共用雲端硬碟。

## 改什麼／範圍
- 新專案 `~/zeczec-copywriting`：以交接包 `01_系統程式碼/` 為底，git 版控（GitHub 私有庫 TzuYu-zeczec）
- **Google 認證改造**（本次唯一架構級改動）：拿掉 impersonation，SA 直接當共用雲端硬碟成員 → `functions/_shared/google-auth.js`（移除 `sub`）、`drive.js`（全部請求加 `supportsAllDrives=true`、列表加 `includeItemsFromAllDrives=true`）、`sheets.js`（`createNewSpreadsheet` 改走 Drive API `files.create` 建表，再用 Sheets API 填資料與格式）
- **平台反轉**：system prompt 禁令反轉（`generate.js`、`generate-survey.js`：僅適用嘖嘖，不得提及其他任何募資平台）、`platform` 預設值 zeczec（`sheets.js`）、品牌三色（`css/style.css` :root：主 `#3f3f3f`／綠 `#069668`／藍 `#3366a9`）、系統名「嘖嘖線上文案系統」、`ADMIN_EMAILS = ['jerry@zeczec.com']`（`app.js`＋`usage.js`＋`history.js`＋`history/[id].js` 四檔同改）、寫死的輸出資料夾連結換新（`app.js` renderSidebar＋`task-runner.js` 兩處）
- **模型升級**：`claude-sonnet-4-20250514` → `claude-sonnet-5`（`generate.js`、`generate-survey.js`、`extract-product.js`、`merge-product.js`、`create-sheet.js` 共 5 檔），`usage.js` 計價常數照官方價目核實更新（實作時查 claude-api 參考）
- **內容資產**：12 Skills＋8 Memory 平台字眼機械反轉（方法論不動），產出「嘖嘖規格缺口清單」，上傳共用雲端硬碟
- **Typeform 暫緩**：程式碼保留，`survey.html` 隱藏「自動建立 Typeform」按鈕、不設 token
- 部署：Cloudflare Pages 專案 `zeczec-copywriting`（既有帳號）＋ Access 限 @zeczec.com
- **受眾矩陣整條線移除**（Task 8 後追加，決策 #9）：刪 `public/matrix.html`、`functions/api/create-sheet.js`、`sheets.js` 的 `createNewSpreadsheet`；`app.js` 拿掉 NAV_ITEMS／SKILL_NAMES 對應項與 `API.createSheet`；`task-runner.js` 拿掉 `SAVE_SHEETS` 分支；`generate.html` 拿掉 sheets 按鈕與 `saveToSheets()`
- 不做：未來擴充清單全不納 v1（貼網址匯入、KV 快取、市調功能）；不建任何會回傳環境變數的 debug 端點；受眾矩陣功能（使用者決定不需要）
- **UI 全面翻新**（Task 9 後追加，決策 #10）：依使用者提供的設計交接（`~/Downloads/output/交接規格.md`＋`style.css`，設計語言「文稿工作室」）整套套用 —
  - `public/css/style.css` 全面改版：暖白紙感底、嘖嘖綠 `#069668` 升為主行動色、Noto Sans TC + DM Mono；舊 token/utility class（`--gray-*`／`--primary`／`.hidden`／`.flex`／modal／table／conversation 等）全部保留別名相容，零功能改動
  - 側欄改分組導覽（策略／檔期產出／記錄）＋手機版改頂列漢堡選單；`app.js` 的 `renderSidebar`/`setupMobileNav` 重寫
  - `index.html` 產品列表改卡片格線（`product-grid`）；`product.html` 加左側錨點導覽＋捲動高亮；`survey.html` 加階段圓形序號；`task-runner.js` 產出頁引擎（7 頁共用）改新版面
  - 檔名反映功能語意：`launch.html`→`presale.html`、`batch.html`→`social.html`、`page.html`→`campaign.html`（`git mv`，`app.js` NAV_ITEMS 同步更新；因尚未 Task 8 首次部署，改名零風險）
  - 各頁 `<head>` 加 Google Fonts 連結
  - 範圍不含：`generate.html`（未串接進 NAV_ITEMS 的舊版遺留檔，非本次翻新對象，留給使用者日後決定是否清掉）

## 任務
- [x] 1. 前置檢查與雲端容器：確認 jerry@zeczec.com 能自建共用雲端硬碟 → 建「嘖嘖線上文案系統」共用雲端硬碟＋skills／memory／線上文案生成區三資料夾＋資料庫 Sheet（Products A:AI 35 欄、Generations A:M 13 欄，欄位照交接手冊 5.1，第 1 列標題）【需使用者操作 Drive；若不能建共用雲端硬碟 → escape hatch 停下回報】
- [x] 2. GCP：建專案＋啟用 Drive/Sheets API＋建 Service Account＋下載 JSON key＋把 SA email 加為共用雲端硬碟「內容管理員」成員【需使用者操作 GCP Console，我出逐步指引】
- [x] 3. 專案骨架：複製交接包 `01_系統程式碼/` → `~/zeczec-copywriting`（排除交接工作日誌）、改 `wrangler.toml`（專案名 zeczec-copywriting、新 Sheet/資料夾 ID、刪 `GOOGLE_DRIVE_OWNER_EMAIL`）、`git init`＋首 commit＋推 GitHub 私有庫
- [x] 4. Google 認證改造：`google-auth.js` 移除 impersonation、`drive.js` 全請求加 supportsAllDrives、`sheets.js` 的 `createNewSpreadsheet` 改 Drive API 建表；`node --check` 全過
- [x] 5. 平台與品牌反轉：system prompt 禁令、platform 預設、CSS 三色、系統名、ADMIN_EMAILS 四檔、資料夾連結兩處、survey.html 隱藏 Typeform 按鈕
- [x] 6. 模型升級：5 檔 MODEL 常數 → `claude-sonnet-5`；usage.js 計價常數與匯率核實更新
- [x] 7. Skills×12＋Memory×8 機械反轉（原系統→嘖嘖、平台限定記憶檔反轉並改名），產出 `嘖嘖規格缺口清單.md`；反轉版存 repo `content/` 留檔＋上傳共用雲端硬碟對應資料夾（資料夾名稱保留原 skill 名；使用者決定不上傳 competitor-analysis／consolidate-memory 兩份，實際上傳 10 skills＋8 memory）【上傳需使用者拖檔或授權】
- [ ] 8. 首次部署：`npx wrangler pages deploy ./public --project-name zeczec-copywriting --branch production`＋Dashboard 設 Secrets（`ANTHROPIC_API_KEY`【外部依賴：找公司要】、`GOOGLE_SERVICE_ACCOUNT_JSON`）
- [x] 9. Cloudflare Access：GCP 建 OAuth 用戶端（redirect URI 填 team domain callback）→ Zero Trust 加 Google IdP → Add Application（⚠ Subdomain 留空、Domain 選 zeczec-copywriting.pages.dev、Path 留空）→ Policy：Emails ending in @zeczec.com【需使用者操作 Dashboard】
- [ ] 10. 端到端驗證（見驗收條件）＋把「嘖嘖規格缺口清單」交給使用者收尾

## 驗收條件
- 情境（task 1）：Drive 裡看得到共用雲端硬碟與三資料夾；Sheet 兩分頁標題列與交接手冊 5.1/5.2 欄位一致
- 情境（task 4）：部署後呼叫 `/api/save-to-drive` 存一份測試 Doc，檔案出現在共用雲端硬碟的輸出資料夾（而非任何人的個人 Drive）；`/api/products` 能讀寫資料庫 Sheet
- 情境（task 5）：全站主視覺為 #3f3f3f/#069668 色系、側欄顯示「嘖嘖線上文案系統」；產出頁 system prompt 產出的文案不出現原系統平台字眼；問卷頁看不到 Typeform 自動建立按鈕
- 情境（task 7）：共用雲端硬碟 skills 資料夾有 10 個子資料夾（刻意不建 competitor-analysis／consolidate-memory，前者無專屬頁面、後者與文案系統無關）、memory 有 8 份 .md；抽查任一 SKILL.md 無原系統平台字眼；缺口清單列出所有待補的嘖嘖特定規格
- 情境（task 9）：無痕視窗開站先跳 Google 登入；@zeczec.com 可進、其他網域被拒；登入後產出紀錄的 generated_by 有值
- 情境（task 10，端到端）：①新增產品（手動＋檔案匯入各一）②產品定位策略頁串流產出並存 Doc ③受眾矩陣建出 2 分頁彩色 Sheets（約 3 分鐘屬正常）④問卷系統 copy/html 兩階段跑通 ⑤產出紀錄分流（一般帳號只見自己）⑥管理頁顯示用量與新計價

## 決策紀錄
| # | 決策點 | 選了 | 理由 |
|---|---|---|---|
| 1 | 服務對象 | 嘖嘖內容中心團隊（多人） | 工具價值就是非工程師可用；分流/管理功能現成，砍掉反而是工 |
| 2 | Google 認證路線 | 共用雲端硬碟＋SA 直接成員 | Jerry 無 Workspace 管理員權限，DWD 開不了；此路不求人、檔案歸公司組織所有，對團隊資產最乾淨；代價是 drive/sheets 模組中等改動 |
| 3 | 檔案 owner | 共用雲端硬碟（組織所有） | 取代原「冒充 flyingfive」模式；不佔個人配額、人員異動不搬家 |
| 4 | Typeform | 暫緩（碼留、token 不設、按鈕藏） | 嘖嘖是否用 Typeform 未定；問卷文案＋配圖不需 token，零成本延後 |
| 5 | Skills 改編深度 | 機械反轉＋缺口清單，Drive 上迭代 | 方法論平台無關；基建與內容迭代解耦正是原架構甜頭；嘖嘖特定規格（頁面圖寬、渠道規範）只有使用者能補 |
| 6 | 模型 | 升級 claude-sonnet-5 | 同級定位、能力更好，文案品質白拿的提升；計價常數同步核實 |
| 7 | 功能範圍 | 原樣復刻，擴充清單不納 v1 | 降低重建風險；市調已驗證本地跑較划算 |
| 9 | 受眾矩陣（persona-matrix） | Task 8 後決定整條線移除（非僅不上傳 skill） | 使用者明確表示這個系統之後都不需要；移除 `matrix.html`＋側欄項＋`/api/create-sheet`＋`createNewSpreadsheet`＋task-runner 的 SAVE_SHEETS 分支＋generate.html 的 sheets 按鈕，避免留下指向不存在 skill 的死連結；全部在 git 版控下、可回溯 |
| 8 | 版控 | 第一天 git init＋GitHub 私有庫 | 原專案無版控是交接文件明載的遺憾 |
| 10 | UI 翻新落地方式 | 舊 CSS 變數/utility class 全保留別名，不逐一改寫既有 JS 產生的 markup | 既有功能（智慧合併比對、批次匯入、串流續寫等）邏輯複雜，重寫風險高於效益；別名讓新色票/字體零成本套用到所有既有畫面，只在設計交接明確給範例的頁面（側欄、產品列表、產品表單、產出頁引擎、問卷頁）才動 markup 結構 |

## 架構
```
[T·CF] Cloudflare Pages「zeczec-copywriting」＋ Access(Google IdP，限 @zeczec.com)
 ├ [C] public/ 靜態前端(無框架)：index/product＋7 產出頁＋survey/history/admin
 │   ├ [C] js/app.js — API 模組/SSE 解析/側欄(NAV_ITEMS)/ADMIN_EMAILS/品牌名
 │   └ [C] js/task-runner.js — 產出頁共用引擎(TASK_CONFIG 驅動、自動續寫≤5、停止產生)
 ├ [L·Sonnet5] functions/api/ AI 端點×5 — generate(SSE 32k)/generate-survey(分階段)/
 │             extract-product(多模態誠實留白)/merge-product(逐條合併)/create-sheet(串流防524)
 │             ↔ 429 重試＋friendlyAnthropicError 繁中化
 ├ [T·Google] _shared/google-auth.js — SA JWT(Web Crypto 簽章、無 sub、token 快取)
 │   ├ [T·Google] drive.js — Skills/Memory 讀取、建 Doc、uploadRawFile(全帶 supportsAllDrives)
 │   └ [T·Google] sheets.js — 產品/紀錄 CRUD(明確列 PUT 防寫歪)、建表改 Drive API
 ├ [D] 共用雲端硬碟「嘖嘖線上文案系統」— skills×12(反轉版)/memory×8/輸出資料夾
 │     ＋ 資料庫 Sheet(Products 35 欄/Generations 13 欄)　※改 Skills 即生效、免部署
 └ [T·API] Typeform(暫緩：碼留、token 不設)
控制流：前端 → Pages Functions → (讀 Sheet 產品＋Drive Skill/Memory 組 system prompt)
        → Anthropic SSE → 前端逐字渲染 → 完成寫 Generations → 存 Doc/Sheets 回共用雲端硬碟
```

## 失敗的嘗試
（無）
