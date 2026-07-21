import { getGeneration } from '../../_shared/sheets.js';

const ADMIN_EMAILS = ['jerry@zeczec.com'];

export async function onRequestGet({ request, params, env }) {
  try {
    const generation = await getGeneration(env, params.id);
    if (!generation) return Response.json({ error: '找不到紀錄' }, { status: 404 });

    // 分流：非管理員只能看自己的紀錄
    const email = (request.headers.get('cf-access-authenticated-user-email') || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(email);
    if (!isAdmin && (generation.generated_by || '').toLowerCase() !== email) {
      return Response.json({ error: '找不到紀錄' }, { status: 404 });
    }

    return Response.json({ generation });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
