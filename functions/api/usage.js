/**
 * GET /api/usage — 各使用者的 Token 使用量與預估花費（僅管理員）
 *
 * 依 Generations 表的 generated_by 欄位彙總每個使用者的輸入/輸出 tokens、
 * 產出次數，並用 Anthropic Sonnet 計價換算預估花費（USD → TWD）。
 *
 * 權限：只有 cf-access-authenticated-user-email 屬於 ADMIN_EMAILS 才能讀。
 * （需先在 Cloudflare Access 套上 @ontoo.cc 登入牆，header 才會帶 email。）
 */
import { listGenerations } from '../_shared/sheets.js';

const ADMIN_EMAILS = ['flyingfive@ontoo.cc'];

// Anthropic Claude Sonnet 計價（每百萬 tokens，美金）
const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;
const USD_TO_TWD = 32; // 近似匯率

export async function onRequestGet({ request, env }) {
  const email = (request.headers.get('cf-access-authenticated-user-email') || '').toLowerCase();

  if (!ADMIN_EMAILS.includes(email)) {
    return Response.json(
      { error: '無權限，僅管理員可檢視使用量', loggedInAs: email || null },
      { status: 403 }
    );
  }

  try {
    const url = new URL(request.url);
    const month = url.searchParams.get('month') || 'all'; // 'all' | 'YYYY-MM'

    const gens = await listGenerations(env, {}, { lite: true });

    // 可選月份清單（依 created_at 的 YYYY-MM，新到舊）— 永遠用全量資料計算，不受目前篩選影響
    const monthsSet = new Set();
    for (const g of gens) {
      const m = (g.created_at || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m)) monthsSet.add(m);
    }
    const availableMonths = [...monthsSet].sort().reverse();

    // 依選擇的月份過濾
    const filtered = month === 'all'
      ? gens
      : gens.filter(g => (g.created_at || '').slice(0, 7) === month);

    const byUser = new Map();
    for (const g of filtered) {
      const key = g.generated_by || '（未記錄）';
      const u = byUser.get(key) || { email: key, count: 0, input_tokens: 0, output_tokens: 0 };
      u.count += 1;
      u.input_tokens += g.input_tokens || 0;
      u.output_tokens += g.output_tokens || 0;
      byUser.set(key, u);
    }

    const users = [...byUser.values()].map(u => withCost(u)).sort((a, b) => b.cost_usd - a.cost_usd);

    const totals = withCost(users.reduce((acc, u) => {
      acc.count += u.count;
      acc.input_tokens += u.input_tokens;
      acc.output_tokens += u.output_tokens;
      return acc;
    }, { email: '__total__', count: 0, input_tokens: 0, output_tokens: 0 }));

    return Response.json({
      rate: USD_TO_TWD,
      pricing: { input_per_m: PRICE_INPUT_PER_M, output_per_m: PRICE_OUTPUT_PER_M },
      month,
      availableMonths,
      users,
      totals
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function withCost(u) {
  const cost_usd =
    (u.input_tokens / 1_000_000) * PRICE_INPUT_PER_M +
    (u.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_M;
  return {
    ...u,
    cost_usd: Math.round(cost_usd * 10000) / 10000,
    cost_twd: Math.round(cost_usd * USD_TO_TWD * 100) / 100
  };
}
