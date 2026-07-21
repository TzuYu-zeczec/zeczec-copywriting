import { listSkills } from '../_shared/drive.js';

export async function onRequestGet({ env }) {
  try {
    const skills = await listSkills(env);
    return Response.json({ skills });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
