/**
 * 通用文案產出器 — 由各分頁設定 window.TASK_CONFIG 驅動
 * TASK_CONFIG = { skillKey: 'launch-countdown', title: '開賣倒數', desc: '...', placeholder: '...' }
 * 流程：選產品 → 串流產文案（含自動續寫）→ 存到 Google Doc
 */
(function () {
  const CFG = window.TASK_CONFIG || {};

  // === State ===
  let selectedProductId = '';
  let products = [];
  let conversationHistory = [];
  let latestOutput = '';
  let isStreaming = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let autoContinueCount = 0;
  const MAX_AUTO_CONTINUE = 5;
  let autoScroll = true;     // 自動跟著生成往下捲；使用者往上捲就暫停
  let genStartTime = 0;      // 本次產出開始時間（含自動續寫）
  let currentController = null; // 目前串流的 AbortController（供「停止產生」用）
  let stopRequested = false;    // 使用者是否按下停止

  // === Styles（集中注入避免每頁重複） ===
  function injectStyles() {
    const css = `
      .revision-input { display: flex; gap: 8px; margin-top: 16px; align-items: flex-end; }
      .revision-input textarea { flex: 1; resize: none; min-height: 44px; max-height: 200px; line-height: 1.5; overflow-y: auto; }
      .token-info { font-size: 12px; color: var(--text-faint); margin-top: 8px; }
      .output-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      .drive-result { margin-top: 12px; padding: 12px 16px; background: var(--brand-tint); border-radius: var(--radius); font-size: 14px; }
      .drive-result a { color: var(--brand-hover); font-weight: 700; text-decoration: none; }
      .drive-result a:hover { text-decoration: underline; }
      .msg-time { font-size: 12px; color: var(--text-faint); margin-top: 8px; }
      .gen-indicator {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
        background: var(--ink); color: #fff; padding: 9px 18px; border-radius: 999px;
        font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 9px;
        box-shadow: var(--shadow-pop); z-index: 200;
      }
      .gen-indicator.hidden { display: none; }
      .gen-indicator .gen-dot {
        width: 8px; height: 8px; border-radius: 50%; background: var(--brand);
        animation: genpulse 1s ease-in-out infinite;
      }
      @keyframes genpulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
      .gen-stop-btn {
        margin-left: 6px; background: rgba(255,255,255,0.18); color: #fff;
        border: 1px solid rgba(255,255,255,0.5); border-radius: 999px;
        padding: 3px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px; transition: background .15s;
      }
      .gen-stop-btn:hover { background: rgba(255,255,255,0.32); }
      .gen-stop-btn svg { width: 11px; height: 11px; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // === Render main content ===
  function renderMain() {
    const main = document.getElementById('task-main');
    main.innerHTML = `
      <div class="page-header">
        <div>
          ${CFG.eyebrow ? `<div class="page-header__eyebrow">${esc(CFG.eyebrow)}</div>` : ''}
          <h1 class="page-title">${esc(CFG.title || '文案產出')}</h1>
          ${CFG.desc ? `<div class="page-subtitle">${esc(CFG.desc)}</div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="runner-input">
          <div class="form-group">
            <label class="form-label">選擇產品 <span class="req">*</span></label>
            <select class="select" id="product-select"><option value="">載入中...</option></select>
          </div>
          <div class="form-group">
            <label class="form-label">補充指令 <span class="optional">選填</span></label>
            <textarea class="textarea" id="user-prompt" rows="3" placeholder="${esc(CFG.placeholder || '例：語氣輕鬆一點、目標受眾是年輕上班族…')}"></textarea>
          </div>
          <div style="text-align:right">
            <button class="btn btn-primary btn-lg" id="generate-btn" onclick="TaskRunner.startGenerate()">✎ 開始產出</button>
          </div>
        </div>
      </div>

      <div class="output-area">
        <div class="output-area__bar">
          <div class="output-area__title">
            <strong>產出結果</strong>
            <span id="status-badge" class="output-status"><span class="dot"></span>等待產出</span>
          </div>
        </div>
        <div class="output-area__body">
          <div id="conversation" class="conversation">
            <div class="empty-state" style="border:none;box-shadow:none;padding:40px 20px;">
              <div class="empty-state__ico">✎</div>
              <div class="empty-state__title">選擇產品後開始產出</div>
              <div class="empty-state__text">AI 會根據產品資訊和文案方法論，產出符合風格的文案</div>
            </div>
          </div>

          <div id="revision-area" class="hidden">
            <div class="revision-input">
              <textarea id="revision-input" rows="1" placeholder="輸入修改指令，例：「語氣再強烈一點」「加入價格比較」（Enter 送出 · Shift+Enter 換行）"></textarea>
              <button class="btn btn-primary" onclick="TaskRunner.sendRevision()">修改</button>
            </div>
            <div class="output-actions">
              <button class="btn btn-sm btn-dark" onclick="TaskRunner.saveToDrive()" id="drive-btn">存到 Google Doc</button>
              <a class="btn btn-sm btn-outline" href="https://drive.google.com/drive/folders/13T6Fpdd4Z66Vz3RrRKybzbUGQB36ZcCM?usp=drive_link" target="_blank" rel="noopener">前往雲端</a>
              <button class="btn btn-sm btn-outline" onclick="TaskRunner.copyOutput()">⧉ 複製文案</button>
              <button class="btn btn-sm btn-ghost" onclick="TaskRunner.resetConversation()">重新開始</button>
            </div>
            <div id="drive-result" class="drive-result hidden"></div>
            <div class="token-info" id="token-info"></div>
          </div>
        </div>
      </div>

      <div id="gen-indicator" class="gen-indicator hidden">
        <span class="gen-dot"></span> 文案生成中…
        <button class="gen-stop-btn" onclick="TaskRunner.stopGenerate()" title="停止產生">■ 停止產生</button>
      </div>`;
  }

  function esc(s) { return UI.escapeHtml(s || ''); }
  function $(id) { return document.getElementById(id); }

  // === Init ===
  async function init() {
    injectStyles();
    renderMain();
    setupRevisionInput();
    // 使用者往上捲動就暫停自動跟隨；回到接近底部時恢復
    window.addEventListener('scroll', () => {
      const dist = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      autoScroll = dist < 80;
    }, { passive: true });
    $('product-select').addEventListener('change', onProductChange);
    await loadProducts();
    const pre = UI.getUrlParam('productId');
    if (pre && products.some(p => p.id === pre)) {
      $('product-select').value = pre;
      onProductChange();
    }
  }

  async function loadProducts() {
    const sel = $('product-select');
    try {
      const data = await API.listProducts();
      products = data.products || [];
      if (!products.length) {
        sel.innerHTML = '<option value="">尚無產品，請先到產品列表新增</option>';
        return;
      }
      sel.innerHTML = '<option value="">請選擇產品…</option>' +
        products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">載入失敗</option>';
      UI.toast(e.message, 'error');
    }
  }

  function onProductChange() {
    selectedProductId = $('product-select').value;
  }

  function getProductName() {
    const p = products.find(x => x.id === selectedProductId);
    return p ? p.name : '產品';
  }

  function setupRevisionInput() {
    const input = $('revision-input');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendRevision();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
  }

  // === Generation ===
  function startGenerate() {
    if (!selectedProductId) { UI.toast('請先選擇產品', 'error'); return; }
    if (isStreaming) return;

    const prompt = $('user-prompt').value.trim();
    conversationHistory = [];
    latestOutput = '';
    $('conversation').innerHTML = '';
    totalInputTokens = 0;
    totalOutputTokens = 0;
    autoContinueCount = 0;
    autoScroll = true;
    stopRequested = false;
    genStartTime = Date.now();
    $('drive-result').classList.add('hidden');

    if (prompt) {
      appendMessage('user', prompt);
      conversationHistory.push({ role: 'user', content: prompt });
    }
    appendStreamingMessage();
    setStreaming(true);

    streamWithAutoContinue({
      productId: selectedProductId,
      skillName: CFG.skillKey,
      prompt: prompt || `請根據產品資訊，使用「${CFG.title}」方法論產出文案。`,
      conversationHistory: []
    });
  }

  // 被截斷時自動續寫（不清空 latestOutput，畫面持續累積、不閃斷）
  function streamWithAutoContinue(params) {
    const callbacks = {
      onToken(text) {
        latestOutput += text;
        updateStreamingMessage(latestOutput);
      },
      onDone() {
        finalizeStreamingMessage();
        conversationHistory.push({ role: 'assistant', content: latestOutput });
        setStreaming(false);
        $('revision-area').classList.remove('hidden');
        updateTokenInfo();
      },
      onTruncated() {
        // 使用者已按停止，就不要再自動續寫
        if (stopRequested) { finishStopped(); return; }
        if (autoContinueCount >= MAX_AUTO_CONTINUE) {
          finalizeStreamingMessage();
          conversationHistory.push({ role: 'assistant', content: latestOutput });
          setStreaming(false);
          $('revision-area').classList.remove('hidden');
          UI.toast('已達續寫上限，可手動輸入「繼續」來延續', 'error');
          updateTokenInfo();
          return;
        }
        autoContinueCount++;
        $('status-badge').innerHTML = `<div class="loading-spinner" style="width:14px;height:14px;"></div> 續寫中（${autoContinueCount}/${MAX_AUTO_CONTINUE}）`;
        const continueHistory = (params.conversationHistory || []).concat([
          { role: 'user', content: params.prompt },
          { role: 'assistant', content: latestOutput }
        ]);
        const continuePrompt = '繼續，從你剛才中斷的地方接著寫，不要重複已經寫過的內容，也不要加任何開場白。';
        currentController = API.streamGenerate({
          productId: params.productId,
          skillName: params.skillName,
          prompt: continuePrompt,
          conversationHistory: continueHistory
        }, callbacks);
      },
      onError(err) {
        finalizeStreamingMessage();
        UI.toast('產出錯誤：' + err, 'error');
        setStreaming(false);
      },
      onAbort() {
        finishStopped();
      },
      onMeta(msg) {
        if (msg && msg.usage) {
          totalInputTokens += msg.usage.input_tokens || 0;
          totalOutputTokens += msg.usage.output_tokens || 0;
        }
      }
    };
    currentController = API.streamGenerate(params, callbacks);
  }

  // 使用者按「停止產生」：中止串流，保留已產出的部分
  function stopGenerate() {
    if (!isStreaming || stopRequested) return;
    stopRequested = true;
    $('status-badge').textContent = '停止中…';
    if (currentController) currentController.abort();
  }

  // 串流被中止後的收尾：保留目前已產出的文字
  function finishStopped() {
    finalizeStreamingMessage();
    if (latestOutput) conversationHistory.push({ role: 'assistant', content: latestOutput });
    setStreaming(false);
    $('revision-area').classList.remove('hidden');
    $('status-badge').textContent = '已停止';
    updateTokenInfo();
    UI.toast('已停止產生，保留目前內容', 'success');
  }

  function sendRevision() {
    const input = $('revision-input');
    const prompt = input.value.trim();
    if (!prompt || isStreaming) return;

    input.value = '';
    input.style.height = 'auto';
    appendMessage('user', prompt);
    const priorHistory = conversationHistory.slice();
    conversationHistory.push({ role: 'user', content: prompt });
    latestOutput = '';
    autoContinueCount = 0;
    autoScroll = true;
    stopRequested = false;
    genStartTime = Date.now();
    appendStreamingMessage();
    setStreaming(true);

    streamWithAutoContinue({
      productId: selectedProductId,
      skillName: CFG.skillKey,
      prompt,
      conversationHistory: priorHistory
    });
  }

  // === UI Helpers ===
  function scrollToBottomIfAuto() {
    if (autoScroll) window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function appendMessage(role, content) {
    const convEl = $('conversation');
    const div = document.createElement('div');
    div.className = `message message-${role === 'user' ? 'user' : 'ai'}`;
    div.innerHTML = `<div class="message-label">${role === 'user' ? '你' : 'AI'}</div><div class="message-content">${esc(content)}</div>`;
    convEl.appendChild(div);
    scrollToBottomIfAuto();
  }

  function appendStreamingMessage() {
    const convEl = $('conversation');
    const div = document.createElement('div');
    div.className = 'message message-ai';
    div.id = 'streaming-msg';
    div.innerHTML = `<div class="message-label">AI</div><div class="message-content"><span class="stream-text"></span><span class="cursor-blink"></span></div>`;
    convEl.appendChild(div);
    scrollToBottomIfAuto();
  }

  function updateStreamingMessage(text) {
    const el = document.querySelector('#streaming-msg .stream-text');
    if (el) {
      el.textContent = text;
      scrollToBottomIfAuto();
    }
  }

  function finalizeStreamingMessage() {
    const cursor = document.querySelector('#streaming-msg .cursor-blink');
    if (cursor) cursor.remove();
    const msg = $('streaming-msg');
    if (msg) {
      msg.removeAttribute('id');
      if (!msg.querySelector('.msg-time')) {
        const t = document.createElement('div');
        t.className = 'msg-time';
        const dur = genStartTime ? '（耗時 ' + formatDuration(Date.now() - genStartTime) + '）' : '';
        t.textContent = '產出時間：' + formatNow() + dur;
        msg.appendChild(t);
      }
    }
  }

  function formatNow() {
    return new Date().toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function formatDuration(ms) {
    const sec = Math.max(1, Math.round(ms / 1000));
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m} 分 ${s} 秒` : `${m} 分`;
  }

  function setStreaming(streaming) {
    isStreaming = streaming;
    const btn = $('generate-btn');
    const badge = $('status-badge');
    const indicator = $('gen-indicator');
    if (indicator) indicator.classList.toggle('hidden', !streaming);
    if (streaming) {
      btn.disabled = true;
      btn.innerHTML = '<div class="loading-spinner"></div> 產出中...';
      badge.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;"></div> 產出中';
    } else {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 開始產出`;
      badge.textContent = '產出完成';
    }
  }

  function updateTokenInfo() {
    $('token-info').textContent =
      `Token 使用量：輸入 ${totalInputTokens.toLocaleString()} / 輸出 ${totalOutputTokens.toLocaleString()} | 修改次數：${conversationHistory.filter(m => m.role === 'user').length}`;
  }

  function copyOutput() {
    const lastAi = conversationHistory.filter(m => m.role === 'assistant').pop();
    if (!lastAi) { UI.toast('沒有可複製的內容', 'error'); return; }
    navigator.clipboard.writeText(lastAi.content)
      .then(() => UI.toast('已複製到剪貼簿', 'success'))
      .catch(() => UI.toast('複製失敗', 'error'));
  }

  async function saveToDrive() {
    const lastAi = conversationHistory.filter(m => m.role === 'assistant').pop();
    if (!lastAi) { UI.toast('沒有可儲存的內容', 'error'); return; }

    const btn = $('drive-btn');
    const resultEl = $('drive-result');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;"></div> 儲存中...';

    try {
      const data = await API.saveToDrive(lastAi.content, getProductName(), CFG.title || '文案');
      resultEl.innerHTML = `✅ 已存到 Google Doc — <a href="${data.docUrl}" target="_blank">開啟「${esc(data.title)}」</a>（可在 Google Docs「下載成 .docx」）`;
      resultEl.classList.remove('hidden');
      UI.toast('已存到 Google Doc', 'success');
    } catch (e) {
      UI.toast('儲存失敗：' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> 存到 Google Doc`;
    }
  }

  function resetConversation() {
    if (isStreaming) return;
    if (!UI.confirm('確定要重新開始嗎？目前的對話紀錄會被清除。')) return;
    conversationHistory = [];
    latestOutput = '';
    totalInputTokens = 0;
    totalOutputTokens = 0;
    $('conversation').innerHTML = `
      <div class="empty-state" style="border:none;box-shadow:none;padding:40px 20px;">
        <div class="empty-state__ico">✎</div>
        <div class="empty-state__title">選擇產品後開始產出</div>
        <div class="empty-state__text">AI 會根據產品資訊和文案方法論，產出符合風格的文案</div>
      </div>`;
    $('revision-area').classList.add('hidden');
    $('drive-result').classList.add('hidden');
    $('status-badge').innerHTML = '<span class="dot"></span>等待產出';
    $('token-info').textContent = '';
  }

  // Expose for inline onclick handlers
  window.TaskRunner = { startGenerate, sendRevision, stopGenerate, saveToDrive, copyOutput, resetConversation };

  document.addEventListener('DOMContentLoaded', init);
})();
