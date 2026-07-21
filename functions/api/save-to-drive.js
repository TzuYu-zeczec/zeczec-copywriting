/**
 * /api/save-to-drive — 將文案儲存為 Google Docs
 *
 * POST body: { content, productName, skillName }
 * Response: { docUrl, docId }
 */
import { createGoogleDoc } from '../_shared/drive.js';

export async function onRequestPost({ request, env }) {
  try {
    const { content, productName, skillName } = await request.json();

    if (!content) {
      return Response.json({ error: '沒有文案內容' }, { status: 400 });
    }

    // Build document title with date
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replace(/\//g, '-');
    const title = `${productName || '文案'}｜${skillName || '產出'}｜${dateStr}`;

    // Use output folder if set, otherwise fall back to main drive folder
    const folderId = env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID || env.GOOGLE_DRIVE_FOLDER_ID;

    const result = await createGoogleDoc(env, title, content, folderId);

    return Response.json({
      docUrl: result.docUrl,
      docId: result.docId,
      title
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
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
