/**
 * /api/create-sheet — 將 AI 產出的受眾矩陣轉為 Google Sheets
 *
 * 流程：
 * 1. 收到 AI 產出的文字內容
 * 2. 用一次 AI 呼叫，將文字解析／補全為結構化 JSON（完整 Meta 受眾矩陣）
 * 3. 用 JSON 建立兩個分頁：② 受眾輪廓總覽、③ 受眾碎片化標籤
 * 4. 回傳 Sheets 連結
 */
import { createNewSpreadsheet } from '../_shared/sheets.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// 矩陣分類 → 欄位，以及各分類的標題色（對齊完整版範本）
const MATRIX_CATEGORIES = [
  { name: '識別',     color: rgb(46, 64, 87),   fields: ['Persona ID', '代表名稱', '購買機率'] },
  { name: '人口統計', color: rgb(15, 52, 96),   fields: ['年齡設定', '性別設定', '職稱興趣標籤', '學歷／財務行為', '生命週期標籤'] },
  { name: '生活風格', color: rgb(83, 52, 131),  fields: ['生活風格品牌偏好', '效率／生產力興趣', '價值觀興趣標籤'] },
  { name: '心理動機', color: rgb(230, 81, 0),   fields: ['核心購買動機'] },
  { name: '旅行行為', color: rgb(27, 67, 50),   fields: ['移動性行為'] },
  { name: '職業身份', color: rgb(123, 45, 0),   fields: ['商業職場興趣', '商務形象興趣'] },
  { name: '科技裝置', color: rgb(21, 101, 192), fields: ['Meta 裝置行為標籤', '科技產品興趣', '科技媒體評測'] },
  { name: '購買行為', color: rgb(0, 105, 92),   fields: ['Meta 購物行為標籤', '電商平台行為'] },
  { name: '廣告投放', color: rgb(74, 20, 140),  fields: ['建議廣告版位', 'KOL 類型'] },
  { name: '文案標籤', color: rgb(181, 69, 27),  fields: ['Hook 開場關鍵詞', 'CTA 賣點關鍵詞', '反對意見破解'] }
];

function rgb(r, g, b) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

export async function onRequestPost({ request, env }) {
  try {
    const { content, productName } = await request.json();

    if (!content) {
      return Response.json({ error: '沒有內容可建立' }, { status: 400 });
    }

    // 1. Ask AI to parse + enrich content into structured JSON
    const parsed = await parseContentToJSON(env, content);

    // 2. Build sheets from parsed data
    const sheets = buildAudienceSheets(parsed);

    // 3. Create spreadsheet
    const title = `受眾輪廓矩陣｜${productName || '產品'}｜${new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')}`;
    const folderId = env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID || env.GOOGLE_DRIVE_FOLDER_ID;

    const result = await createNewSpreadsheet(env, title, sheets, folderId);

    return Response.json({
      url: result.url,
      spreadsheetId: result.spreadsheetId,
      title,
      audienceCount: parsed.audiences?.length || 0
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

/**
 * 用 AI 將文字內容解析／補全為完整的受眾矩陣 JSON
 */
async function parseContentToJSON(env, content) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32000,
      stream: true,
      system: `你是「Meta 廣告受眾矩陣建構器」。把受眾分析內容轉換成一份完整、可直接投放的受眾矩陣 JSON。
只回傳 JSON，不要有任何其他文字、解釋或 markdown 標記。

輸出格式：
{
  "audiences": [
    {
      "id": "P01",
      "name": "受眾名稱（生動有畫面，例如「潔癖系全職媽媽」）",
      "purchase_probability": "★★★★★",
      "rank": 1,
      "profile_zh": "多段、有溫度、有畫面的中文敘事輪廓（用換行分段，至少 3-5 句）",
      "profile_en": "Multi-sentence English profile describing the same persona.",
      "fields": {
        "年齡設定": "28-40歲",
        "性別設定": "女性為主",
        "職稱興趣標籤": ["#全職媽媽", "#家庭主婦", "#Homemaker"],
        "學歷／財務行為": ["#大學以上學歷", "#中高收入家庭"],
        "生命週期標籤": ["#新生兒 (New parent)", "#小孩 1-3 歲"],
        "生活風格品牌偏好": ["#IKEA", "#無印良品 MUJI", "#好市多 Costco"],
        "效率／生產力興趣": ["#生產力 Productivity", "#家事效率"],
        "價值觀興趣標籤": ["#無毒居家 Chemical-free home", "#親子教養 Parenting"],
        "核心購買動機": "安全感驅動——保護孩子健康是最大動力，願意為「無毒」多付錢",
        "移動性行為": "—",
        "商業職場興趣": "—",
        "商務形象興趣": "—",
        "Meta 裝置行為標籤": ["#iOS 裝置用戶 iPhone/iPad"],
        "科技產品興趣": ["#家電 Home appliances", "#清潔家電 Cleaning appliances"],
        "科技媒體評測": ["#媽媽經 MamaClub", "#BabyHome"],
        "Meta 購物行為標籤": ["#線上購物高頻 Engaged shoppers", "#群眾募資支持者 Crowdfunding backers"],
        "電商平台行為": ["#蝦皮 Shopee", "#momo購物網"],
        "建議廣告版位": ["#FB Feed（主力）", "#IG Feed", "#IG Stories"],
        "KOL 類型": ["#親子生活 YouTuber", "#居家整潔 IG 達人"],
        "Hook 開場關鍵詞": "#小孩在地上爬，你確定地板真的乾淨嗎？",
        "CTA 賣點關鍵詞": "#140°C 蒸氣殺菌，不用一滴清潔劑，寶寶舔地板也安心",
        "反對意見破解": "#「蒸氣會不會燙到小孩？」→ 手套設計隔熱，蒸氣只在接觸面釋放，離手即停"
      }
    }
  ]
}

規則：
1. 辨識出內容中所有受眾人物（persona），不要遺漏；通常 6-10 個。id 用 P01、P02… 依購買機率高到低排序，rank 為名次（1 最高）。
2. purchase_probability 用 1-5 顆 ★（★★★★★ 最高），對應這個受眾的購買可能性。
3. profile_zh 要寫成有溫度、有畫面的敘事（不是條列），用 \\n 分段，至少 3-5 句繁體中文。profile_en 是對應的英文輪廓。
4. fields 物件裡每一個欄位都要填。標籤類欄位的值是「#」開頭的短標籤陣列；若該欄位對此受眾不適用，填字串 "—"。
5. 標籤盡量對應 Meta Ads Manager 實際收錄的興趣／行為／人口統計選項，並附英文原名（如適用）。若原文沒寫到，依產品情境與你的 Meta 投放知識「合理生成」實際可投放的標籤，不要留空。
6. Hook 開場關鍵詞 / CTA 賣點關鍵詞 / 反對意見破解 用「#」開頭的短句，貼近該受眾語氣（字串，非陣列）。
7. 全部使用繁體中文（標籤可中英並陳）。只輸出 JSON。`,
      messages: [{
        role: 'user',
        content: `請將以下受眾分析內容轉換為完整的受眾矩陣 JSON：\n\n${content.substring(0, 30000)}`
      }]
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AI 解析失敗: ${res.status} ${errBody.slice(0, 400)}`);
  }

  // Read the SSE stream and accumulate text deltas. Streaming keeps the subrequest
  // alive (first byte arrives fast), avoiding Cloudflare's ~100s 524 timeout that a
  // large non-streaming generation would hit.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          text += evt.delta.text;
        }
      } catch (_) { /* ignore keep-alive / partial lines */ }
    }
  }

  // Extract JSON from response (handle potential markdown wrapping)
  let jsonStr = text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('無法解析受眾資料，請確認內容包含受眾分析');
  }
}

/**
 * 取某個 persona 在某個欄位的矩陣顯示值
 */
function cellValue(a, field) {
  if (field === 'Persona ID') return `#${a.id || ''}`;
  if (field === '代表名稱') return `#${a.name || ''}`;
  if (field === '購買機率') {
    const stars = a.purchase_probability || '';
    return `#${stars}${a.rank ? `  #${a.rank}` : ''}`.trim() || '—';
  }
  const f = a.fields || {};
  let v = f[field];
  if (v == null) v = f[field.replace(/\s+/g, '')];
  if (Array.isArray(v)) return v.length ? v.join('  /  ') : '—';
  return (v == null || v === '') ? '—' : String(v);
}

/**
 * 從解析的 JSON 建立兩個分頁：② 受眾輪廓總覽、③ 受眾碎片化標籤
 */
function buildAudienceSheets(parsed) {
  const audiences = parsed.audiences || [];
  if (audiences.length === 0) {
    throw new Error('沒有找到受眾資料');
  }

  // ② 受眾輪廓總覽（Persona × 中文敘述 × 英文輪廓）
  const narrativeHeaders = ['Persona', '輪廓敘述（中文）', 'Profile (English)'];
  const narrativeRows = audiences.map(a => [
    `${a.id || ''}｜${a.name || ''}`,
    (a.profile_zh || a.profile || '').replace(/\\n/g, '\n'),
    (a.profile_en || '').replace(/\\n/g, '\n')
  ]);

  // ③ 受眾碎片化標籤（轉置：persona 為欄、屬性分類為列，分類列彩色）
  const personaLabels = audiences.map(a => `${a.id || ''}\n${a.name || ''}`);
  const matrixHeaders = ['類別', '欄位名稱', ...personaLabels];
  const matrixRows = [];
  const sections = [];
  let rowPtr = 1; // row 0 = header row

  for (const cat of MATRIX_CATEGORIES) {
    matrixRows.push([cat.name, ...Array(matrixHeaders.length - 1).fill('')]);
    sections.push({ rowIndex: rowPtr, color: cat.color });
    rowPtr++;

    for (const field of cat.fields) {
      matrixRows.push(['', field, ...audiences.map(a => cellValue(a, field))]);
      rowPtr++;
    }
  }

  return [
    { title: '② 受眾輪廓總覽', headers: narrativeHeaders, rows: narrativeRows },
    {
      title: '③ 受眾碎片化標籤',
      headers: matrixHeaders,
      rows: matrixRows,
      sections,
      labelCols: 2,
      frozenCols: 2,
      noBanding: true
    }
  ];
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
