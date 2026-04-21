// ═══════════════════════════════════════════════════════════════════════════
// self-docs.js · Self-documenting portal kit — portable, no framework
// ═══════════════════════════════════════════════════════════════════════════
//
// Usage:
//   <script src="self-docs.js"></script>
//   <script>
//     SelfDocs.registerPage('my-page', {
//       title: 'My Page', owner: 'admin', purpose: '...',
//       inputs:[], outputs:[], features:[], advantages:[], benefits:[],
//       agents:[], apis:[], devNotes: { rules:[], access:{}, gotchas:[], changelog:[] }
//     });
//     SelfDocs.mount('my-page');
//   </script>
//
// Requires a #page-content container (or SelfDocs.config({contentSelector}))
// and renders: UC-counter (via .topbar hook), UC-footer, TZ-footer, debug FAB.
// ═══════════════════════════════════════════════════════════════════════════

(function (window) {
  'use strict';

  // ─── CONFIG ───────────────────────────────────────────────────────────────
  const config = {
    storageKeys: {
      useCases: 'selfdocs:useCases:v1',
      feedback: 'selfdocs:feedback:v1',
      userName: 'selfdocs:user:v1',
      devMode:  'selfdocs:devMode',
      devNotes: 'selfdocs:devNotes:',
    },
    contentSelector:  '#page-content',
    topbarSelector:   '.topbar',
    currentUser:      null,        // set via SelfDocs.config({currentUser: 'Denis'})
    locale:           'en',        // 'en' | 'ru'
    storage:          'localStorage',  // 'localStorage' | custom adapter
    onFeedbackSubmit: null,        // (feedback) => {} — hook for telemetry
    onUseCaseChange:  null,        // (uc) => {}
    aiGenerateFn:     null,        // async (page) => Candidate[] — Claude API hook
  };

  const I18N = {
    en: {
      useCases: 'Use cases', addUc: '+ Add', voice: '🎙 Voice', aiGen: '✨ AI-generate',
      noUc: 'No use cases yet. Click "+ Add" or "✨ AI-generate".',
      tzTitle: 'Page Spec', purpose: 'Purpose', inputs: 'Inputs', outputs: 'Outputs',
      features: 'Features', advantages: 'Advantages', benefits: 'Benefits',
      agents: 'Agents', apis: 'APIs', owner: 'owner',
      sparse: 'Sparse spec — fields not filled. Add purpose / inputs / outputs / features.',
      debug: 'Debug', submit: '📝 Submit', history: '📋 History', code: '🔬 Code', dev: '📚 Dev Notes',
      feedbackDesc: 'What to improve or what is broken. Be specific.',
      save: '💾 Save feedback',
      rules: 'Rules & Constraints', access: 'Access & Permissions',
      gotchas: 'Gotchas (next-dev-read-this)', changelog: 'Changelog',
      addGotcha: '+ Add gotcha', noNotes: '— no notes —',
    },
    ru: {
      useCases: 'Use cases', addUc: '+ Добавить', voice: '🎙 Надиктовать', aiGen: '✨ AI-нагенерить',
      noUc: 'Пока нет UC. Нажми «+ Добавить» или «✨ AI-нагенерить».',
      tzTitle: 'ТЗ страницы', purpose: 'Назначение', inputs: 'Inputs — что приходит', outputs: 'Outputs — что уходит',
      features: 'Характеристики', advantages: 'Преимущества', benefits: 'Выгоды',
      agents: 'Агенты', apis: 'APIs', owner: 'owner',
      sparse: 'Sparse spec — поля не заполнены. Добавь purpose / inputs / outputs / features.',
      debug: 'Debug', submit: '📝 Оставить', history: '📋 История', code: '🔬 Код', dev: '📚 Dev Notes',
      feedbackDesc: 'Что улучшить / что не работает. Будь конкретен.',
      save: '💾 Сохранить фидбек',
      rules: 'Правила и констрейнты', access: 'Доступы',
      gotchas: 'Gotchas (для следующего разработчика)', changelog: 'Changelog',
      addGotcha: '+ Добавить gotcha', noNotes: '— нет заметок —',
    },
  };
  function t(key) { return (I18N[config.locale] || I18N.en)[key] || key; }

  // ─── REGISTRY ─────────────────────────────────────────────────────────────
  const PAGES = {};

  function registerPage(id, spec) {
    PAGES[id] = { id, ...spec };
    return PAGES[id];
  }

  // ─── STATUS META ──────────────────────────────────────────────────────────
  const UC_STATUS_META = {
    'passing':   { emoji: '🟢', label: 'passing',   color: '#16a34a' },
    'failing':   { emoji: '🔴', label: 'failing',   color: '#dc2626' },
    'untested':  { emoji: '⚪', label: 'untested',  color: '#94a3b8' },
    'flaky':     { emoji: '🟡', label: 'flaky',     color: '#eab308' },
    'draft':     { emoji: '🟣', label: 'draft',     color: '#a855f7' },
    'spec-only': { emoji: '🔵', label: 'spec-only', color: '#0284c7' },
  };

  // ─── STORAGE LAYER (pluggable) ────────────────────────────────────────────
  const STORAGE = {
    _read(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } },
    _write(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

    listUseCases(pageId) {
      const all = this._read(config.storageKeys.useCases);
      return pageId ? all.filter(uc => uc.pageId === pageId) : all;
    },

    saveUseCase(uc) {
      const all = this._read(config.storageKeys.useCases);
      const idx = all.findIndex(x => x.id === uc.id);
      if (idx >= 0) all[idx] = { ...all[idx], ...uc, updatedAt: new Date().toISOString() };
      else {
        const id = uc.id || `${uc.pageId}-uc-${String(all.length + 1).padStart(3, '0')}`;
        all.push({ ...uc, id, createdAt: new Date().toISOString() });
      }
      this._write(config.storageKeys.useCases, all);
      if (config.onUseCaseChange) config.onUseCaseChange(uc);
      return all;
    },

    deleteUseCase(id) {
      const all = this._read(config.storageKeys.useCases).filter(uc => uc.id !== id);
      this._write(config.storageKeys.useCases, all);
      return all;
    },

    listFeedback(pageId) {
      const all = this._read(config.storageKeys.feedback);
      return pageId ? all.filter(f => f.pageId === pageId) : all;
    },

    saveFeedback(fb) {
      const all = this._read(config.storageKeys.feedback);
      const id = fb.id || `fb-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const entry = { id, ...fb, createdAt: fb.createdAt || new Date().toISOString(), status: fb.status || 'raw' };
      all.push(entry);
      this._write(config.storageKeys.feedback, all);
      if (config.onFeedbackSubmit) config.onFeedbackSubmit(entry);
      return entry;
    },

    currentUser() {
      return config.currentUser || localStorage.getItem(config.storageKeys.userName) || 'anonymous';
    },
  };

  function ucStats(pageId) {
    const ucs = STORAGE.listUseCases(pageId);
    return {
      total:    ucs.length,
      passing:  ucs.filter(uc => uc.status === 'passing').length,
      failing:  ucs.filter(uc => uc.status === 'failing').length,
      untested: ucs.filter(uc => uc.status === 'untested').length,
      flaky:    ucs.filter(uc => uc.status === 'flaky').length,
      draft:    ucs.filter(uc => uc.status === 'draft').length,
      specOnly: ucs.filter(uc => uc.status === 'spec-only').length,
      coverage: ucs.length ? Math.round((ucs.filter(uc => uc.status === 'passing').length / ucs.length) * 100) : null,
      lastRun:  ucs.map(uc => uc.lastRun).filter(Boolean).sort().pop(),
    };
  }

  // ─── CONTEXT CAPTURE (click trail, errors, source) ────────────────────────
  function isDevMode() {
    if (new URLSearchParams(location.search).has('dev')) {
      localStorage.setItem(config.storageKeys.devMode, '1');
      return true;
    }
    return localStorage.getItem(config.storageKeys.devMode) === '1';
  }

  function toggleDevMode() {
    const on = !isDevMode();
    if (on) localStorage.setItem(config.storageKeys.devMode, '1');
    else    localStorage.removeItem(config.storageKeys.devMode);
    location.reload();
  }

  function initContextCapture() {
    if (window.__sdCtxCapture) return;
    window.__sdCtxCapture = true;
    window.__sdLastClicks = [];
    window.__sdConsoleErrors = [];
    window.__sdSourceCache = null;

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        toggleDevMode();
      }
    });

    document.addEventListener('click', (e) => {
      const el = e.target;
      window.__sdLastClicks.push({
        selector: cssPath(el),
        text: (el.textContent || '').trim().slice(0, 60),
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        at: new Date().toISOString(),
      });
      if (window.__sdLastClicks.length > 10) window.__sdLastClicks.shift();
    }, true);

    window.addEventListener('error', (e) => {
      window.__sdConsoleErrors.push({ type: 'error', message: e.message, source: e.filename, line: e.lineno, at: new Date().toISOString() });
      if (window.__sdConsoleErrors.length > 20) window.__sdConsoleErrors.shift();
    });

    const origErr = console.error.bind(console);
    console.error = function (...args) {
      window.__sdConsoleErrors.push({ type: 'console.error', message: args.map(a => String(a)).join(' ').slice(0, 500), at: new Date().toISOString() });
      if (window.__sdConsoleErrors.length > 20) window.__sdConsoleErrors.shift();
      origErr(...args);
    };
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && path.length < 5) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) { selector += '#' + el.id; path.unshift(selector); break; }
      const cls = [...el.classList].filter(c => !c.startsWith('sd-') && !c.startsWith('uc-') && !c.startsWith('dbg-')).slice(0, 2).join('.');
      if (cls) selector += '.' + cls;
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  async function captureContext(pageId) {
    let sourceFile = '';
    try {
      if (!window.__sdSourceCache) {
        const r = await fetch(window.location.pathname);
        window.__sdSourceCache = await r.text();
      }
      sourceFile = window.__sdSourceCache;
    } catch (e) { sourceFile = `// fetch failed: ${e.message}`; }

    return {
      pageId,
      url: window.location.href,
      pathname: window.location.pathname,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      userAgent: navigator.userAgent.slice(0, 120),
      scrollY: window.scrollY,
      liveDom: document.documentElement.outerHTML.slice(0, 50_000),
      sourceFile: sourceFile.slice(0, 50_000),
      lastClicks: (window.__sdLastClicks || []).slice(-5),
      consoleErrors: (window.__sdConsoleErrors || []).slice(-10),
      at: new Date().toISOString(),
    };
  }

  // ─── DEV NOTES (localStorage-backed per page) ─────────────────────────────
  function hydrateDevNotes() {
    Object.keys(PAGES).forEach(id => {
      const raw = localStorage.getItem(config.storageKeys.devNotes + id);
      if (raw) { try { PAGES[id].devNotes = JSON.parse(raw); } catch {} }
    });
  }

  function saveDevNotes(pageId) {
    localStorage.setItem(config.storageKeys.devNotes + pageId, JSON.stringify(PAGES[pageId].devNotes));
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  // ─── STYLES (inline — no external CSS needed) ─────────────────────────────
  function injectStyles() {
    if (document.getElementById('sd-styles')) return;
    const css = `
      .sd-uc-counter { display:inline-flex; gap:6px; align-items:center; padding:4px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:999px; cursor:pointer; font-size:12px; font-weight:600; }
      .sd-uc-counter:hover { background:#f1f5f9; }
      .sd-uc-counter .sd-cov { padding:2px 6px; background:linear-gradient(135deg,#e0e7ff,#ede9fe); color:#4338ca; border-radius:6px; font-size:10px; font-weight:700; }
      .sd-uc-pill { display:inline-flex; gap:3px; }
      .sd-uc-pill.pass { color:#16a34a; } .sd-uc-pill.fail { color:#dc2626; } .sd-uc-pill.untested { color:#94a3b8; } .sd-uc-pill.flaky { color:#eab308; } .sd-uc-pill.spec { color:#0284c7; }

      .sd-uc-footer, .sd-tz-footer { margin-top:20px; border:1px solid #e2e8f0; border-radius:16px; padding:20px; background:#fff; }
      .sd-tz-footer { background:linear-gradient(180deg,#fafbff 0%,#fff 100%); }
      .sd-uc-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #e2e8f0; }
      .sd-uc-title { font-size:16px; font-weight:700; }
      .sd-uc-row { border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:6px; font-size:13px; display:flex; gap:10px; align-items:center; }
      .sd-btn { font-size:12px; padding:6px 12px; border-radius:8px; border:1px solid #e2e8f0; background:#fff; cursor:pointer; }
      .sd-btn.primary { background:#5b6cff; color:#fff; border-color:#5b6cff; }
      .sd-btn.ai { background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; border:0; }

      .sd-tz-purpose { font-size:13px; color:#475569; margin-bottom:14px; padding:12px 14px; background:#eff6ff; border-left:3px solid #5b6cff; border-radius:6px; }
      .sd-tz-io-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
      @media (max-width:700px) { .sd-tz-io-grid { grid-template-columns:1fr; } }
      .sd-tz-fab { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
      @media (max-width:700px) { .sd-tz-fab { grid-template-columns:1fr; } }
      .sd-tz-fab-col { padding:12px 14px; border-radius:10px; font-size:12px; line-height:1.5; }
      .sd-tz-fab-col.feat { background:linear-gradient(135deg,#fef3c7,#fef08a); border:1px solid #fbbf24; color:#78350f; }
      .sd-tz-fab-col.adv  { background:linear-gradient(135deg,#dbeafe,#bfdbfe); border:1px solid #60a5fa; color:#1e3a8a; }
      .sd-tz-fab-col.ben  { background:linear-gradient(135deg,#dcfce7,#bbf7d0); border:1px solid #4ade80; color:#166534; }
      .sd-tz-fab-head { font-weight:800; font-size:12px; margin-bottom:8px; text-transform:uppercase; }
      .sd-sparse { padding:18px; background:#fffbeb; border:1px dashed #f59e0b; border-radius:10px; text-align:center; color:#92400e; font-size:13px; }

      .sd-fab { position:fixed; bottom:16px; right:16px; border:0; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .2s; z-index:9998; }
      .sd-fab.subtle { width:32px; height:32px; background:rgba(100,116,139,.1); color:#94a3b8; opacity:.5; border-radius:50%; font-size:14px; font-weight:700; }
      .sd-fab.subtle:hover { opacity:1; background:#1e1b4b; color:#fff; transform:scale(1.1); }
      .sd-fab.dev { width:52px; height:52px; bottom:24px; right:24px; background:linear-gradient(135deg,#1e1b4b,#5b21b6); color:#fff; border-radius:50%; font-size:20px; box-shadow:0 10px 25px -5px rgba(91,33,182,.5); }
      .sd-fab.dev:hover { transform:translateY(-2px) scale(1.05); }
      .sd-fab-badge { position:absolute; top:-4px; right:-4px; background:#dc2626; color:#fff; font-size:10px; font-weight:700; min-width:18px; height:18px; border-radius:9px; display:flex; align-items:center; justify-content:center; padding:0 5px; }

      .sd-drawer { position:fixed; top:0; right:0; width:420px; max-width:100vw; height:100vh; background:#0f172a; color:#e2e8f0; box-shadow:-20px 0 40px -10px rgba(0,0,0,.3); transform:translateX(100%); transition:transform .3s; z-index:9999; display:flex; flex-direction:column; }
      .sd-drawer.open { transform:translateX(0); }
      .sd-drawer-head { padding:18px 20px; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; font-size:15px; font-weight:700; }
      .sd-drawer-body { flex:1; overflow-y:auto; padding:18px 20px; }
      .sd-tabs { display:flex; gap:4px; margin-bottom:16px; background:#1e293b; padding:3px; border-radius:8px; }
      .sd-tab { flex:1; padding:6px 8px; background:transparent; border:0; color:#94a3b8; font-size:11px; font-weight:600; cursor:pointer; border-radius:5px; }
      .sd-tab.active { background:#334155; color:#fff; }
      .sd-input { width:100%; padding:10px; background:#1e293b; border:1px solid #334155; color:#e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; box-sizing:border-box; }
      .sd-label { font-size:11px; text-transform:uppercase; color:#94a3b8; margin:12px 0 6px; font-weight:600; }
      .sd-label:first-child { margin-top:0; }
      .sd-submit-btn { width:100%; margin-top:14px; padding:12px; background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; border:0; border-radius:10px; font-weight:700; cursor:pointer; font-size:13px; }
    `;
    const s = document.createElement('style');
    s.id = 'sd-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ─── RENDER: UC Counter ───────────────────────────────────────────────────
  function mountUCCounter(pageId) {
    const topbar = document.querySelector(config.topbarSelector);
    if (!topbar) return;
    const existing = topbar.querySelector('.sd-uc-counter');
    if (existing) existing.remove();

    const s = ucStats(pageId);
    const chip = document.createElement('div');
    chip.className = 'sd-uc-counter';
    chip.title = `UC on this page (${s.total} total)`;
    chip.innerHTML = `
      <span class="sd-cov">${s.coverage === null ? '—' : s.coverage + '%'}</span>
      ${s.passing  ? `<span class="sd-uc-pill pass">🟢${s.passing}</span>`      : ''}
      ${s.failing  ? `<span class="sd-uc-pill fail">🔴${s.failing}</span>`      : ''}
      ${s.untested ? `<span class="sd-uc-pill untested">⚪${s.untested}</span>` : ''}
      ${s.specOnly ? `<span class="sd-uc-pill spec">🔵${s.specOnly}</span>`     : ''}
    `;
    chip.onclick = () => {
      const footer = document.querySelector('.sd-uc-footer');
      if (footer) footer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    topbar.appendChild(chip);
  }

  // ─── RENDER: UC Footer ────────────────────────────────────────────────────
  function mountUCFooter(pageId) {
    const content = document.querySelector(config.contentSelector);
    if (!content) { console.warn('[self-docs] contentSelector not found:', config.contentSelector); return; }
    content.querySelector('.sd-uc-footer')?.remove();

    const ucs = STORAGE.listUseCases(pageId);
    const page = PAGES[pageId];
    const footer = document.createElement('div');
    footer.className = 'sd-uc-footer';
    footer.innerHTML = `
      <div class="sd-uc-head">
        <div class="sd-uc-title">🎯 ${t('useCases')} <span style="font-size:11px;background:#eff2ff;color:#4338ca;padding:2px 8px;border-radius:999px;margin-left:6px">${ucs.length}</span> <span style="font-size:11px;color:#94a3b8;font-weight:500">· ${escapeHtml(page.title)}</span></div>
        <div style="display:flex;gap:6px">
          <button class="sd-btn" onclick="SelfDocs._addUC('${pageId}')">${t('addUc')}</button>
          <button class="sd-btn ai" onclick="SelfDocs._aiGenUC('${pageId}')">${t('aiGen')}</button>
        </div>
      </div>
      <div class="sd-uc-list">
        ${ucs.length ? ucs.map(ucRow).join('') : `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">${t('noUc')}</div>`}
      </div>
    `;
    content.appendChild(footer);
  }

  function ucRow(uc) {
    const m = UC_STATUS_META[uc.status] || UC_STATUS_META.draft;
    return `<div class="sd-uc-row"><span>${m.emoji}</span><span style="flex:1;font-weight:600">${escapeHtml(uc.title)}</span><span style="font-size:10px;background:#f1f5f9;padding:2px 8px;border-radius:999px;color:#64748b;text-transform:uppercase">${escapeHtml(uc.role || '')}</span></div>`;
  }

  function _addUC(pageId) {
    const title = prompt('UC title:');
    if (!title) return;
    STORAGE.saveUseCase({ pageId, title, role: 'admin', status: 'draft', source: 'manual', steps: [], preconditions: [], createdBy: STORAGE.currentUser() });
    mountUCCounter(pageId); mountUCFooter(pageId);
  }

  async function _aiGenUC(pageId) {
    if (!config.aiGenerateFn) {
      alert('config.aiGenerateFn not set — supply Claude/OpenAI hook.');
      return;
    }
    const candidates = await config.aiGenerateFn(PAGES[pageId]);
    if (!candidates?.length) return;
    if (!confirm(`AI generated ${candidates.length} candidates. Add all?`)) return;
    candidates.forEach(c => STORAGE.saveUseCase({ pageId, source: 'ai-generated', createdBy: 'ai', status: 'draft', ...c }));
    mountUCCounter(pageId); mountUCFooter(pageId);
  }

  // ─── RENDER: TZ Footer ────────────────────────────────────────────────────
  function mountTzFooter(pageId) {
    const content = document.querySelector(config.contentSelector);
    if (!content) return;
    content.querySelector('.sd-tz-footer')?.remove();

    const p = PAGES[pageId];
    const hasSpec = !!(p.purpose || (p.inputs && p.inputs.length) || (p.features && p.features.length));

    const footer = document.createElement('div');
    footer.className = 'sd-tz-footer';

    if (!hasSpec) {
      footer.innerHTML = `<div class="sd-uc-head"><div class="sd-uc-title">📋 ${t('tzTitle')} · ${escapeHtml(p.title)}</div></div><div class="sd-sparse">${t('sparse')}</div>`;
      content.appendChild(footer);
      return;
    }

    const fmt = (items, empty) => items?.length ? items.map(i => `<div>· ${escapeHtml(i)}</div>`).join('') : `<div style="opacity:.5">${empty}</div>`;
    const fmtIO = (items, arrow) => items?.length
      ? items.map(i => `<div style="font-size:12px;padding:4px 0"><code style="font-family:'JetBrains Mono',monospace;font-weight:600">${escapeHtml(i.name)}</code> ${arrow} <span style="font-family:'JetBrains Mono',monospace;color:#64748b">${escapeHtml(i.from || i.to)}</span></div>`).join('')
      : '<div style="opacity:.5">—</div>';

    footer.innerHTML = `
      <div class="sd-uc-head">
        <div class="sd-uc-title">📋 ${t('tzTitle')}
          ${p.owner ? `<span style="font-size:10px;background:#eff2ff;color:#4338ca;padding:2px 10px;border-radius:999px;margin-left:6px;font-weight:700;text-transform:uppercase">${t('owner')}: ${escapeHtml(p.owner)}</span>` : ''}
          <span style="font-size:11px;color:#94a3b8;font-weight:500">· ${escapeHtml(p.title)}</span>
        </div>
      </div>
      ${p.purpose ? `<div class="sd-tz-purpose">🎯 ${escapeHtml(p.purpose)}</div>` : ''}
      <div class="sd-tz-io-grid">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">⇠ ${t('inputs')}</div>
          ${fmtIO(p.inputs, '←')}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">⇢ ${t('outputs')}</div>
          ${fmtIO(p.outputs, '→')}
        </div>
      </div>
      <div class="sd-tz-fab">
        <div class="sd-tz-fab-col feat"><div class="sd-tz-fab-head">📊 ${t('features')}</div>${fmt(p.features, 'empty')}</div>
        <div class="sd-tz-fab-col adv"><div class="sd-tz-fab-head">🚀 ${t('advantages')}</div>${fmt(p.advantages, 'empty')}</div>
        <div class="sd-tz-fab-col ben"><div class="sd-tz-fab-head">💰 ${t('benefits')}</div>${fmt(p.benefits, 'empty')}</div>
      </div>
    `;
    content.appendChild(footer);
  }

  // ─── RENDER: Debug FAB + Drawer ───────────────────────────────────────────
  function mountDebugBar(pageId) {
    window.__sdCurrentPageId = pageId;
    document.querySelector('.sd-fab')?.remove();
    document.querySelector('.sd-drawer')?.remove();

    const dev = isDevMode();
    const fbCount = STORAGE.listFeedback(pageId).length;

    const fab = document.createElement('button');
    fab.className = 'sd-fab ' + (dev ? 'dev' : 'subtle');
    fab.innerHTML = (dev ? '🐛' : '?') + (fbCount ? `<span class="sd-fab-badge">${fbCount}</span>` : '');
    fab.title = dev ? 'Debug mode · Cmd+Shift+D to toggle' : 'Need to report a bug or improvement? Click.';
    fab.onclick = () => document.querySelector('.sd-drawer').classList.toggle('open');
    document.body.appendChild(fab);

    const drawer = document.createElement('div');
    drawer.className = 'sd-drawer';
    drawer.innerHTML = `
      <div class="sd-drawer-head">
        <span>🐛 ${t('debug')} · ${escapeHtml(PAGES[pageId].title)}</span>
        <button style="background:transparent;border:0;color:#94a3b8;font-size:22px;cursor:pointer" onclick="document.querySelector('.sd-drawer').classList.remove('open')">×</button>
      </div>
      <div class="sd-drawer-body">
        <div class="sd-label">${t('feedbackDesc')}</div>
        <textarea class="sd-input" id="sd-feedback-text" rows="4"></textarea>
        <button class="sd-submit-btn" onclick="SelfDocs._submit('${pageId}')">${t('save')}</button>
        <div style="margin-top:16px;font-size:11px;color:#64748b;padding:10px 12px;background:#1e293b;border-radius:8px;border-left:3px solid #8b5cf6;line-height:1.6">
          <strong style="color:#c4b5fd">🤖</strong> At submit: URL · viewport · DOM snapshot · source file · last 5 clicks · console errors — all auto-attached. ~50KB ready-to-patch payload for AI.
        </div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  async function _submit(pageId) {
    const text = document.getElementById('sd-feedback-text').value.trim();
    if (!text) { alert('Write what is broken / what to improve'); return; }
    const context = await captureContext(pageId);
    STORAGE.saveFeedback({ pageId, type: 'bug', severity: 'med', text, createdBy: STORAGE.currentUser(), context });
    document.querySelector('.sd-drawer').classList.remove('open');
    mountDebugBar(pageId);
    setTimeout(() => alert('✅ Saved with ~' + ((new Blob([JSON.stringify(context)]).size)/1024).toFixed(1) + 'KB context.'), 100);
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────
  function mount(pageId) {
    if (!PAGES[pageId]) { console.warn('[self-docs] Page not registered:', pageId); return; }
    injectStyles();
    initContextCapture();
    hydrateDevNotes();
    mountUCCounter(pageId);
    mountUCFooter(pageId);
    mountTzFooter(pageId);
    mountDebugBar(pageId);
  }

  window.SelfDocs = {
    config: (opts) => Object.assign(config, opts),
    registerPage,
    mount,
    storage: STORAGE,
    ucStats,
    captureContext,
    toggleDevMode,
    isDevMode,
    // internal methods exposed for HTML onclicks
    _addUC, _aiGenUC, _submit,
    // expose for advanced use
    PAGES, UC_STATUS_META, I18N,
  };
})(window);
