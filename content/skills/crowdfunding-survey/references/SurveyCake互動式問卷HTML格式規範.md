# SurveyCake 互動式問卷 HTML 格式規範

> 適用於 SurveyCake 路徑的問卷設計稿輸出。以全螢幕逐題滑動式 HTML 呈現，可直接在瀏覽器預覽互動效果，也可作為設計師與工程師的參考稿。

參考範例：`references/Breo_iNeck_Air2_前測問卷.html`

---

## 一、整體架構

### 頁面結構

```
<html>
├── <head>
│   ├── Google Fonts（Noto Sans TC）
│   └── <style>  ← 全部 CSS 內嵌，不拆檔
├── <body>
│   ├── .progress-bar        ← 固定頂部進度條
│   ├── .nav-dots            ← 固定右側導航圓點
│   ├── .key-hint            ← 固定底部鍵盤提示
│   ├── .survey-container    ← 所有 slide 的容器
│   │   ├── .slide[0] Opening
│   │   ├── .slide[1] Q1 痛點多選
│   │   ├── .slide[2] Q2 星級題
│   │   ├── ...
│   │   ├── .slide[N-1] 開放題
│   │   └── .slide[N] 感謝頁
│   └── <script>  ← 全部 JS 內嵌，不拆檔
</body>
```

**核心原則**：單一 HTML 檔案，CSS 和 JS 全部內嵌，不依賴外部檔案（除 Google Fonts CDN）。

### 互動機制

| 功能 | 實作方式 |
|------|---------|
| 頁面切換 | 全螢幕 slide，一次只顯示一題，淡入淡出 + translateY 動畫 |
| 進度條 | 固定頂部 4px 漸層色條，隨 slide 比例推進 |
| 導航圓點 | 固定右側，當前頁圓點拉長變色，可點擊跳轉 |
| 鍵盤操作 | Enter / ↓ 下一題，↑ 上一題 |
| 觸控滑動 | touchstart/touchend 偵測垂直滑動，>50px 觸發切換 |
| 底部提示 | 顯示「按 Enter 繼續 | 按 ↑↓ 切換」，最後一頁隱藏 |

---

## 二、設計系統（CSS Variables）

每份問卷的品牌色不同，統一用 CSS 變數管理，方便整份替換：

```css
:root {
  --brand: #5BC5C8;          /* 品牌主色 — 按鈕、進度條、星級選中 */
  --brand-dark: #3AA8AB;     /* 品牌深色 — hover、漸層 */
  --brand-light: #E8F8F8;    /* 品牌淺色 — 標籤底色、選中背景 */
  --dark: #1A1A2E;           /* 主文字色 */
  --mid: #4A4A5A;            /* 副文字色 */
  --light: #7A7A8A;          /* 輔助文字色 */
  --bg: #FAFBFC;             /* 頁面背景 */
  --card: #FFFFFF;           /* 卡片背景 */
  --accent-warm: #FF6B6B;    /* 限選提示色 */
  --accent-gold: #F5A623;    /* 強調色（選用） */
  --shadow: 0 4px 24px rgba(0,0,0,0.08);
  --radius: 16px;            /* 統一圓角 */
}
```

**每份新問卷只需替換 `--brand`、`--brand-dark`、`--brand-light` 三個色值**，其他保持不變。

### 字型

- 主字型：`'Noto Sans TC'`，從 Google Fonts 載入
- 權重：300（light）/ 400（regular）/ 500（medium）/ 700（bold）/ 900（black）

### 圓角與陰影

- 卡片圓角：`16px`（var(--radius)）
- 按鈕 / 選項圓角：`14px`
- 標籤圓角：`20px`（小標籤）/ `6px`（badge）

---

## 三、Slide 元件類型

每個 slide 的 HTML 結構固定為：

```html
<div class="slide" data-slide="N">
  <div class="slide-inner">
    <!-- 元件內容 -->
  </div>
</div>
```

`.slide-inner` 限寬 `max-width: 640px`，置中對齊。

---

### 元件 1：Opening（封面頁）

```
.opening-logo       品牌名（14px, letter-spacing: 4px, 品牌深色）
.opening-product    產品名（20px, 中灰色）
.opening-hero       主標語（36px, 黑色漸層, 最粗體）
.opening-desc       產品概述（16px, 行高 1.8, 限寬 480px）
.feature-grid       特色 6 宮格（3 欄 grid, 12px gap）
  └── .feature-chip   每格：icon emoji + 兩行文字
.incentive          好禮誘因區塊（深色漸層背景卡片）
  ├── .incentive-label   「即將登上 XX 募資」
  ├── .incentive-title   「2 分鐘填寫問卷，享 3 大好禮」
  └── .incentive-items   3 個好禮項目（圓點 + 文字）
.btn-primary        「開始填寫 →」按鈕
```

**Opening 文字量**：概述約 50-80 字，精簡版。

---

### 元件 2：星級題（Selling Point + Star Rating）

```
.q-number           題號標籤（「Q2 · 星級評分」）
.sp-card             賣點卡片（深色漸層背景）
  ├── .sp-badge       賣點標籤（「獨家 USP」「雙效合一」等）
  ├── .sp-headline    賣點主標（22px, 最粗體）
  ├── .sp-body        賣點說明（14px, 白色 80% 透明度）
  └── .sp-specs       規格數據（flex 橫排）
      └── .sp-spec      每個規格：.val（數字, 品牌色）+ .label（說明）
.q-title             評分提問（28px, 最粗體）
.star-container      7 顆星按鈕（56x56px 方形, 14px 圓角）
.star-scale-labels   量表兩端標籤（「1 = 完全無感」「7 = 非常想要」）
.btn-group           上一題 / 下一題按鈕組
```

**sp-card 規格數據**：通常放 3 個，每個有一個大字數值 + 一行小字標籤。

**星級按鈕行為**：點擊某數字，該數字及其之前的按鈕全部變為 selected 狀態（填滿品牌色）。

---

### 元件 3：多選題（Multi-Choice）

```
.q-number            題號標籤（「Q1 · 多選題」）
.q-title             題目（28px）
.q-subtitle          副標（16px, 灰色）
.choice-limit        限選提示（「最多選 3 項」，紅色）
.choice-grid         選項列表（垂直 grid, 12px gap）
  └── .choice-item     每個選項（白底卡片, 2px 邊框, 14px 圓角）
      ├── .choice-check  打勾框（24x24px, 8px 圓角）
      └── .choice-text
          ├── .main      主文字（15px, 粗體）
          └── .sub       副文字（13px, 灰色）
.btn-group           上一題 / 下一題按鈕組
```

**選項行為**：
- 點擊選中，打勾框變品牌色 + 白色勾
- 背景變品牌淺色
- 超過限選數量時，自動取消最早選中的項目

---

### 元件 4：購買意願星級題（Price Card + Star Rating）

```
.q-number            題號標籤
.price-card          價格卡片（品牌色漸層背景）
  ├── .price-badge     「嘖嘖募資 早鳥方案」
  ├── .price-original  原價（刪除線）
  ├── .price-now       早鳥價（42px 超大字, 含 .currency 前綴）
  ├── .price-save      省多少（「現省 NT$ X,XXX（約 X 折）」）
  └── .price-perks     加碼優惠列表
      └── .price-perk    每項：圓點圖標 + 說明文字
.q-title             評分提問
.star-container      7 顆星（同一般星級題）
.star-scale-labels   「1 = 完全不想買」「7 = 非常想買」
.btn-group
```

**price-card 設計**：右上角有裝飾性半透明圓圈（CSS `::before`），增加層次感。

---

### 元件 5：輸入題（Email / 手機 / 開放題）

```
.q-number            題號標籤（「Q8 · 聯絡資訊」「Q10 · 自由回答」）
.q-title             題目
.q-subtitle          說明
.input-field         輸入框（限寬 440px, 14px 圓角, 2px 邊框）
  - type="email"     Email 輸入
  - type="tel"       手機輸入
  - <textarea>       開放題（min-height: 120px）
.input-hint          底部提示（13px, 灰色，如「僅限本次活動使用」）
.btn-group
```

**輸入框行為**：focus 時邊框變品牌色。Email/手機輸入框支援 Enter 鍵直接跳下一題。

---

### 元件 6：感謝頁（Thank You）

```
.thankyou-icon       大圓圈圖標（80x80px, 品牌色漸層, emoji 🎉）
.q-title             「感謝你的填寫！」
.q-subtitle          感謝文字 + LINE 引導
.line-btn            LINE 官方帳號按鈕（綠色 #06C755）
.btn-secondary       「重新填寫」按鈕
```

---

## 四、按鈕系統

| 類型 | class | 用途 | 樣式 |
|------|-------|------|------|
| 主按鈕 | `.btn-primary` | 下一題、開始填寫 | 品牌色底, 白字, 16px 圓角, 含箭頭 |
| 次按鈕 | `.btn-secondary` | 上一題、重新填寫 | 透明底, 灰字, 無邊框 |
| LINE 按鈕 | `.line-btn` | 跳轉 LINE | 綠色 #06C755, 同主按鈕造型 |

**按鈕組** `.btn-group`：flex 置中，gap 12px，上一題在左、下一題在右。

**最後一題**（開放題）的按鈕文字改為「送出問卷 ✓」而非「下一題」。

---

## 五、JavaScript 互動邏輯

### 必備功能

```javascript
// 狀態管理
let currentSlide = 0;
const totalSlides = N;   // 含 Opening + 所有題目 + 感謝頁
const answers = {};       // 收集所有答案

// 導航
goToSlide(index)   // 切換至指定 slide（含動畫）
nextSlide()        // 下一頁
prevSlide()        // 上一頁

// 進度
updateProgress()   // 更新頂部進度條寬度

// 導航圓點
buildNavDots()     // 初始化右側圓點
updateNavDots()    // 更新圓點 active 狀態

// 星級題
selectStar(qId, val)   // 選中星級（1-7），低於 val 的全部填滿

// 多選題
toggleChoice(el)       // 切換選項，超過限選數時自動踢掉最早的

// 送出
submitSurvey()    // 收集所有答案 → console.log → 跳轉感謝頁
resetSurvey()     // 清除所有狀態回到第一頁
```

### 鍵盤與觸控

```javascript
// 鍵盤
Enter / ArrowDown → nextSlide()（textarea 內 Enter 不觸發）
ArrowUp → prevSlide()

// 觸控滑動
touchstart → 記錄起始 Y
touchend → 差值 > 50px → 上滑下一頁 / 下滑上一頁
```

---

## 六、Slide 動畫

```css
.slide {
  opacity: 0;
  transform: translateY(40px);    /* 預設在下方隱藏 */
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
.slide.active {
  opacity: 1;
  transform: translateY(0);       /* 當前頁顯示 */
  pointer-events: auto;
}
.slide.exit-up {
  opacity: 0;
  transform: translateY(-40px);   /* 離開時往上滑出 */
}
```

切換邏輯：當前頁加 `exit-up` → 600ms 後移除 → 新頁加 `active`。

---

## 七、RWD 響應式

```css
@media (max-width: 640px) {
  .opening-hero { font-size: 28px; }      /* 標題縮小 */
  .q-title { font-size: 22px; }
  .feature-grid { grid-template-columns: repeat(2, 1fr); }  /* 6宮格→2欄 */
  .star-btn { width: 44px; height: 44px; }  /* 星級按鈕縮小 */
  .sp-card { padding: 24px 20px; }
  .price-now { font-size: 34px; }
  .slide { padding: 50px 16px 30px; }
}
```

---

## 八、產出流程

撰寫 HTML 問卷時，依照以下順序：

1. **複製設計系統**：CSS Variables、字型、基礎元件樣式（從範例模板複製）
2. **替換品牌色**：修改 `--brand`、`--brand-dark`、`--brand-light` 三個色值
3. **建立 Opening slide**：填入品牌名、產品名、主標語、概述、6 宮格特色
4. **逐題建立 slide**：按問卷架構依序建立各題的 HTML
5. **建立感謝頁 slide**
6. **調整 JS 參數**：修改 `totalSlides` 數值
7. **全螢幕預覽**：在瀏覽器中逐題點擊確認體驗流暢

---

*最後更新：2026.05*
