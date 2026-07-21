# 平台資料收集指南

## 嘖嘖 (zeczec.com)

### 收集方式：瀏覽器自動化

**前置條件**：Chrome 瀏覽器已連線

---

### ⚠️ 已知陷阱（必讀，否則必踩）

#### 陷阱 1：URL 參數完全無效
嘖嘖是 SPA（單頁應用），URL query string 不觸發搜尋。

```
❌ 無效（永遠返回全品類列表，不管參數寫什麼）：
   https://www.zeczec.com/categories?q=投影機
   https://www.zeczec.com/search?q=投影機&scope=raised&order=amount

✅ 正確起點（先導航到這裡，再用 UI 觸發）：
   https://www.zeczec.com/search
```

#### 陷阱 2：`form_input` 設值後搜尋不一定觸發
`form_input` 只是填入欄位值，不會觸發 SPA 的搜尋事件。

```
❌ 容易失敗：
   form_input(value="關鍵字") → key: Return
   （Return 有時打在錯誤元素上，結果沒有更新）

✅ 正確做法：
   1. form_input(ref, value="關鍵字")    ← 填值
   2. triple_click 搜尋框                ← 確保 focus 在搜尋框上
   3. key: Return                        ← 觸發搜尋
   4. get_page_text 確認結果已變更       ← 看產品名稱是否換成搜尋結果
   5. 若結果未變，重複步驟 2-3
```

#### 陷阱 3：關鍵字搜尋與金額排序無法同時成立
平台不支援「關鍵字篩選」同時「按金額排序」——切換排序後關鍵字可能被清除，或排序只作用在全品類。

```
❌ 不可靠：
   搜尋關鍵字 → 點擊「專案金額」排序
   （排序結果可能是全品類，非篩選後的結果）

✅ 正確策略：
   完全不依賴平台排序。搜尋後收集全部頁數的結果，
   在自己的分析清單中手動按金額排序。
```

#### 陷阱 4：分頁 URL 格式需先觸發一次搜尋才能使用
首次搜尋必須透過 UI。但成功觸發搜尋後，分頁按鈕的 `href` 會揭露一個可直接跳頁的 URL 格式：

```
✅ 成功觸發一次搜尋後，後續頁數可直接 navigate：
   /search?form_search%5Bkeyword%5D={encoded_keyword}&page=2
   /search?form_search%5Bkeyword%5D={encoded_keyword}&page=3

   範例（關鍵字「投影機」）：
   https://www.zeczec.com/search?form_search%5Bkeyword%5D=%E6%8A%95%E5%BD%B1%E6%A9%9F&page=2
```

取得這個格式：搜尋成功後用 `javascript_tool` 撈分頁連結：
```js
document.querySelector('a[href*="page=2"]')?.href
```

#### 陷阱 5：猜 slug 批次驗證對「不存在的品類」無效
若猜測 `wine-cabinet`、`wine-cooler` 等 slug 並批次 fetch，對於平台上根本沒有上架的品類，永遠只會得到 404。這不是搜尋方法的問題，是品類本身不存在。

```
✅ 正確做法：
   先用 UI 搜尋多個關鍵字，用 get_page_text 確認結果內容。
   若所有相關關鍵字搜尋結果均為空或完全無關，
   立即回報用戶「此品類在平台上不存在」，討論是否擴大範圍或換平台。
   不要浪費時間猜 slug。
```

---

### 正確執行流程

```
Step 1: 初始化
  tabs_context_mcp → 確認已有可用 Tab（若無則 tabs_create_mcp）
  navigate → https://www.zeczec.com/search

Step 2: 觸發第一次搜尋（最容易出錯）
  find → 搜尋框（ref_id 每次不同，必須用 find 取得，不可硬編碼）
  form_input(ref, value="{主要關鍵字}")
  triple_click 搜尋框座標
  key: Return
  get_page_text → 確認結果已更新（看顯示的專案名稱是否改變）
  ↳ 若結果未變：重複 triple_click + Return

Step 3: 取得分頁 URL 格式
  javascript_tool → document.querySelector('a[href*="page="]')?.href
  記下格式，後續各頁直接 navigate，不再需要操作 UI

Step 4: 多關鍵字搜尋（見下方策略說明）
  針對同一品類搜尋 2-4 個相關關鍵字
  每個關鍵字都走完所有分頁，收集所有專案連結

Step 5: 批次取得專案 slug（用 JS，比 read_page 快且乾淨）
  javascript_tool:
    Array.from(document.querySelectorAll('a[href*="/projects/"]'))
      .map(a => ({title: a.innerText.trim().substring(0, 60), href: a.href}))
  跨關鍵字去重（相同 href 只保留一筆），在本地按金額排序

Step 6: 逐一進入專案頁面取得詳情（用 JS 精準抽取，不用 get_page_text）
  navigate → https://www.zeczec.com/projects/{slug}
  javascript_tool → 執行下方「專案頁面標準抽取模板」
  截圖只用於確認視覺版面（如需確認設計風格）
```

---

### 專案頁面資料抽取（標準 JS 模板）

嘖嘖專案頁面包含大量無用內容（留言、更新日誌、側邊欄、頁腳）。
用 `javascript_tool` 精準抽取，只取需要的欄位，避免讀入數千字的雜訊。

```js
// 貼入 javascript_tool 執行，取回 JSON 字串
(() => {
  const text = s => s?.innerText?.trim() || '';
  const attr = (s, a) => document.querySelector(s)?.getAttribute(a) || '';

  // 金額與人數：通常在 .project-stats 或 [class*="amount"] 附近
  const statsEls = document.querySelectorAll('[class*="stat"], [class*="amount"], [class*="backer"]');
  const statsText = Array.from(statsEls).map(e => text(e)).filter(Boolean).join(' | ');

  // 主要介紹區：嘖嘖通常用 .project-content 或 article，排除留言/更新區
  const contentEl =
    document.querySelector('.project-content') ||
    document.querySelector('article.content') ||
    document.querySelector('main article') ||
    document.querySelector('#project-description');

  // 若找不到精準 selector，fallback 取 <main> 前 4000 字
  const rawContent = contentEl
    ? text(contentEl).substring(0, 5000)
    : text(document.querySelector('main')).substring(0, 4000);

  return JSON.stringify({
    title:   text(document.querySelector('h1')),
    stats:   statsText,          // 金額、人數、達標率（混在一起，後續從字串解析）
    url:     location.href,
    content: rawContent,         // 產品介紹主文（截斷至 5000 字）
  }, null, 2);
})()
```

**使用說明：**
- `title`：專案標題（含品牌名、產品名）
- `stats`：包含募資金額、達標率、贊助人數——從字串中用正則或關鍵字解析數字
- `content`：主要產品介紹文，用於提取規格、USP、賣點

**若 JS 抽取失敗（空白或錯誤）：**
- Fallback 使用 `get_page_text`，取回後截取前 5000 字即可，不需要全文
- 留言區通常在頁面下半部，全文讀取時注意不要把留言內容誤認為產品資料

---

### 多關鍵字策略（為什麼需要）

嘖嘖搜尋是模糊比對標題文字，同一品類常有多種叫法。用單一關鍵字搜尋會遺漏相關競品。

| 品類 | 建議搜尋的關鍵字組合 |
|------|---------------------|
| 投影機 | 投影機、行動投影、迷你投影、家用投影 |
| 葡萄酒相關 | 葡萄酒、醒酒、紅酒、酒杯 |
| 咖啡器具 | 咖啡、手沖、濾杯、義式 |
| 充電設備 | 充電、行動電源、快充、無線充電 |
| 空氣清淨 | 空氣清淨、清淨機、PM2.5、濾網 |

每個關鍵字搜完後收集 slug 清單，去重合併，在報告中手動按金額排序。

### 可提取資訊
- 募資金額（累計與原始活動）、達標百分比
- 贊助人數（含不重複人數）
- 方案內容與優惠價格、原價
- 完整產品介紹文、核心技術說明
- 品牌背景、獲獎資訊、活動起訖日期

---

## Kickstarter

### 收集方式：網路搜尋

**原因**：Kickstarter 網頁直接抓取會被擋（403）

**搜尋策略**：

```
查詢 1：專案列表
"Kickstarter {產品類別} crowdfunding 2025 2026"
"Kickstarter {產品類別} funded successful"

查詢 2：專案詳情
"{專案名稱} Kickstarter specs specifications"
"{專案名稱} Kickstarter review hands-on"
"{專案名稱} raised backers campaign"

查詢 3：補充資訊
"{專案名稱} vs {競品名稱}"
"{品牌名稱} {產品名稱} features"
```

### 常見資訊來源
- 官方新聞稿 (PRNewswire, BusinessWire)
- 科技媒體評測 (The Verge, TechCrunch, Engadget)
- YouTube 開箱影片
- Reddit 討論

---

## Indiegogo

### 收集方式：網路搜尋

**搜尋策略**：與 Kickstarter 相同

```
"Indiegogo {產品類別} crowdfunding"
"{專案名稱} Indiegogo campaign"
"{專案名稱} early bird price specs"
```

### 特別注意
- Indiegogo 有「InDemand」模式（持續銷售），金額可能持續增加
- 部分專案同時在 Kickstarter 和 Indiegogo 上架

---

## 備援方案

當瀏覽器無法連線時，所有平台都改用網路搜尋：

```
WebSearch 查詢：
"site:zeczec.com {產品類別}"
"{嘖嘖專案名稱} 募資 規格 評價"
```
