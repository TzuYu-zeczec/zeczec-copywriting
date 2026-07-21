/**
 * /api/create-typeform — 將 AI 產出的問卷文案自動建立為 Typeform 問卷
 *
 * 流程：
 * 1. 收到 AI 產出的問卷文字內容
 * 2. 用 AI 呼叫將文字解析為 Typeform 問題結構 JSON
 * 3. 呼叫 Typeform API 建立問卷
 * 4. 回傳問卷連結
 */
import { createTypeform } from '../_shared/typeform.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export async function onRequestPost({ request, env }) {
  try {
    const { content, productName } = await request.json();

    if (!content) {
      return Response.json({ error: '沒有問卷內容' }, { status: 400 });
    }

    if (!env.TYPEFORM_API_TOKEN) {
      return Response.json({ error: '未設定 Typeform API Token，請在 Cloudflare Dashboard 加入 TYPEFORM_API_TOKEN' }, { status: 500 });
    }

    // 1. Parse questionnaire content into Typeform structure
    const formData = await parseQuestionnaireToJSON(env, content, productName);

    // 2. Create Typeform
    const result = await createTypeform(env, formData);

    return Response.json({
      formUrl: result.formUrl,
      editUrl: result.editUrl,
      formId: result.formId,
      title: formData.title,
      fieldCount: formData.fields.length,
      needsMultiple: result.needsMultiple || []
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

/**
 * 用 AI 將問卷文案轉為 Typeform JSON 結構
 */
async function parseQuestionnaireToJSON(env, content, productName) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8192,
      system: `你是一個問卷結構解析器，專門把募資前測問卷文案轉換為 Typeform API 的 JSON 格式。
只回傳 JSON，不要有任何其他文字或 markdown 標記。

支援的題目類型（type 欄位）：
- "statement"：圖片卡片／特色說明頁（非問題）。每張特色圖、封面圖都用 statement，並把「銜接按鈕文字」放進 button_text
- "multiple_choice"：選擇題（多選設 multiple: true，單選 multiple: false）
- "opinion_scale"：星級／購買意願量表（募資問卷固定用 steps: 7，含左右標籤）
- "email"：收集 Email
- "phone_number"：手機號碼
- "long_text"：開放意見題
- "short_text"：簡答

輸出格式：
{
  "title": "[產品名] 募資前測問卷",
  "welcome": {
    "title": "歡迎頁標題",
    "description": "歡迎頁說明（可用 \\n 換行）",
    "button_text": "開始填寫 →"
  },
  "fields": [
    {
      "type": "statement",
      "title": "封面／特色卡片主標題",
      "description": "卡片說明文字（可多行特色列點，用 \\n 換行）",
      "button_text": "帶懸念的銜接問句（不可只寫「下一頁」）"
    },
    {
      "type": "multiple_choice",
      "title": "Q1 痛點題標題",
      "description": "以下哪些狀況最常困擾你？",
      "choices": ["選項1", "選項2", "選項3", "選項4"],
      "multiple": true,
      "required": false
    },
    {
      "type": "opinion_scale",
      "title": "購買意願題（含早鳥價資訊）",
      "steps": 7,
      "label_left": "完全不想",
      "label_right": "非常想要",
      "required": false
    },
    { "type": "email", "title": "Email 標題（含早鳥誘因說明）", "required": true },
    { "type": "phone_number", "title": "手機號碼標題", "required": false },
    { "type": "long_text", "title": "開放意見題標題", "required": false }
  ],
  "thankyou": {
    "title": "感謝頁標題",
    "description": "感謝頁描述",
    "button_text": "加入 LINE 官方帳號",
    "button_url": "https://lin.ee/REPLACE_ME"
  }
}

重要規則：
1. 每張圖片卡片（封面、各特色圖）都轉成一個 statement，依文案順序排列，button_text 用該頁的銜接按鈕文字
2. 痛點多選題放在所有特色 statement 之前；購買意願 opinion_scale 放在所有特色之後、Email 之前
3. 購買意願與星級題一律用 opinion_scale，steps 固定 7
4. Email 設 required: true；手機用 phone_number、開放題用 long_text，皆 required: false
5. 多選題設 multiple: true（系統會在回應中提示哪些題目需到後台手動開啟複選）
6. 感謝頁若文案有 LINE 跳轉，button_url 先放 placeholder，提醒使用者替換
7. 嚴格保持原文案的順序`,
      messages: [{
        role: 'user',
        content: `請將以下問卷文案轉換為 Typeform JSON 結構。產品名稱：${productName || '未命名'}\n\n${content.substring(0, 30000)}`
      }]
    })
  });

  if (!res.ok) {
    throw new Error('AI 解析問卷失敗');
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  let jsonStr = text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.fields || parsed.fields.length === 0) {
      throw new Error('沒有解析到問卷題目');
    }
    return parsed;
  } catch (e) {
    if (e.message.includes('沒有解析')) throw e;
    throw new Error('無法解析問卷結構，請確認內容包含問卷題目');
  }
}

// Handle OPTIONS for CORS
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
