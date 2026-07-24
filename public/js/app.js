/**
 * 嘖嘖線上文案系統 - 共用 JS 模組
 */

const API = {
  // === Products ===
  async listProducts() {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('無法載入產品列表');
    return res.json();
  },

  async getProduct(id) {
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) throw new Error('無法載入產品資料');
    return res.json();
  },

  async saveProduct(data) {
    const isNew = !data.id;
    const res = await fetch('/api/products' + (isNew ? '' : `/${data.id}`), {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '儲存失敗');
    }
    return res.json();
  },

  async deleteProduct(id) {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('刪除失敗');
    return res.json();
  },

  // === Extract product from uploaded files ===
  async extractProduct(files) {
    const res = await fetch('/api/extract-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '檔案匯入失敗');
    }
    return res.json();
  },

  // === Smart-merge new data into an existing product ===
  async mergeProduct(existing, files) {
    const res = await fetch('/api/merge-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ existing, files })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '智慧合併失敗');
    }
    return res.json();
  },

  // === Import from Google Sheet ===
  async importFromSheet(sheetUrl, mappings) {
    const res = await fetch('/api/sheets-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl, mappings })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '匯入失敗');
    }
    return res.json();
  },

  // === Skills ===
  async listSkills() {
    const res = await fetch('/api/skills');
    if (!res.ok) throw new Error('無法載入 Skills');
    return res.json();
  },

  async getSkill(fileId) {
    const res = await fetch(`/api/skills/${fileId}`);
    if (!res.ok) throw new Error('無法載入 Skill 內容');
    return res.json();
  },

  // === Generation (SSE streaming) ===
  // 回傳 AbortController，呼叫端可用 controller.abort() 中途停止
  streamGenerate({ productId, skillType, skillName, prompt, conversationHistory }, callbacks) {
    const { onToken, onDone, onError, onMeta, onTruncated } = callbacks;
    const body = JSON.stringify({ productId, skillType, skillName, prompt, conversationHistory });
    const controller = new AbortController();
    let stopReason = 'end_turn';
    let finished = false;
    // 確保串流結束只觸發一次（後端會送 message_stop 又送 [DONE]，避免重複觸發續寫）
    function finish() {
      if (finished) return;
      finished = true;
      if (stopReason === 'max_tokens' && onTruncated) onTruncated();
      else onDone();
    }

    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    }).then(response => {
      if (!response.ok) {
        response.text().then(t => {
          let msg = '';
          try { msg = JSON.parse(t).error || ''; } catch (_) {}
          onError(msg || `伺服器回應 ${response.status}：${(t || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 150) || '無訊息'}`);
        }).catch(() => onError(`伺服器回應 ${response.status}`));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            finish();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                finish();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta') {
                  onToken(parsed.delta?.text || '');
                } else if (parsed.type === 'message_start') {
                  if (onMeta) onMeta(parsed.message);
                } else if (parsed.type === 'message_delta') {
                  // Capture stop_reason from message_delta
                  if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
                  if (parsed.usage && onMeta) onMeta({ usage: parsed.usage });
                } else if (parsed.type === 'message_stop') {
                  finish();
                } else if (parsed.type === 'error') {
                  onError((parsed.error && (parsed.error.message || JSON.stringify(parsed.error))) || '產出錯誤');
                }
              } catch (e) {}
            }
          }
          read();
        }).catch(err => {
          if (err.name === 'AbortError') { if (callbacks.onAbort) callbacks.onAbort(); return; }
          onError(err.message);
        });
      }
      read();
    }).catch(err => {
      if (err.name === 'AbortError') { if (callbacks.onAbort) callbacks.onAbort(); return; }
      onError(err.message);
    });

    return controller;
  },

  // === Survey (問卷系統) ===
  // 分階段串流產出：stage = 'copy' | 'html'
  streamSurvey({ productId, platform, stage }, callbacks) {
    const { onToken, onDone, onError } = callbacks;
    fetch('/api/generate-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, platform, stage })
    }).then(response => {
      if (!response.ok) {
        response.text().then(t => {
          let msg = '';
          try { msg = JSON.parse(t).error || ''; } catch (_) {}
          onError(msg || `伺服器回應 ${response.status}：${(t || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 150) || '無訊息'}`);
        }).catch(() => onError(`伺服器回應 ${response.status}`));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { onDone(); return; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') { onDone(); return; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') onToken(parsed.delta?.text || '');
              else if (parsed.type === 'error') onError((parsed.error && (parsed.error.message || JSON.stringify(parsed.error))) || '產出錯誤');
            } catch (e) {}
          }
          read();
        }).catch(err => onError(err.message));
      }
      read();
    }).catch(err => onError(err.message));
  },

  async saveToDrive(content, productName, skillName) {
    const res = await fetch('/api/save-to-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, productName, skillName })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '存到 Google Drive 失敗');
    }
    return res.json();
  },

  async saveHtml(html, productName, platform) {
    const res = await fetch('/api/save-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, productName, platform })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '存 HTML 失敗');
    }
    return res.json();
  },

  async createTypeform(content, productName) {
    const res = await fetch('/api/create-typeform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, productName })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '建立 Typeform 失敗');
    }
    return res.json();
  },

  // === History ===
  async listGenerations(filters = {}) {
    const params = new URLSearchParams();
    if (filters.productId) params.set('productId', filters.productId);
    if (filters.skillType) params.set('skillType', filters.skillType);
    if (filters.generatedBy) params.set('generatedBy', filters.generatedBy);
    if (filters.withUsers) params.set('withUsers', '1'); // 管理員第一次載入才抓使用者清單
    const res = await fetch('/api/history?' + params.toString());
    if (!res.ok) throw new Error('無法載入歷史紀錄');
    return res.json();
  },

  async getGeneration(id) {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) throw new Error('無法載入產出紀錄');
    return res.json();
  },

  // === Memory ===
  async listMemory() {
    const res = await fetch('/api/memory');
    if (!res.ok) throw new Error('無法載入 Memory');
    return res.json();
  },

  // === Token 使用量（管理員）===
  async getUsage(month) {
    const qs = month ? ('?month=' + encodeURIComponent(month)) : '';
    const res = await fetch('/api/usage' + qs);
    if (res.status === 403) throw new Error('FORBIDDEN');
    if (!res.ok) throw new Error('無法載入使用量');
    return res.json();
  }
};

// === 登入身分（Cloudflare Access）===
// 透過 Access 的 get-identity 端點取得目前登入者 email；未啟用 Access 時回空字串。
let _identityCache;
async function getCurrentUserEmail() {
  if (_identityCache !== undefined) return _identityCache;
  try {
    const res = await fetch('/cdn-cgi/access/get-identity', { headers: { Accept: 'application/json' } });
    if (!res.ok) { _identityCache = ''; return ''; }
    const data = await res.json();
    _identityCache = (data.email || '').toLowerCase();
  } catch {
    _identityCache = '';
  }
  return _identityCache;
}

// === UI Utilities ===
const UI = {
  toast(message, type = 'default') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    if (type === 'error') {
      // 錯誤訊息：不自動關閉，附右上角 × 關閉鈕，由使用者主動確認後關閉
      const msg = document.createElement('span');
      msg.className = 'toast-msg';
      msg.textContent = message;
      const close = document.createElement('button');
      close.className = 'toast-close';
      close.setAttribute('aria-label', '關閉');
      close.innerHTML = '&times;';
      close.onclick = () => el.remove();
      el.appendChild(msg);
      el.appendChild(close);
      document.body.appendChild(el);
    } else {
      el.textContent = message;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  },

  showLoading(container) {
    container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div><p class="mt-2">載入中...</p></div>`;
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  truncate(str, len = 50) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  },

  getUrlParam(key) {
    return new URLSearchParams(window.location.search).get(key);
  },

  confirm(message) {
    return window.confirm(message);
  }
};

// === Skill name mapping ===
const SKILL_NAMES = {
  'batch-social-posts': '社群貼文批量產出',
  'closing-countdown': '結案倒數文案',
  'competitor-analysis': '競品分析',
  'copy-style-guide': '文案風格指南',
  'copywriting-framework': '文案基礎邏輯',
  'crowdfunding-post': '募資貼文撰寫',
  'crowdfunding-survey': '募資前測問卷',
  'launch-countdown': '開賣倒數宣傳',
  'media-guide': '媒體投放指引',
  'page-copy-framework': '頁面文案框架'
};

// === Sidebar (single source of truth)：group 用來畫 nav-group-label 分組線 ===
const NAV_ITEMS = [
  { href: '/index.html', label: '產品列表', icon: '▦' },
  { href: '/positioning.html', label: '產品定位策略', icon: '◎', group: '策略' },
  { href: '/media.html', label: '媒體指引', icon: '✎', group: '策略' },
  { href: '/survey.html', label: '問卷系統', icon: '☑', group: '檔期產出' },
  { href: '/presale.html', label: '開賣倒數', icon: '⚑', group: '檔期產出' },
  { href: '/social.html', label: '大量社群貼文', icon: '▤', group: '檔期產出' },
  { href: '/closing.html', label: '結案倒數', icon: '⚐', group: '檔期產出' },
  { href: '/campaign.html', label: '募資頁面', icon: '◧', group: '檔期產出' },
  { href: '/history.html', label: '產出紀錄', icon: '◷', group: '記錄' },
  { href: '/admin.html', label: '管理', adminOnly: true, icon: '⚙', group: '記錄' }
];

// 管理員 email（只有這些帳號看得到「管理」標籤、能讀使用量）
const ADMIN_EMAILS = ['jerry@zeczec.com'];

// 正規化路徑做 active 比對：去掉 .html、把 '/' 與 '' 視為 index（Cloudflare Pages 用無副檔名乾淨網址）
function normalizePath(p) {
  p = (p || '').replace(/\.html$/, '');
  if (p === '/' || p === '') p = '/index';
  return p;
}

async function renderSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const current = normalizePath(window.location.pathname);
  const email = await getCurrentUserEmail();
  const isAdmin = ADMIN_EMAILS.includes(email);
  const items = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  // 依 group 依序輸出，同組相鄰才印一次分組標題
  let lastGroup;
  const navHtml = items.map(item => {
    let label = '';
    if (item.group && item.group !== lastGroup) label = `<div class="nav-group-label">${UI.escapeHtml(item.group)}</div>`;
    lastGroup = item.group;
    const active = normalizePath(item.href) === current ? ' is-active' : '';
    return `${label}<a href="${item.href}" class="nav-item${active}"><span class="nav-ico">${item.icon}</span>${item.label}</a>`;
  }).join('');

  el.innerHTML = `
    <div class="sidebar__brand">
      <div class="sidebar__logo">嘖</div>
      <div>
        <div class="sidebar__brand-name">線上文案系統</div>
        <div class="sidebar__brand-sub">COPYWRITING</div>
      </div>
    </div>
    <nav style="display:contents">${navHtml}</nav>
    <div class="sidebar__spacer"></div>
    <div class="sidebar__footer">
      ${email ? `<div class="sidebar__user">${UI.escapeHtml(email)}</div>` : ''}
      <a class="nav-item" href="https://drive.google.com/drive/folders/13T6Fpdd4Z66Vz3RrRKybzbUGQB36ZcCM" target="_blank" rel="noopener"><span class="nav-ico">🗀</span>文案生成資料夾 ↗</a>
      <a class="nav-item" href="/cdn-cgi/access/logout"><span class="nav-ico">⇥</span>登出</a>
    </div>`;

  setupMobileNav();
}

// 行動裝置：main-content 內插入固定頂列（品牌 + 漢堡），標題取自 <title>「X — 嘖嘖線上文案系統」的 X
function renderTopbar() {
  const main = document.querySelector('.main-content');
  if (!main || document.querySelector('.topbar')) return;
  const title = (document.title || '').split(' — ')[0] || '嘖嘖線上文案系統';
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `
    <div class="topbar__brand">
      <div class="topbar__logo">嘖</div>
      <span class="topbar__title">${UI.escapeHtml(title)}</span>
    </div>
    <button class="topbar__menu" aria-label="選單" onclick="toggleMobileNav()">☰</button>`;
  main.insertBefore(bar, main.firstChild);
}

// 行動裝置：漢堡選單按鈕 + 背景遮罩（點選導覽或遮罩自動收合）
function setupMobileNav() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  renderTopbar();

  if (!document.getElementById('nav-backdrop')) {
    const bd = document.createElement('div');
    bd.id = 'nav-backdrop';
    bd.className = 'nav-backdrop';
    bd.onclick = closeMobileNav;
    document.body.appendChild(bd);
  }
  // 點任一導覽連結後自動收合
  sidebar.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileNav));
}

function toggleMobileNav() {
  document.getElementById('sidebar')?.classList.toggle('is-open');
  document.getElementById('nav-backdrop')?.classList.toggle('show');
}

function closeMobileNav() {
  document.getElementById('sidebar')?.classList.remove('is-open');
  document.getElementById('nav-backdrop')?.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', renderSidebar);
