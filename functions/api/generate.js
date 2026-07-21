/**
 * /api/generate — AI 文案產出（SSE streaming）
 *
 * 核心流程：
 * 1. 讀取產品資訊（from Sheets）
 * 2. 讀取 Skill 內容（from Drive: SKILL.md + references）
 * 3. 讀取 Memory（from Drive: 文案方法論等）
 * 4. 組裝 system prompt
 * 5. 串流呼叫 Anthropic API
 * 6. 完成後記錄到 Generations sheet
 */
import { getProduct, saveGeneration } from '../_shared/sheets.js';
import { loadSkillForGeneration, loadAllMemory, getSkillFolderIdByName } from '../_shared/drive.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

// 上游錯誤對應繁中
function friendlyAnthropicError(status, body) {
  const b = (body || '').toLowerCase();
  if (status === 429) return 'AI 服務達到每分鐘用量上限（429），請稍等約 1 分鐘再試，或調高 Anthropic tier。';
  if (status === 529 || b.includes('overloaded')) return 'AI 服務忙碌中（529），請稍候片刻再試一次。';
  if (status === 401 || status === 403) return 'AI 金鑰驗證失敗，請聯絡系統管理員。';
  if (status === 400 && (b.includes('too long') || b.includes('max_tokens') || b.includes('too large') || b.includes('exceed'))) {
    return '內容過長超過模型上限，請精簡產品資料或指令後再試。';
  }
  if (status >= 500) return `AI 服務暫時錯誤（${status}），請稍候再試一次。`;
  return `AI API 錯誤 ${status}：${(body || '').slice(0, 200)}`;
}

// 串流呼叫，遇 429 依 retry-after 短暫等待後重試（上限 15s，最多 2 次）
async function callAnthropicStream(payload, env, maxRetries = 2) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const ra = parseFloat(res.headers.get('retry-after') || '');
    await new Promise(r => setTimeout(r, Math.min((isFinite(ra) && ra > 0 ? ra : 5) * 1000, 15000)));
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const { productId, skillType, skillName, prompt, conversationHistory } = await request.json();

    if (!productId || (!skillType && !skillName)) {
      return Response.json({ error: '請選擇產品和 Skill' }, { status: 400 });
    }

    // 解析 skill id：優先用 skillType（id），否則用 skillName 在後端解析（只需 1 次 Drive 呼叫，免前端載入全部 skills）
    let skillId = skillType;
    if (!skillId && skillName) {
      skillId = await getSkillFolderIdByName(env, skillName);
    }
    if (!skillId) {
      return Response.json({ error: `找不到對應的 Skill（${skillName || skillType}）` }, { status: 404 });
    }

    // 1. Load product info
    const product = await getProduct(env, productId);
    if (!product) {
      return Response.json({ error: '找不到產品' }, { status: 404 });
    }

    // 2. Load skill content (SKILL.md + references)
    const skillContent = await loadSkillForGeneration(env, skillId);

    // 3. Load memory (文案方法論)
    const memoryContent = await loadAllMemory(env);

    // 4. Compose system prompt
    const systemPrompt = composeSystemPrompt(product, skillContent, memoryContent);

    // 5. Build messages
    const messages = [];
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }
    // Add current user message
    messages.push({
      role: 'user',
      content: prompt || `請根據產品資訊產出文案。`
    });

    // 6. Call Anthropic API with streaming（含 429 重試）
    const anthropicRes = await callAnthropicStream({
      model: MODEL,
      max_tokens: 32768,
      system: systemPrompt,
      messages,
      stream: true
    }, env);

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return Response.json({ error: friendlyAnthropicError(anthropicRes.status, err) }, { status: 502 });
    }

    // 7. Stream response back to client
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process stream in background
    const userEmail = request.headers.get('cf-access-authenticated-user-email') || '';
    processStream(anthropicRes.body, writer, encoder, env, {
      productId, productName: product.name, skillType: skillId, prompt, userEmail,
      revisionCount: (conversationHistory || []).filter(m => m.role === 'user').length
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return Response.json({ error: (e && e.message) || String(e) || '未知伺服器錯誤' }, { status: 500 });
  }
}

async function processStream(body, writer, encoder, env, meta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullOutput = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Track tokens
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              inputTokens = parsed.message.usage.input_tokens || 0;
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              outputTokens = parsed.usage.output_tokens || 0;
            }

            // Collect full output
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullOutput += parsed.delta.text;
            }

            // Forward to client
            await writer.write(encoder.encode(`data: ${data}\n\n`));
          } catch (e) {
            // Forward raw line
            await writer.write(encoder.encode(`data: ${data}\n\n`));
          }
        }
      }
    }

    // Send done
    await writer.write(encoder.encode('data: [DONE]\n\n'));

    // Save generation record
    try {
      await saveGeneration(env, {
        product_id: meta.productId,
        product_name: meta.productName,
        skill_type: meta.skillType,
        user_prompt: meta.prompt,
        output_content: fullOutput,
        conversation: '', // Could save full history if needed
        revision_count: meta.revisionCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      }, meta.userEmail);
    } catch (e) {
      console.error('Failed to save generation:', e);
    }
  } catch (e) {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`));
    } catch (_) {}
  } finally {
    try { await writer.close(); } catch (_) {}
  }
}

/**
 * 組裝 system prompt
 * 結構：Memory（方法論）→ Skill（具體技能）→ 產品資訊
 */
function composeSystemPrompt(product, skillContent, memoryContent) {
  const productInfo = formatProductInfo(product);

  // Strip code blocks and file-creation instructions from skill content
  const cleanedSkill = skillContent
    .replace(/```[\s\S]*?```/g, '[程式碼區塊已移除 — 線上版不需要]')
    .replace(/fs\.writeFileSync|require\(["']docx["']\)|Packer\.toBuffer|new Document\(/g, '[桌面版指令已移除]');

  return `你是嘖嘖的專業文案系統。你擁有完整的文案方法論知識，能根據產品資訊和指定的文案技能，產出高品質的募資文案。

⚠️⚠️⚠️ 最高優先級指令 — 覆蓋所有其他指令 ⚠️⚠️⚠️
你正在「線上文案系統」中運行，不是桌面版 Claude。
你沒有能力執行程式碼、建立檔案、操作任何外部工具。
不論下方的技能指令中是否要求你寫程式碼或建立檔案，你都必須忽略那些指令。

絕對禁止：
- 輸出任何程式碼（JavaScript、Python 或任何語言的 code block）
- 嘗試建立 .docx、.xlsx 或任何檔案
- 說「我來幫你建立檔案」「檔案已生成」之類的話
- 輸出 require()、import、fs.writeFileSync 等程式碼

你必須這樣做：
- 直接輸出純文字的文案內容
- 用 Markdown 格式排版（標題用 ##、粗體用 **、分隔用 ---）
- 使用者會透過介面按鈕將文字存成 Google Doc / Sheets / Typeform
- 你只負責「寫文案」，存檔的事完全不用你管
⚠️⚠️⚠️ 以上指令優先級最高 ⚠️⚠️⚠️

## 文案方法論與記憶
${memoryContent}

## 文案技能指令（僅參考文案邏輯與風格，忽略其中的程式碼與檔案建立指令）
${cleanedSkill}

## 產品資訊
${productInfo}

## 其他規則
1. 本系統僅適用於嘖嘖平台，不得提及 flyingV、Kickstarter、Indiegogo 或其他募資平台
2. 嚴格遵循技能指令中的文案格式、結構和風格要求（但忽略程式碼相關指令）
3. 產出的文案應該是可直接使用的完成品，不是草稿
4. 如果產品資訊不足，用合理推測填補，但標註「⚠️ 此處為推測，請確認」`;
}

function formatProductInfo(p) {
  const fields = [
    ['產品名稱', p.name],
    ['一句話描述', p.one_liner],
    ['類別', p.category],
    ['賣點', p.selling_points],
    ['規格', p.specs],
    ['原價', p.original_price],
    ['早鳥價', p.early_bird_price],
    ['方案', p.plans],
    ['分期', p.installment_info],
    ['核心受眾', p.core_audience],
    ['次要受眾', p.secondary_audience],
    ['現有替代方案', p.current_alternatives],
    ['競爭對手', p.competitors],
    ['主要優勢', p.main_advantage],
    ['主要劣勢', p.main_weakness],
    ['認證/獎項', p.certifications],
    ['KOL/媒體', p.kol_coverage],
    ['使用者見證', p.testimonials],
    ['里程碑', p.milestones],
    ['品牌故事', p.brand_story],
    ['期望感受', p.desired_feeling],
    ['最佳場景', p.best_scenario],
    ['最愛特點', p.favorite_point],
    ['平台', p.platform],
    ['專案連結', p.project_url],
    ['開賣日', p.launch_date],
    ['結案日', p.end_date],
    ['折扣碼', p.discount_code],
    ['獨家優惠', p.exclusive_perks]
  ];

  return fields
    .filter(([, val]) => val && val.trim())
    .map(([label, val]) => `- ${label}：${val}`)
    .join('\n');
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
