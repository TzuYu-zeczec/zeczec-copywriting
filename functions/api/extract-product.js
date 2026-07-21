/**
 * /api/extract-product — 上傳產品檔案，用 AI 自動抽取產品欄位填入新增產品表單
 *
 * POST body: { files: [{ name, mediaType, data(base64) }] }
 * Response: { product: { ...fields }, fileCount }
 *
 * 支援格式：
 * - application/pdf     → Claude 原生讀 PDF（圖文版面）
 * - image/png|jpeg      → Claude 視覺辨識
 * - text/html|plain     → 解碼為純文字後當文字讀
 * PPT / Keynote 不支援，前端會提示使用者先轉成 PDF。
 *
 * 最重要原則：誠實留白。AI 只抽取檔案中確實出現的資訊，找不到的欄位一律留空，不杜撰。
 */
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// 可由檔案自動抽取的欄位（對應 product.html 表單；不含 id/平台/狀態等系統欄位）
const EXTRACT_FIELDS = [
  'name', 'one_liner', 'category', 'selling_points', 'specs', 'certifications',
  'original_price', 'early_bird_price', 'plans', 'installment_info',
  'core_audience', 'secondary_audience', 'current_alternatives', 'competitors',
  'main_advantage', 'main_weakness', 'kol_coverage', 'testimonials', 'milestones',
  'brand_story', 'desired_feeling', 'best_scenario', 'favorite_point',
  'project_url', 'launch_date', 'end_date', 'discount_code', 'exclusive_perks'
];

const SYSTEM_PROMPT = `你是「產品資料抽取器」。使用者會上傳產品相關檔案（募資簡報、產品型錄、產品照片、網頁等）。
你的任務：只從檔案中「確實出現」的資訊，抽取並填入產品欄位。

最重要的原則 —— 誠實留白：
- 找不到、檔案沒提到、或你不確定的欄位，一律填空字串 ""。
- 絕對不要憑空杜撰、推測、或自行補充任何不在檔案裡的內容。
- 寧可留白，也不要編造。這是硬性規定。

只回傳 JSON，不要有任何其他文字、解釋或 markdown 標記。`;

function buildInstruction() {
  return `請從上面提供的檔案中抽取以下產品欄位，回傳 JSON。任何檔案沒提到的欄位請填 ""（空字串），不要編造：
{
  "name": "產品名稱",
  "one_liner": "一句話描述（精簡有力）",
  "category": "只能是這幾個之一：3C / 生活 / 戶外 / 設計 / 飲食 / 社會 / 其他；不確定就填 \\"\\"",
  "selling_points": "產品賣點，每個賣點一行（用換行 \\n 分隔）",
  "specs": "產品規格",
  "certifications": "認證 / 獎項 / 媒體報導",
  "original_price": "原價",
  "early_bird_price": "早鳥價",
  "plans": "方案內容，每個方案一行",
  "installment_info": "分期資訊",
  "core_audience": "核心受眾",
  "secondary_audience": "次要受眾",
  "current_alternatives": "現有替代方案",
  "competitors": "競爭對手",
  "main_advantage": "主要優勢",
  "main_weakness": "主要劣勢",
  "kol_coverage": "KOL / 媒體報導",
  "testimonials": "使用者見證",
  "milestones": "里程碑",
  "brand_story": "品牌故事",
  "desired_feeling": "希望帶給使用者的感受",
  "best_scenario": "最佳使用場景",
  "favorite_point": "團隊最喜歡的一個特點",
  "project_url": "專案頁面連結",
  "launch_date": "開賣日期（格式 YYYY-MM-DD）",
  "end_date": "結案日期（格式 YYYY-MM-DD）",
  "discount_code": "折扣碼",
  "exclusive_perks": "獨家優惠"
}
再次提醒：沒有出現在檔案裡的內容務必留 ""，不要推測或編造。category 必須是指定選項之一或空字串。`;
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// 把 Anthropic 的錯誤狀態／訊息對應成繁體中文，讓使用者看得懂是什麼問題。
function friendlyAnthropicError(status, errBody) {
  const b = (errBody || '').toLowerCase();
  if (status === 429) return 'AI 服務達到每分鐘用量上限，請等約 1 分鐘再試，或減少一次上傳的圖片張數（也可改貼文字）。';
  if (status === 529 || b.includes('overloaded')) return 'AI 服務目前流量過大、忙碌中，請稍候片刻再試一次。';
  if (status === 401 || status === 403) return 'AI 服務金鑰驗證失敗，請聯絡系統管理員檢查 API 金鑰設定。';
  if (b.includes('dimensions exceed') || b.includes('exceed max allowed size') || (b.includes('image') && b.includes('size'))) {
    return '圖片尺寸或張數超過 AI 限制，請減少張數、改用較小的圖片，或改上傳 PDF／貼上文字。';
  }
  if (status === 413 || b.includes('too large') || b.includes('request too large')) return '上傳內容太大，請減少檔案大小或張數後再試。';
  if (status === 400) return '上傳內容無法處理（可能是格式或大小問題），請改用 PDF／較小的圖片，或改貼上文字。';
  if (status >= 500) return 'AI 服務暫時無法回應（伺服器錯誤），請稍候再試一次。';
  return 'AI 服務發生未預期的錯誤，請稍候再試；若持續發生，請聯絡系統管理員。';
}

// 呼叫 Anthropic，遇 429（每分鐘速率上限）依 retry-after 短暫等待後重試，最多 maxRetries 次。
// 等待上限壓在 18s，避免 Cloudflare 子請求逾時（524）。
async function anthropicWithRetry(body, env, maxRetries = 2) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const ra = parseFloat(res.headers.get('retry-after') || '');
    const waitMs = Math.min((isFinite(ra) && ra > 0 ? ra : 5) * 1000, 18000);
    await new Promise(r => setTimeout(r, waitMs));
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const { files } = await request.json();
    if (!files || !files.length) {
      return Response.json({ error: '沒有檔案可匯入' }, { status: 400 });
    }

    // Build the multimodal message content
    const content = [];
    for (const f of files) {
      const mt = (f.mediaType || '').toLowerCase();
      if (mt === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
      } else if (mt === 'image/png' || mt === 'image/jpeg' || mt === 'image/jpg' || mt === 'image/webp' || mt === 'image/gif') {
        const media = mt === 'image/jpg' ? 'image/jpeg' : mt;
        content.push({ type: 'image', source: { type: 'base64', media_type: media, data: f.data } });
      } else {
        // text/html or text/plain — decode then strip tags if HTML
        let text = '';
        try { text = decodeBase64Utf8(f.data); } catch (_) { text = ''; }
        if (mt === 'text/html') text = stripHtml(text);
        content.push({ type: 'text', text: `【檔案：${f.name || '未命名'}】\n${text.slice(0, 50000)}` });
      }
    }

    content.push({ type: 'text', text: buildInstruction() });

    const res = await anthropicWithRetry({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }]
    }, env);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(friendlyAnthropicError(res.status, errBody));
    }

    const data = await res.json();
    const text = (data.content || []).find(b => b.type === 'text')?.text || '';

    let jsonStr = text;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) jsonStr = m[0];

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('無法解析抽取結果，請改用 PDF 或更清晰的檔案');
    }

    // 只保留已知欄位，找不到的留空（誠實留白）
    const product = {};
    for (const k of EXTRACT_FIELDS) {
      const v = parsed[k];
      product[k] = (v == null) ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
    }

    return Response.json({ product, fileCount: files.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
