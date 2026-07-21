---
name: 貼文 docx 輸出格式偏好
description: jerry 要求貼文輸出 docx 時，不同主題用分頁隔開，空行用 ZWSP (U+200B) 撐出來
type: feedback
---

貼文批量輸出為 docx 時：
1. 不同主題/切角的貼文之間用「分頁符（PageBreak）」隔開，每篇一頁
2. 貼文內的空行用零寬度空格 `U+200B`（ZWSP）撐出來，確保複製到 FB/IG 時空行正常顯示

**Why:** 方便直接從 docx 複製貼上到社群平台，空行不會被吃掉。

**How to apply:** 每次產出貼文 docx 時都套用此格式。
