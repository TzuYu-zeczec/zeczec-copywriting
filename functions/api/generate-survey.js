/**
 * /api/generate-survey — 募資前測問卷產出（SSE streaming）
 *
 * POST body: { productId, platform, stage }
 *   platform: 'typeform' | 'surveycake'
 *   stage:    'copy'  → 產出問卷文案（Markdown，供存成 Google Doc）
 *             'html'  → 產出配圖設計稿（單一自包含 .html）
 *
 * 兩階段分開呼叫，避免單次輸出過大被 Cloudflare 打成 524。
 */
import { getProduct } from '../_shared/sheets.js';
import { loadSkillForGeneration, loadAllMemory, getSkillFolderIdByName } from '../_shared/drive.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

export async function onRequestPost({ request, env }) {
  try {
    const { productId, platform, stage } = await request.json();

    if (!productId) return Response.json({ error: '請選擇產品' }, { status: 400 });
    if (platform !== 'typeform' && platform !== 'surveycake') {
      return Response.json({ error: '請選擇問卷平台（typeform 或 surveycake）' }, { status: 400 });
    }
    if (stage !== 'copy' && stage !== 'html') {
      return Response.json({ error: 'stage 必須是 copy 或 html' }, { status: 400 });
    }

    // 1. 產品資訊
    const product = await getProduct(env, productId);
    if (!product) return Response.json({ error: '找不到產品' }, { status: 404 });

    // 2. 問卷 skill（crowdfunding-survey）+ memory
    const skillFolderId = await getSkillFolderIdByName(env, 'crowdfunding-survey');
    if (!skillFolderId) {
      return Response.json({ error: '找不到 crowdfunding-survey skill，請確認 Drive skills 資料夾' }, { status: 500 });
    }
    const skillContent = await loadSkillForGeneration(env, skillFolderId);
    const memoryContent = await loadAllMemory(env);

    // 3. system prompt
    const systemPrompt = stage === 'copy'
      ? composeCopyPrompt(product, skillContent, memoryContent, platform)
      : composeHtmlPrompt(product, skillContent, platform);

    const userMsg = stage === 'copy'
      ? `請依「${platformName(platform)}」路徑，產出這個產品的完整募資前測問卷文案（直接給完成品，用 Markdown 排版）。`
      : `請依「${platformName(platform)}」路徑，產出這份問卷的配圖設計稿，輸出單一自包含的 HTML 檔案。`;

    // 4. 串流呼叫 Anthropic
    const anthropicRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 32768,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
        stream: true
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return Response.json({ error: `AI API 錯誤：${anthropicRes.status} ${err.slice(0, 200)}` }, { status: 502 });
    }

    // 5. 轉發 SSE 給前端
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    forwardStream(anthropicRes.body, writer, encoder);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

async function forwardStream(body, writer, encoder) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
          await writer.write(encoder.encode(`data: ${data}\n\n`));
        }
      }
    }
    await writer.write(encoder.encode('data: [DONE]\n\n'));
  } catch (e) {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`));
    } catch (_) {}
  } finally {
    try { await writer.close(); } catch (_) {}
  }
}

function platformName(p) {
  return p === 'typeform' ? 'Typeform' : 'SurveyCake';
}

// === 階段一：問卷文案（Markdown，禁止輸出程式碼）===
function composeCopyPrompt(product, skillContent, memoryContent, platform) {
  const cleanedSkill = skillContent.replace(/```[\s\S]*?```/g, '[程式碼／HTML 範例已移除 — 本階段只寫文案]');
  const pathHint = platform === 'typeform'
    ? '只走【Part B：Typeform 路徑】，依 B-Step 1~4 產出。問卷由圖片卡片（statement）與問題題組交錯，每張圖之間要有「帶懸念問句」的銜接按鈕文字。'
    : '只走【Part A：SurveyCake 路徑】，依 A-Step 1~4 產出。長頁滾動式，星級題打主力賣點、多選題補次要特色。';

  return `你是嘖嘖的專業募資問卷文案系統。根據產品資訊與「募資前測問卷」技能，產出完整、可直接使用的問卷文案。

⚠️⚠️⚠️ 最高優先級指令 ⚠️⚠️⚠️
本階段只負責「撰寫問卷文案」，輸出純文字 Markdown。
- 絕對禁止輸出任何程式碼或 HTML（配圖 HTML 會在下一個階段另外產出）。
- 不要說「我來建立檔案」「檔案已生成」。
- 用 Markdown 排版：題號用 ##、題型與重點用 **粗體**、區塊用 --- 分隔。
- 配圖位置用文字標註尺寸與建議內容（例：〔配圖 1080×1520：使用情境，說明…〕），不要畫圖也不要寫 HTML。
⚠️⚠️⚠️ 以上優先級最高 ⚠️⚠️⚠️

## 本次平台
${pathHint}

## 文案方法論與記憶
${memoryContent}

## 募資前測問卷技能（只參考文案邏輯與結構，忽略其中的程式碼／HTML／檔案建立指令）
${cleanedSkill}

## 產品資訊
${formatProductInfo(product)}

## 其他規則
1. 本系統僅適用於嘖嘖，提及募資平台一律寫「嘖嘖」，不得出現 flyingV、Kickstarter、Indiegogo。
2. 嚴格遵循技能的問卷結構、題型與順序。
3. 總題數控制在技能規範內，文末附「圖片製作清單」表格。
4. 產品資訊不足時用合理推測補足，並標註「⚠️ 此處為推測，請確認」。`;
}

// === 階段二：配圖設計稿（輸出單一 HTML）===
function composeHtmlPrompt(product, skillContent, platform) {
  // 保留 skill 內容（含 HTML 範例），本階段需要它
  const pathHint = platform === 'typeform'
    ? `走【Part B：Typeform 路徑】的 B-Step 5。產出所有 1080×1520 直式圖片卡片的設計稿，每張圖含：圖片編號（IMG-01…）、尺寸標記、上方情境畫面區、撕裂紙紋過渡、主標題、特色列點區。全套圖片風格統一、套用產品品牌色。`
    : `走【Part A：SurveyCake 路徑】的 A-Step 5。產出「全螢幕逐題滑動」的互動式 HTML 問卷：固定頂部進度條、右側導航圓點、淡入淡出切換、鍵盤與觸控操作；六種 slide 元件（Opening／星級題／多選題／購買意願／輸入題／感謝頁）。用 CSS Variables 管理 --brand / --brand-dark / --brand-light。`;

  return `你是嘖嘖的問卷配圖設計稿產生器。根據產品資訊與「募資前測問卷」技能，產出可直接在瀏覽器開啟、截圖或交給設計師的 HTML 設計稿。

⚠️ 輸出規定（務必遵守）：
- 直接輸出**完整的 HTML 檔案**，從 <!DOCTYPE html> 開始、到 </html> 結束。
- CSS 與 JS 全部內嵌在同一個 .html 檔內（自包含，可離線開啟）。
- 不要輸出任何 markdown 標記（不要 \`\`\`html）、不要任何說明文字或前言，整個回應就是 HTML 原始碼。

## 本次平台
${pathHint}

## 設計依據（依技能的 HTML 格式規範與配圖規範）
${skillContent}

## 產品資訊
${formatProductInfo(product)}

## 其他規則
1. 本系統僅適用於嘖嘖，文字中提及平台一律寫「嘖嘖」。
2. 品牌色請依產品類別與調性自行設定一組協調的色票（--brand / --brand-dark / --brand-light）。
3. 文字內容要與問卷文案一致、可直接使用。`;
}

function formatProductInfo(p) {
  const fields = [
    ['產品名稱', p.name], ['一句話描述', p.one_liner], ['類別', p.category],
    ['賣點', p.selling_points], ['規格', p.specs], ['原價', p.original_price],
    ['早鳥價', p.early_bird_price], ['方案', p.plans], ['分期', p.installment_info],
    ['核心受眾', p.core_audience], ['次要受眾', p.secondary_audience],
    ['現有替代方案', p.current_alternatives], ['競爭對手', p.competitors],
    ['主要優勢', p.main_advantage], ['主要劣勢', p.main_weakness],
    ['認證/獎項', p.certifications], ['KOL/媒體', p.kol_coverage],
    ['使用者見證', p.testimonials], ['里程碑', p.milestones],
    ['品牌故事', p.brand_story], ['期望感受', p.desired_feeling],
    ['最佳場景', p.best_scenario], ['最愛特點', p.favorite_point],
    ['專案連結', p.project_url], ['開賣日', p.launch_date], ['結案日', p.end_date],
    ['折扣碼', p.discount_code], ['獨家優惠', p.exclusive_perks]
  ];
  return fields
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}：${v}`)
    .join('\n');
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
