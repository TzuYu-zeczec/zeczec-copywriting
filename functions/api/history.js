/**
 * /api/history — Generation history
 * 分流：一般使用者只看自己的紀錄（依 generated_by），管理員（jerry）看全部。
 */
import { listGenerations, listGenerationUsers } from '../_shared/sheets.js';

const ADMIN_EMAILS = ['jerry@zeczec.com'];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const email = (request.headers.get('cf-access-authenticated-user-email') || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(email);

    const filters = {
      productId: url.searchParams.get('productId') || '',
      skillType: url.searchParams.get('skillType') || ''
    };
    // 非管理員只回傳自己的紀錄；管理員可選擇用 generatedBy 篩選特定使用者，未指定則看全部
    if (!isAdmin) {
      filters.generatedBy = email;
    } else {
      const pickUser = url.searchParams.get('generatedBy') || '';
      if (pickUser) filters.generatedBy = pickUser.toLowerCase();
    }

    // 列表用 lite 模式：略過最肥的 output_content / conversation 兩欄
    const generations = await listGenerations(env, filters, { lite: true });

    // 管理員：只有前端要求（第一次載入帶 withUsers=1）時才回傳使用者清單，
    // 且改用只讀 K 欄的輕量查詢，避免每次都整張表再掃一遍。
    let users = [];
    if (isAdmin && url.searchParams.get('withUsers') === '1') {
      users = await listGenerationUsers(env);
    }

    return Response.json({ generations, isAdmin, email, users });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
