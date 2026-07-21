/**
 * /api/sheets-import — Import product from external Google Sheet
 */
import { readExternalSheet, importFromExternalSheet } from '../_shared/sheets.js';

export async function onRequestPost({ request, env }) {
  try {
    const { sheetUrl, mappings } = await request.json();

    if (!sheetUrl) {
      return Response.json({ error: '請提供 Sheet 連結' }, { status: 400 });
    }

    if (!mappings) {
      // Step 1: detect columns
      const result = await readExternalSheet(env, sheetUrl);
      return Response.json(result);
    } else {
      // Step 2: import with mappings
      const result = await importFromExternalSheet(env, sheetUrl, mappings);
      return Response.json(result);
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
