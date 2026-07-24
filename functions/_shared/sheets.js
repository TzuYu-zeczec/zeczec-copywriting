/**
 * Google Sheets 操作模組
 */
import { getAccessToken } from './google-auth.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

async function sheetsRequest(env, path, options = {}) {
  const token = await getAccessToken(env);
  const res = await fetch(`${SHEETS_API}/${env.GOOGLE_SHEET_ID}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error: ${res.status} ${err}`);
  }
  return res.json();
}

// === Products ===

const PRODUCT_COLUMNS = [
  'id', 'name', 'one_liner', 'category', 'selling_points', 'specs',
  'original_price', 'early_bird_price', 'plans', 'installment_info',
  'core_audience', 'secondary_audience', 'current_alternatives', 'competitors',
  'main_advantage', 'main_weakness', 'certifications', 'kol_coverage',
  'testimonials', 'milestones', 'brand_story', 'desired_feeling',
  'best_scenario', 'favorite_point', 'platform', 'project_url',
  'launch_date', 'end_date', 'discount_code', 'exclusive_perks',
  'status', 'created_by', 'created_at', 'updated_at', 'sheet_url'
];

function rowToProduct(row) {
  const product = {};
  PRODUCT_COLUMNS.forEach((col, i) => {
    product[col] = row[i] || '';
  });
  return product;
}

function productToRow(product) {
  return PRODUCT_COLUMNS.map(col => product[col] || '');
}

export async function listProducts(env) {
  const data = await sheetsRequest(env, '/values/Products!A2:AI100000');
  const rows = data.values || [];
  return rows.map(rowToProduct).filter(p => p.id && p.name);
}

export async function getProduct(env, id) {
  const products = await listProducts(env);
  return products.find(p => p.id === id) || null;
}

export async function createProduct(env, product, userEmail) {
  product.id = 'P' + Date.now().toString(36);
  product.created_by = userEmail || '';
  product.created_at = new Date().toISOString();
  product.updated_at = new Date().toISOString();
  product.platform = product.platform || 'zeczec';

  const row = productToRow(product);
  // 明確寫到下一個空白列（A{n}:AI{n}），不用 append 自動偵測欄位位置 ——
  // append 偶爾會把整列「猜歪」推到右邊欄位（id 跑到 A 欄以外），導致系統讀不到、Sheet 看似空白。
  const colA = await sheetsRequest(env, '/values/Products!A2:A100000');
  const nextRow = (colA.values ? colA.values.length : 0) + 2;
  await sheetsRequest(env, `/values/Products!A${nextRow}:AI${nextRow}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] })
  });
  return product;
}

export async function updateProduct(env, id, updates) {
  // Find the row number
  const data = await sheetsRequest(env, '/values/Products!A2:A100000');
  const ids = (data.values || []).map(r => r[0]);
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) throw new Error('Product not found');

  const rowNum = rowIndex + 2; // 1-indexed, skip header
  const existing = await sheetsRequest(env, `/values/Products!A${rowNum}:AI${rowNum}`);
  const currentRow = (existing.values || [[]])[0];
  const current = rowToProduct(currentRow);

  // Merge updates
  Object.assign(current, updates);
  current.updated_at = new Date().toISOString();
  const newRow = productToRow(current);

  await sheetsRequest(env, `/values/Products!A${rowNum}:AI${rowNum}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [newRow] })
  });
  return current;
}

export async function deleteProduct(env, id) {
  const data = await sheetsRequest(env, '/values/Products!A2:A100000');
  const ids = (data.values || []).map(r => r[0]);
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) throw new Error('Product not found');

  // Clear the row (Sheets API doesn't support row deletion via values API easily)
  const rowNum = rowIndex + 2;
  const emptyRow = PRODUCT_COLUMNS.map(() => '');
  await sheetsRequest(env, `/values/Products!A${rowNum}:AI${rowNum}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [emptyRow] })
  });
  return { success: true };
}

// === Generations ===

const GEN_COLUMNS = [
  'id', 'product_id', 'product_name', 'skill_type', 'user_prompt',
  'output_content', 'conversation', 'revision_count',
  'input_tokens', 'output_tokens', 'generated_by', 'status', 'created_at'
];

function rowToGeneration(row) {
  const gen = {};
  GEN_COLUMNS.forEach((col, i) => {
    gen[col] = row[i] || '';
  });
  // Parse numbers
  gen.revision_count = parseInt(gen.revision_count) || 0;
  gen.input_tokens = parseInt(gen.input_tokens) || 0;
  gen.output_tokens = parseInt(gen.output_tokens) || 0;
  return gen;
}

export async function listGenerations(env, filters = {}, opts = {}) {
  let rows;
  if (opts.lite) {
    // 列表輕量化：用 batchGet 只取 A:E 與 H:M，刻意略過最肥的 output_content(F) 與 conversation(G)，
    // 這兩欄只有「查看詳情」時才需要。大幅縮小傳輸量與解析時間。
    const data = await sheetsRequest(env,
      '/values:batchGet?ranges=' + encodeURIComponent('Generations!A2:E100000') +
      '&ranges=' + encodeURIComponent('Generations!H2:M100000'));
    const left = (data.valueRanges && data.valueRanges[0] && data.valueRanges[0].values) || [];  // A..E
    const right = (data.valueRanges && data.valueRanges[1] && data.valueRanges[1].values) || []; // H..M
    const n = Math.max(left.length, right.length);
    rows = [];
    for (let i = 0; i < n; i++) {
      const l = left[i] || [], r = right[i] || [];
      const id = l[0] || '';
      if (!id) continue;
      rows.push({
        id,
        product_id: l[1] || '',
        product_name: l[2] || '',
        skill_type: l[3] || '',
        user_prompt: l[4] || '',
        revision_count: parseInt(r[0]) || 0,
        input_tokens: parseInt(r[1]) || 0,
        output_tokens: parseInt(r[2]) || 0,
        generated_by: r[3] || '',
        status: r[4] || '',
        created_at: r[5] || ''
      });
    }
  } else {
    const data = await sheetsRequest(env, '/values/Generations!A2:M100000');
    rows = (data.values || []).map(rowToGeneration).filter(g => g.id);
  }

  if (filters.productId) rows = rows.filter(g => g.product_id === filters.productId);
  if (filters.skillType) rows = rows.filter(g => g.skill_type === filters.skillType);
  if (filters.generatedBy !== undefined) {
    const target = (filters.generatedBy || '').toLowerCase();
    rows = rows.filter(g => (g.generated_by || '').toLowerCase() === target);
  }

  // Sort by created_at descending
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rows;
}

// 只取「使用者 email 清單」（管理員下拉用）。只讀 K 欄，極輕量。
export async function listGenerationUsers(env) {
  const data = await sheetsRequest(env, '/values/Generations!K2:K100000');
  const set = new Set((data.values || []).map(r => (r[0] || '').toLowerCase()).filter(Boolean));
  return [...set].sort();
}

export async function getGeneration(env, id) {
  // 先只讀 id 欄（A）找出列號，再單獨讀那一列 A:M，避免把整張表的 output_content 全抓回來
  const idData = await sheetsRequest(env, '/values/Generations!A2:A100000');
  const ids = (idData.values || []).map(r => r[0] || '');
  const idx = ids.indexOf(id);
  if (idx === -1) return null;
  const rowNum = idx + 2; // 資料從 A2 起算
  const rowData = await sheetsRequest(env, `/values/Generations!A${rowNum}:M${rowNum}`);
  const row = (rowData.values && rowData.values[0]) || null;
  return row ? rowToGeneration(row) : null;
}

export async function saveGeneration(env, gen, userEmail) {
  gen.id = 'G' + Date.now().toString(36);
  gen.generated_by = userEmail || '';
  gen.created_at = new Date().toISOString();
  gen.status = 'completed';

  const row = GEN_COLUMNS.map(col => {
    const val = gen[col];
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val || '');
  });

  // 同 createProduct：明確寫到下一個空白列，避免 append 把整列寫歪到右邊欄位
  const colA = await sheetsRequest(env, '/values/Generations!A2:A100000');
  const nextRow = (colA.values ? colA.values.length : 0) + 2;
  await sheetsRequest(env, `/values/Generations!A${nextRow}:M${nextRow}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] })
  });
  return gen;
}

// === External Sheet Import ===

export async function readExternalSheet(env, sheetUrl) {
  // Extract sheet ID from URL
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('無效的 Google Sheet 連結');
  const sheetId = match[1];

  const token = await getAccessToken(env);
  const res = await fetch(`${SHEETS_API}/${sheetId}/values/Sheet1!1:2`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 403 || res.status === 404) {
      throw new Error('無法讀取此 Sheet，請確認已共享給 Service Account');
    }
    throw new Error(`讀取 Sheet 失敗：${err}`);
  }

  const data = await res.json();
  const headers = (data.values || [[]])[0] || [];
  const firstRow = (data.values || [[], []])[1] || [];

  // Auto-detect column mappings
  const detectedColumns = headers.map((header, i) => {
    const h = header.toLowerCase().trim();
    let mapped = '';
    if (h.includes('產品名') || h.includes('名稱') || h === 'name') mapped = 'name';
    else if (h.includes('一句話') || h.includes('slogan') || h === 'one_liner') mapped = 'one_liner';
    else if (h.includes('賣點') || h.includes('selling') || h.includes('特色')) mapped = 'selling_points';
    else if (h.includes('受眾') || h.includes('audience') || h.includes('目標')) mapped = 'core_audience';
    else if (h.includes('競品') || h.includes('competitor')) mapped = 'competitors';
    else if (h.includes('優勢') || h.includes('advantage')) mapped = 'main_advantage';
    else if (h.includes('品牌') || h.includes('brand')) mapped = 'brand_story';
    else if (h.includes('類別') || h.includes('category')) mapped = 'category';
    else if (h.includes('規格') || h.includes('spec')) mapped = 'specs';
    return {
      sheetColumn: header,
      sampleValue: firstRow[i] || '',
      mapped
    };
  });

  return { sheetId, detectedColumns };
}

export async function importFromExternalSheet(env, sheetUrl, mappings) {
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('無效的 Google Sheet 連結');
  const sheetId = match[1];

  const token = await getAccessToken(env);
  const res = await fetch(`${SHEETS_API}/${sheetId}/values/Sheet1!A:ZZ`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) throw new Error('讀取 Sheet 失敗');
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) throw new Error('Sheet 中沒有資料列');

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Map columns
  const products = [];
  for (const row of dataRows) {
    const product = { sheet_url: sheetUrl };
    let hasData = false;
    for (const [sheetCol, targetField] of Object.entries(mappings)) {
      const colIndex = headers.indexOf(sheetCol);
      if (colIndex >= 0 && row[colIndex]) {
        product[targetField] = row[colIndex];
        hasData = true;
      }
    }
    if (hasData && product.name) products.push(product);
  }

  // Create each product
  const created = [];
  for (const p of products) {
    const saved = await createProduct(env, p);
    created.push(saved);
  }

  return { imported: created.length, products: created };
}
