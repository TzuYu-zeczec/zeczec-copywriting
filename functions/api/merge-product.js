/**
 * /api/merge-product — 智慧合併：把新上傳的資料「逐條」合併進既有產品欄位
 *
 * POST body: {
 *   existing: { <field>: <現有值>, ... },   // 來自編輯頁目前表單
 *   files:    [{ name, mediaType, data(base64) }]
 * }
 * Response: {
 *   fields: [
 *     { key, items: [ { op:'keep'|'add'|'modify', text, old? } ] }
 *   ],
 *   fileCount
 * }
 *
 * 與 extract-product 的差別：extract 是「抽取填空表單」（新增產品用），
 * merge 是「拿新資料逐條對既有內容做合併」（編輯既有產品用）。
 *
 * 合併規則（寫進 system prompt）：
 * - 既有每條預設保留（keep），逐字照抄不改寫
 * - 全新特色 → 新增（add），放到語意上最合適的段落
 * - 同一屬性但數值/內容更新（尺寸、容量、重量、接口、價格…）→ 修正（modify），取代既有那一條
 * - 保留 ▍ 段落標題與空行結構
 * - 只處理檔案中確實出現的新資訊，不杜撰；新資料沒提到的欄位不輸出
 */
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// 可合併的欄位（對應 product.html 表單；不含 id/平台/狀態等系統欄位）
const MERGE_FIELDS = [
  'name', 'one_liner', 'category', 'selling_points', 'specs', 'certifications',
  'original_price', 'early_bird_price', 'plans', 'installment_info',
  'core_audience', 'secondary_audience', 'current_alternatives', 'competitors',
  'main_advantage', 'main_weakness', 'kol_coverage', 'testimonials', 'milestones',
  'brand_story', 'desired_feeling', 'best_scenario', 'favorite_point',
  'project_url', 'launch_date', 'end_date', 'discount_code', 'exclusive_perks'
];

const FIELD_LABELS = {
  name: '產品名稱', one_liner: '一句話描述', category: '產品類別',
  selling_points: '產品賣點', specs: '產品規格', certifications: '認證/獎項/媒體報導',
  original_price: '原價', early_bird_price: '早鳥價', plans: '方案內容', installment_info: '分期資訊',
  core_audience: '核心受眾', secondary_audience: '次要受眾', current_alternatives: '現有替代方案',
  competitors: '競爭對手', main_advantage: '主要優勢', main_weakness: '主要劣勢',
  kol_coverage: 'KOL / 媒體報導', testimonials: '使用者見證', milestones: '里程碑',
  brand_story: '品牌故事', desired_feeling: '希望帶給使用者的感受', best_scenario: '最佳使用場景',
  favorite_point: '團隊最喜歡的一個特點', project_url: '專案頁面連結',
  launch_date: '開賣日期', end_date: '結案日期', discount_code: '折扣碼', exclusive_perks: '獨家優惠'
};

const SYSTEM_PROMPT = `你是「產品資料智慧合併器」。使用者有一份既有的產品欄位資料，並上傳了新的補充資料。
你的任務：把新資料「逐條」合併進既有資料，產出每個欄位的合併操作清單。

合併規則（務必嚴格遵守）：
1. 既有資料的每一行內容預設保留，標記 op="keep"，並逐字照抄，不要改寫、潤飾或重新排版。
2. 新資料中「既有資料沒有的全新條目／特色」→ 標記 op="add"，text 放新內容，並把它擺到語意上最合適的段落位置（例如尺寸相關放進尺寸那一段、傳輸相關放進傳輸那一段）。
3. 新資料中描述「與既有某一條同一個屬性、但數值或內容不同」（例如尺寸、容量、重量、接口、續航、價格的更新）→ 視為「修正」，標記 op="modify"，text 放新的（正確的）內容，old 放被它取代的那一條既有內容。修正時不要同時保留舊的那一條。
4. 保留段落標題（以 ▍ 或「核心亮點」等開頭的行）與原本的空行結構；空行也輸出成 {"op":"keep","text":""}。
5. 只處理上傳檔案中「確實出現」的新資訊，絕不杜撰、推測或自行補充。
6. 新資料完全沒有提到、或與既有完全相同的欄位，請「不要」輸出（fields 陣列中省略該欄位）。
7. 多行清單欄位（如產品賣點、產品規格、方案內容）逐行處理；單值欄位（如原價、早鳥價、日期）若有更新，就用單一個 op="modify"（old 放舊值、text 放新值）。

每個輸出的欄位，其 items 陣列「依最終顯示順序」完整列出該欄位合併後的每一行（包含 keep / add / modify），讓前端可以照順序重建欄位內容。

只回傳 JSON，不要有任何其他文字、解釋或 markdown 標記。格式：
{
  "fields": [
    {
      "key": "<欄位英文名>",
      "items": [
        {"op": "keep",   "text": "原本就有、照抄的一行"},
        {"op": "add",    "text": "新增的一行"},
        {"op": "modify", "text": "修正後的新內容", "old": "被取代的舊內容"}
      ]
    }
  ]
}`;

function buildMergeInstruction(existing) {
  const lines = [];
  lines.push('以下是「既有產品資料」（每個欄位目前的內容，請以此為基準合併）：');
  lines.push('<<<EXISTING');
  for (const k of MERGE_FIELDS) {
    const v = (existing && existing[k] != null) ? String(existing[k]).trim() : '';
    if (!v) continue;
    lines.push(`### ${k}（${FIELD_LABELS[k] || k}）`);
    lines.push(v);
    lines.push('');
  }
  lines.push('EXISTING>>>');
  lines.push('');
  lines.push('請依系統規則，把「上面提供的新檔案／文字內容」逐條合併進這些既有欄位，回傳 JSON。');
  lines.push('提醒：keep 的行逐字照抄；新值取代舊值時用 modify（不要保留被取代的舊行）；新資料沒提到的欄位不要輸出；不要杜撰。');
  lines.push(`合法的欄位英文名只能是：${MERGE_FIELDS.join(', ')}。`);
  return lines.join('\n');
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
    const { existing, files } = await request.json();
    if (!files || !files.length) {
      // 也允許只貼文字（前端會把文字包成一個 text/plain「檔案」），所以這裡只擋全空
      return Response.json({ error: '沒有新資料可合併' }, { status: 400 });
    }

    // 組多模態訊息：先放新檔案，再放既有資料與指令
    const content = [];
    for (const f of files) {
      const mt = (f.mediaType || '').toLowerCase();
      if (mt === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
      } else if (mt === 'image/png' || mt === 'image/jpeg' || mt === 'image/jpg' || mt === 'image/webp' || mt === 'image/gif') {
        const media = mt === 'image/jpg' ? 'image/jpeg' : mt;
        content.push({ type: 'image', source: { type: 'base64', media_type: media, data: f.data } });
      } else {
        let text = '';
        try { text = decodeBase64Utf8(f.data); } catch (_) { text = ''; }
        if (mt === 'text/html') text = stripHtml(text);
        content.push({ type: 'text', text: `【新資料檔案：${f.name || '未命名'}】\n${text.slice(0, 50000)}` });
      }
    }

    content.push({ type: 'text', text: buildMergeInstruction(existing || {}) });

    const res = await anthropicWithRetry({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
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
      throw new Error('無法解析合併結果，請改用更清晰的檔案或縮短內容');
    }

    // 清洗：只留合法欄位、合法 op，且至少含一個 add/modify 才回傳
    const fields = [];
    for (const f of (parsed.fields || [])) {
      if (!f || !MERGE_FIELDS.includes(f.key) || !Array.isArray(f.items)) continue;
      const items = [];
      let changeCount = 0;
      for (const it of f.items) {
        if (!it || typeof it.text !== 'string') continue;
        const op = (it.op === 'add' || it.op === 'modify') ? it.op : 'keep';
        const item = { op, text: it.text };
        if (op === 'modify') { item.old = typeof it.old === 'string' ? it.old : ''; changeCount++; }
        if (op === 'add') changeCount++;
        items.push(item);
      }
      if (items.length && changeCount > 0) {
        fields.push({ key: f.key, label: FIELD_LABELS[f.key] || f.key, items });
      }
    }

    return Response.json({ fields, fileCount: files.length });
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
