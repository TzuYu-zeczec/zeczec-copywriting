/**
 * /api/save-html — 將配圖設計稿存成 Drive 上的 .html 檔（保留原始 HTML，可下載／瀏覽器開啟）
 *
 * POST body: { html, productName, platform }
 * Response: { fileUrl, downloadUrl, fileId, title }
 */
import { uploadRawFile } from '../_shared/drive.js';

export async function onRequestPost({ request, env }) {
  try {
    const { html, productName, platform } = await request.json();
    if (!html) return Response.json({ error: '沒有 HTML 內容' }, { status: 400 });

    const dateStr = new Date().toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replace(/\//g, '-');
    const platformLabel = platform === 'surveycake' ? 'SurveyCake' : 'Typeform';
    const title = `${productName || '問卷'}｜${platformLabel}問卷配圖設計稿｜${dateStr}.html`;

    const folderId = env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID || env.GOOGLE_DRIVE_FOLDER_ID;
    const result = await uploadRawFile(env, title, html, 'text/html', folderId);

    return Response.json({
      fileUrl: result.fileUrl,
      downloadUrl: result.downloadUrl,
      fileId: result.fileId,
      title
    });
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
