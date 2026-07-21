---
name: competitor-analysis
description: |
  競品分析工具：自動搜尋募資平台上的競品專案，分析並產生 HTML 報告。

  觸發條件（WHEN to use）：
  - 使用者提到「競品分析」、「競爭對手分析」、「市場調查」
  - 使用者想了解某產品類別在募資平台上的競品
  - 使用者提到「嘖嘖」、「Kickstarter」、「Indiegogo」並想分析產品
  - 使用者說「幫我分析 XX 平台上的 YY 產品」

  支援平台：嘖嘖 (zeczec)、Kickstarter、Indiegogo
---

# 競品分析 Skill

## 流程總覽

```
輸入 → 確認需求（含品類關鍵字）→ 選擇資料收集方式 → 執行分析 → 產生 HTML 報告
```

## Step 1: 確認需求

使用 AskUserQuestion 詢問（**最多同時問 3 題**）：

1. **分析數量**：3 / 5 / 10 個專案

2. **品類關鍵字確認**（最重要，直接影響搜尋完整度）：
   - 根據使用者的輸入，**自行推測 2–4 個可能的中文品類搜尋詞**
   - 把推測的關鍵字組合**列出來讓使用者確認或補充**，而不是自己默默決定
   - 範例提問方式：「我打算搜尋以下關鍵字：行動電站、戶外電源、儲能。這樣涵蓋範圍正確嗎？有需要補充或刪除的嗎？」
   - 背景：嘖嘖搜尋是模糊比對標題，同一品類在不同上架者手中往往用完全不同的詞（如「行動電站」vs「戶外電源」vs「儲能電站」），用錯關鍵字可能遺漏最大的競品。先確認比事後補搜省多了。

3. **使用者產品定位**（選填）：使用者自家產品的主要特色或定位，用於後續比較分析角度

> ⚠️ **不要問報告格式**：預設輸出為 HTML，除非使用者在對話中明確說「要 Word」「要 DOCX」才額外製作，否則不主動詢問。

## Step 2: 資料收集

根據平台選擇收集方式：

| 平台 | 方式 | 工具 |
|------|------|------|
| 嘖嘖 | 瀏覽器自動化 | Claude in Chrome |
| Kickstarter | 網路搜尋 | WebSearch（彙整新聞/評測） |
| Indiegogo | 網路搜尋 | WebSearch（彙整新聞/評測） |

### 方式 A：瀏覽器自動化（嘖嘖）

> ⚠️ **嘖嘖有幾個容易踩的陷阱，詳見 `references/platforms.md` 完整說明。**
> 以下是精簡版，務必遵守。

**四個常見錯誤：**
- URL 參數（`?q=關鍵字`）完全無效，嘖嘖是 SPA，必須透過 UI 觸發搜尋
- `form_input` 後直接 Enter 有時不觸發——需先 `triple_click` 搜尋框再 Enter，並用 `get_page_text` 確認結果已更新
- 平台不支援「關鍵字搜尋 + 金額排序」同時成立，不要依賴平台排序，在本地手動排
- 猜 slug 批次驗證對「平台上根本不存在的品類」無效，先搜尋確認品類存在再繼續

**正確流程：**
```
1. navigate → https://www.zeczec.com/search      ← 必須是 /search，不是 /categories
2. find → 取得搜尋框 ref（每次不同，不可硬編碼）
3. form_input(ref, value="關鍵字")
4. triple_click 搜尋框 → key: Return
5. get_page_text → 確認結果已更新（若未更新，重複步驟 4）
6. 從分頁按鈕取得分頁 URL 格式，後續直接 navigate 跳頁：
   /search?form_search%5Bkeyword%5D={keyword}&page=N
7. 用 Step 1 確認過的關鍵字組合逐一搜尋，避免遺漏
8. javascript_tool 批次取得所有專案 slug（比 read_page 快）：
   Array.from(document.querySelectorAll('a[href*="/projects/"]'))
     .map(a => ({title: a.innerText.trim().substring(0,60), href: a.href}))
9. 跨關鍵字去重，在本地按金額手動排序，選出目標競品
10. navigate 進 /projects/{slug}，用 javascript_tool 精準抽取專案資料
    （詳見 references/platforms.md「專案頁面資料抽取」段落）
```

### 方式 B：網路搜尋（Kickstarter/Indiegogo）

```
搜尋查詢：
1. "{平台} {產品類別} crowdfunding 2025 2026"
2. "{專案名稱} specs features review"
3. "{專案名稱} {平台} raised backers"
```

## Step 3: 分析框架

每個專案必須分析（見 `references/analysis-framework.md`）：

- **基本資訊**：專案名稱、募資金額、贊助人次、價格
- **規格數據**：產品關鍵規格
- **USP 獨特賣點**：競品沒有、只有他有的
- **KSP 重點賣點**：主打的核心功能
- **解決的痛點**：消費者困擾 → 解決方案
- **目標受眾**：賣給誰
- **⭐ 最推薦使用情境**：什麼情況最能凸顯產品價值
- **視覺風格**：產品氛圍、設計風格關鍵字

## Step 4: 產生報告

**預設只輸出 HTML**，不主動詢問是否需要其他格式。
只有在使用者明確說「要 Word」「要 DOCX」「要 PPT」時才額外製作。

輸出路徑：`/mnt/outputs/競品分析_{產品類別}_{日期}.html`

報告結構（見 `assets/report-template.html`）：
1. 市場趨勢摘要
2. 各專案分析卡片
3. 快速比較表
4. 功能矩陣
5. 競品洞察與建議

## Resources

- `references/analysis-framework.md` — 分析框架詳細說明
- `references/platforms.md` — 各平台資料收集細節（含專案頁面 JS 抽取模板）
- `assets/report-template.html` — HTML 報告模板
