import { getSkillDetail } from '../../_shared/drive.js';

export async function onRequestGet({ params, env }) {
  try {
    const skill = await getSkillDetail(env, params.id);
    return Response.json({ skill });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
