/**
 * /api/memory — List memory files from Google Drive
 */
import { listMemory } from '../_shared/drive.js';

export async function onRequestGet({ env }) {
  try {
    const files = await listMemory(env);
    return Response.json({ files });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
