// Shared sidebar + topbar. Each page calls renderShell({active}).

function icon(name) {
  const svgs = {
    dashboard: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    time: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    expenses: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    clients: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h0M9 13h0M9 17h0M15 9h0M15 13h0M15 17h0"/></svg>',
    workers: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    audit: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    agents: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v1H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3V5a3 3 0 0 0-3-3Z"/><circle cx="9" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path d="M8 12v3M16 12v3"/></svg>',
    a2a: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="8" y1="8" x2="10" y2="16"/><line x1="16" y1="8" x2="14" y2="16"/><line x1="9" y1="6" x2="15" y2="6"/></svg>',
    policies: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    search: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    bell: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    plus: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    bot: '🤖',
  };
  return svgs[name] || '';
}

function renderShell({ active, title, breadcrumbs = [], actions = '' }) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: 'index.html', section: 'Обзор' },
    { id: 'time', label: 'Время', href: 'time.html', section: 'Операции' },
    { id: 'expenses', label: 'Затраты', href: 'expenses.html', section: 'Операции' },
    { id: 'clients', label: 'Клиенты', href: 'clients.html', section: 'Операции' },
    { id: 'workers', label: 'Работники', href: 'workers.html', section: 'Люди' },
    { id: 'my-time', label: 'Моё время', href: 'my-time.html', section: 'Моё' },
    { id: 'my-expenses', label: 'Мои затраты', href: 'my-expenses.html', section: 'Моё' },
    { id: 'call-brief', label: 'Call brief', href: 'call-brief.html?id=c1', section: '📞 Sales' },
    { id: 'call-live', label: 'Live call', href: 'call-live.html?id=c1', section: '📞 Sales' },
    { id: 'call-summary', label: 'Call summary', href: 'call-summary.html?id=c1', section: '📞 Sales' },
    { id: 'agents', label: 'Агенты', href: 'admin-agents.html', section: '🤖 AI' },
    { id: 'a2a', label: 'A2A orchestration', href: 'a2a.html', section: '🤖 AI' },
    { id: 'policies', label: 'Automation rules', href: 'ai-policies.html', section: '🤖 AI' },
    { id: 'audit', label: 'Audit log', href: 'audit.html', section: 'Админ' },
  ];

  const sections = {};
  navItems.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });

  const iconMap = {
    'my-time': 'time',
    'my-expenses': 'expenses',
  };

  const navHtml = Object.entries(sections).map(([section, items]) => `
    <div class="nav-section">${section}</div>
    ${items.map(it => `
      <a href="${it.href}" class="nav-item ${active === it.id ? 'active' : ''}">
        ${icon(iconMap[it.id] || it.id)}
        <span>${it.label}</span>
      </a>
    `).join('')}
  `).join('');

  const crumbs = breadcrumbs.length ? `
    <div class="breadcrumbs">
      ${breadcrumbs.map((c, i) => {
        const isLast = i === breadcrumbs.length - 1;
        const sep = i < breadcrumbs.length - 1 ? `${icon('chevron')}` : '';
        return c.href && !isLast
          ? `<a href="${c.href}">${c.label}</a>${sep}`
          : `<span class="${isLast ? 'strong' : ''}" style="color:${isLast ? 'var(--text)' : 'var(--text-2)'}">${c.label}</span>${sep}`;
      }).join('')}
    </div>
  ` : '';

  document.body.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-logo">ET</div>
          <div>
            <div style="font-size:14px">EasyTimerCost</div>
            <div style="font-size:11px;color:var(--text-3);font-weight:500">profit-step ERP</div>
          </div>
        </div>
        ${navHtml}
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="search" style="border-color:var(--ai-100);background:linear-gradient(180deg,var(--ai-50),#fff)">
            <span style="font-size:14px">🤖</span>
            <input placeholder="Спроси AI: '@Acme звонит' · 'закрыть смену Андрея' · 'скоко Михаил заработал'..." style="background:transparent"/>
            <span class="chip ai" style="font-size:10px">⌘K</span>
          </div>
          <div style="flex:1"></div>
          <button class="btn sm" style="border:0;background:transparent;padding:6px">${icon('bell')}</button>
          <div class="user">
            <div class="avatar sm">ДХ</div>
            <div>
              <div style="font-size:12px;font-weight:600">Денис Х.</div>
              <div style="font-size:11px;color:var(--text-2)">Admin</div>
            </div>
          </div>
        </header>
        <div class="content" id="page-content">
          ${crumbs}
          ${title ? `
            <div class="page-header">
              <div style="flex:1">
                <h1 class="page-title">${title}</h1>
              </div>
              ${actions}
            </div>
          ` : ''}
          <div id="page-body"></div>
        </div>
      </div>
    </div>
  `;
}

function setBody(html) {
  document.getElementById('page-body').innerHTML = html;
}

// Mock data shared across pages
const MOCK = {
  workers: [
    { id: 'w1', name: 'Денис Харбузов',   role: 'admin',   rate: 0,   hours: 0,   earned: 0,     paid: 0,     balance: 0,      sessions: 0,  initials: 'ДХ', crew: null },
    { id: 'w2', name: 'Михаил Петров',    role: 'foreman', rate: 65,  hours: 312, earned: 20280, paid: 18500, balance: 1780,   sessions: 42, initials: 'МП', crew: null },
    { id: 'w3', name: 'Андрей Сидоров',   role: 'worker',  rate: 45,  hours: 289, earned: 13005, paid: 12000, balance: 1005,   sessions: 38, initials: 'АС', crew: 'w2' },
    { id: 'w4', name: 'Игорь Васильев',   role: 'worker',  rate: 42,  hours: 267, earned: 11214, paid: 11000, balance: 214,    sessions: 34, initials: 'ИВ', crew: 'w2' },
    { id: 'w5', name: 'Сергей Ковалёв',   role: 'worker',  rate: 48,  hours: 304, earned: 14592, paid: 11500, balance: 3092,   sessions: 41, initials: 'СК', crew: 'w2' },
    { id: 'w6', name: 'Виктор Нестеров',  role: 'driver',  rate: 38,  hours: 198, earned: 7524,  paid: 7200,  balance: 324,    sessions: 28, initials: 'ВН', crew: null },
    { id: 'w7', name: 'Павел Морозов',    role: 'worker',  rate: 52,  hours: 345, earned: 17940, paid: 16000, balance: 1940,   sessions: 45, initials: 'ПМ', crew: 'w2' },
    { id: 'w8', name: 'Александр Гущин',  role: 'worker',  rate: 44,  hours: 278, earned: 12232, paid: 12232, balance: 0,      sessions: 36, initials: 'АГ', crew: 'w2' },
    { id: 'w9', name: 'Роман Лебедев',    role: 'foreman', rate: 68,  hours: 298, earned: 20264, paid: 16000, balance: 4264,   sessions: 40, initials: 'РЛ', crew: null },
    { id: 'w10', name: 'Дмитрий Орлов',   role: 'worker',  rate: 46,  hours: 256, earned: 11776, paid: 12000, balance: -224,   sessions: 33, initials: 'ДО', crew: 'w9' },
  ],
  clients: [
    { id: 'c1', name: 'Acme Corp',           project: 'Tampa Office Remodel',  revenue: 220000, labor: 78500, materials: 42000, margin: 0.45, status: 'active'    },
    { id: 'c2', name: 'Jim Dvorkin',         project: 'Kitchen Reno Phase 2',  revenue: 48000,  labor: 22400, materials: 14800, margin: 0.23, status: 'active'    },
    { id: 'c3', name: 'Westfield Plaza LLC', project: 'Shopping Court Facade', revenue: 185000, labor: 62000, materials: 48000, margin: 0.40, status: 'active'    },
    { id: 'c4', name: 'Riverside Homes',     project: 'Unit 4B Bathroom',      revenue: 32000,  labor: 18200, materials: 9400,  margin: 0.14, status: 'at_risk'   },
    { id: 'c5', name: 'Sunset Realty',       project: 'Condo Flooring',        revenue: 28000,  labor: 11200, materials: 8200,  margin: 0.31, status: 'active'    },
    { id: 'c6', name: 'TechPark Owners',     project: 'Parking Lot Resurface', revenue: 95000,  labor: 28000, materials: 35000, margin: 0.34, status: 'completed' },
    { id: 'c7', name: 'Bayside Condos',      project: 'Entry Lobby',           revenue: 42000,  labor: 15800, materials: 11200, margin: 0.36, status: 'active'    },
  ],
  sessions: [
    { id: 's1', workerId: 'w3', clientId: 'c1', date: '2026-04-20', start: '07:15', end: '16:30', hours: 9.25, rate: 45, earnings: 416.25, status: 'completed',  desc: 'Drywall installation — east wing'   },
    { id: 's2', workerId: 'w5', clientId: 'c1', date: '2026-04-20', start: '07:20', end: '16:45', hours: 9.42, rate: 48, earnings: 452.00, status: 'completed',  desc: 'Electrical rough-in'                },
    { id: 's3', workerId: 'w4', clientId: 'c3', date: '2026-04-20', start: '07:00', end: null,    hours: 5.5,  rate: 42, earnings: 231.00, status: 'active',     desc: 'Facade prep — south side'           },
    { id: 's4', workerId: 'w7', clientId: 'c3', date: '2026-04-20', start: '07:05', end: null,    hours: 5.5,  rate: 52, earnings: 286.00, status: 'active',     desc: 'Scaffolding + safety check'         },
    { id: 's5', workerId: 'w8', clientId: 'c2', date: '2026-04-19', start: '08:00', end: '17:30', hours: 9.5,  rate: 44, earnings: 418.00, status: 'completed',  desc: 'Cabinets install — upper run'       },
    { id: 's6', workerId: 'w3', clientId: 'c1', date: '2026-04-19', start: '07:10', end: '16:00', hours: 8.83, rate: 45, earnings: 397.35, status: 'completed',  desc: 'Drywall prep'                        },
    { id: 's7', workerId: 'w10', clientId: 'c4', date: '2026-04-19', start: '07:30', end: '16:00', hours: 8.5, rate: 46, earnings: 391.00, status: 'completed',  desc: 'Demo + plumbing rough'              },
    { id: 's8', workerId: 'w6', clientId: 'c1', date: '2026-04-19', start: '06:30', end: '14:30', hours: 8.0, rate: 38, earnings: 304.00, status: 'completed',  desc: 'Material delivery + cleanup'        },
  ],
  expenses: [
    { id: 'e1', workerId: 'w5', clientId: 'c1', category: 'materials',    amount: 347.82, desc: 'Electrical supplies @ Home Depot', status: 'approved',  billable: true,  reimbursable: true,  date: '2026-04-20', receipt: true  },
    { id: 'e2', workerId: 'w3', clientId: 'c1', category: 'fuel',         amount: 68.40,  desc: 'Gas — site travel',                status: 'approved',  billable: false, reimbursable: true,  date: '2026-04-20', receipt: true  },
    { id: 'e3', workerId: 'w7', clientId: 'c3', category: 'subcontractor', amount: 1250.00, desc: 'Painter subcontractor day rate',   status: 'submitted', billable: true,  reimbursable: false, date: '2026-04-20', receipt: true  },
    { id: 'e4', workerId: 'w8', clientId: 'c2', category: 'materials',    amount: 892.15, desc: 'Cabinet hardware @ Ikea',          status: 'submitted', billable: true,  reimbursable: true,  date: '2026-04-19', receipt: true  },
    { id: 'e5', workerId: 'w4', clientId: 'c3', category: 'meals',        amount: 48.20,  desc: 'Crew lunch',                        status: 'approved',  billable: false, reimbursable: true,  date: '2026-04-19', receipt: true  },
    { id: 'e6', workerId: 'w10', clientId: 'c4', category: 'materials',   amount: 234.00, desc: 'Plumbing fittings',                status: 'rejected',  billable: true,  reimbursable: true,  date: '2026-04-18', receipt: false },
    { id: 'e7', workerId: 'w6', clientId: 'c1', category: 'equipment_rental', amount: 180.00, desc: 'Scissor lift 1 day',             status: 'approved',  billable: true,  reimbursable: false, date: '2026-04-18', receipt: true  },
    { id: 'e8', workerId: 'w9', clientId: 'c7', category: 'permits',      amount: 425.00, desc: 'City permit fee',                  status: 'approved',  billable: true,  reimbursable: false, date: '2026-04-17', receipt: true  },
  ],
};

function fmt$(n) {
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmt$exact(n) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function workerById(id) {
  return MOCK.workers.find(w => w.id === id);
}

function clientById(id) {
  return MOCK.clients.find(c => c.id === id);
}

function periodPill() {
  return `<span class="period">📅 YTD — 2026</span>`;
}

// Agent layer — personas + activity
MOCK.agents = [
  // Worker agents (10 — one per human worker)
  { id: 'a-w1',  type: 'worker',  ownerId: 'w1',  name: 'Денис · AI',   actions: 12,  saved: 0,    ll: 'gpt-5', status: 'idle' },
  { id: 'a-w2',  type: 'foreman', ownerId: 'w2',  name: 'Михаил · AI',  actions: 128, saved: 1420, ll: 'gpt-5', status: 'active' },
  { id: 'a-w3',  type: 'worker',  ownerId: 'w3',  name: 'Андрей · AI',  actions: 47,  saved: 820,  ll: 'gpt-5', status: 'active' },
  { id: 'a-w4',  type: 'worker',  ownerId: 'w4',  name: 'Игорь · AI',   actions: 42,  saved: 680,  ll: 'gpt-5', status: 'active' },
  { id: 'a-w5',  type: 'worker',  ownerId: 'w5',  name: 'Сергей · AI',  actions: 51,  saved: 905,  ll: 'gpt-5', status: 'idle' },
  { id: 'a-w6',  type: 'worker',  ownerId: 'w6',  name: 'Виктор · AI',  actions: 28,  saved: 420,  ll: 'gpt-5', status: 'idle' },
  { id: 'a-w7',  type: 'worker',  ownerId: 'w7',  name: 'Павел · AI',   actions: 51,  saved: 940,  ll: 'gpt-5', status: 'active' },
  { id: 'a-w8',  type: 'worker',  ownerId: 'w8',  name: 'Алекс · AI',   actions: 33,  saved: 510,  ll: 'gpt-5', status: 'idle' },
  { id: 'a-w9',  type: 'foreman', ownerId: 'w9',  name: 'Роман · AI',   actions: 94,  saved: 1180, ll: 'gpt-5', status: 'active' },
  { id: 'a-w10', type: 'worker',  ownerId: 'w10', name: 'Дмитрий · AI', actions: 36,  saved: 580,  ll: 'gpt-5', status: 'idle' },
  // Client-side agents (virtual, 1 per active client)
  { id: 'a-c1',  type: 'client',  ownerId: 'c1',  name: 'Acme AI',        actions: 87,  saved: 0, ll: 'claude', status: 'active' },
  { id: 'a-c3',  type: 'client',  ownerId: 'c3',  name: 'Westfield AI',   actions: 54,  saved: 0, ll: 'claude', status: 'active' },
  // System agents
  { id: 'a-sys-approver', type: 'system', ownerId: null, name: 'Approval bot',  actions: 28, saved: 2400, ll: 'rules', status: 'active' },
  { id: 'a-sys-payroll',  type: 'system', ownerId: null, name: 'Payroll bot',   actions: 2,  saved: 180,  ll: 'rules', status: 'idle' },
  { id: 'a-sys-ocr',      type: 'system', ownerId: null, name: 'Receipt OCR',   actions: 42, saved: 720,  ll: 'vision', status: 'active' },
  { id: 'a-sys-geo',      type: 'system', ownerId: null, name: 'Geo fence bot', actions: 156, saved: 0,   ll: 'rules', status: 'active' },
];

MOCK.agentActivity = [
  { at: '16:32', from: 'a-w3',  to: null,          type: 'proposal',   text: 'Geo показывает я уехал с Acme. Закрыть смену 8.5ч = $397.35?', target: 'Андрей' },
  { at: '16:05', from: 'a-sys-approver', to: 'a-w5', type: 'approved', text: 'Session s2 auto-approved (9.4ч, on-site, face-match 98.4%)', target: null },
  { at: '14:35', from: 'a-w5',  to: 'a-sys-ocr',   type: 'request',    text: 'Photo чека Home Depot → extract', target: null },
  { at: '14:36', from: 'a-sys-ocr', to: 'a-w5',    type: 'response',   text: 'Vendor: Home Depot, Amount: $347.82, Date: 2026-04-20, confidence 96%', target: null },
  { at: '14:37', from: 'a-w5',  to: 'a-w2',        type: 'handoff',    text: 'Expense e1 $347.82 materials — approve? (within $500 threshold)', target: null },
  { at: '14:38', from: 'a-w2',  to: 'a-sys-approver', type: 'decision', text: 'Approved — bill to Acme', target: null },
  { at: '07:20', from: 'a-w5',  to: 'a-sys-geo',   type: 'verify',     text: 'Start shift at Acme — verify geo', target: null },
  { at: '07:20', from: 'a-sys-geo', to: 'a-w5',    type: 'response',   text: 'On site (0.3mi, ±12m)', target: null },
  { at: '07:15', from: 'a-w3',  to: 'a-w2',        type: 'notify',     text: 'Стартую Acme, ETA 2мин', target: null },
  { at: '07:02', from: 'a-w3',  to: null,          type: 'proposal',   text: 'Geo 2мин от Acme — стартуем смену? (как вчера: Drywall)', target: 'Андрей' },
];

MOCK.aiPolicies = [
  { id: 'auto-approve-session', name: 'Auto-approve смену', desc: 'Если hours < 10 AND geo OK AND face match > 95% — утвердить без admin', on: true,  saved: '$2,400/мес', risk: 'low' },
  { id: 'auto-ocr',             name: 'OCR чеков',           desc: 'Автоматически извлекать vendor/amount/date/tax из фото чека',       on: true,  saved: '$720/мес',   risk: 'low' },
  { id: 'auto-categorize',      name: 'Автокатегоризация',   desc: 'ML определяет категорию затраты по vendor + описанию',              on: true,  saved: '$180/мес',   risk: 'low' },
  { id: 'auto-start-proposal',  name: 'Proactive start',     desc: 'Если работник в geo-fence клиента в обычное время — предложить старт', on: true,  saved: '$940/мес',   risk: 'med' },
  { id: 'auto-close-on-leave',  name: 'Auto-close при уходе', desc: 'Если работник покинул geo > 30мин — предложить закрыть смену',     on: true,  saved: '$510/мес',   risk: 'med' },
  { id: 'flag-over-threshold',  name: 'Flag > $500',         desc: 'Затраты > $500 требуют ручного approval даже если политика ОК',   on: true,  saved: '—',          risk: 'low' },
  { id: 'flag-outside-tampa',   name: 'Flag > 100mi Tampa',  desc: 'Сессии > 100mi от HQ — обязательно human review',                   on: true,  saved: '—',          risk: 'low' },
  { id: 'auto-payout',          name: 'Auto-payout < $5k',   desc: 'Выплаты < $5k обрабатывать автоматически в конце периода',          on: false, saved: 'потенц. $300/мес', risk: 'high' },
  { id: 'ai-ask-employee',      name: 'AI спрашивает работника', desc: 'Agent пишет работнику в Telegram если нужна информация (receipt, note)', on: true, saved: '$420/мес', risk: 'low' },
  { id: 'a2a-client-notify',    name: 'Уведомлять клиентов', desc: 'Agent клиента получает notification когда бригада прибывает',       on: false, saved: 'NPS +', risk: 'med' },
];

function agentById(id) {
  return MOCK.agents.find(a => a.id === id);
}

function agentByOwnerId(ownerId) {
  return MOCK.agents.find(a => a.ownerId === ownerId && (a.type === 'worker' || a.type === 'foreman'));
}

// Client intel — enriched data used on call-brief/live/summary pages
MOCK.clientIntel = {
  c1: {  // Acme Corp
    contact: { name: 'John Smith', role: 'Facilities Manager', phone: '+1 (305) 555-0101', email: 'john@acmecorp.com', since: '2024-06' },
    stakeholders: [
      { name: 'John Smith', role: 'Facilities Manager (decision maker)', influence: 'high' },
      { name: 'Sarah Lee',  role: 'CFO (signs >$50k)',                     influence: 'high' },
      { name: 'Mike Rivera', role: 'Site super (day-to-day)',              influence: 'med' },
    ],
    health: { score: 84, npsLast: 9, paymentReliability: 'A', incidents: 0 },
    outstanding: { count: 2, total: 14200, oldest: '18 days', aging: 'ok' },
    ltv: 420000,
    recent: [
      { date: '2026-04-19', type: 'email',     subj: 'RE: Phase 2 timeline', summary: 'Confirmed May 15 completion · asked about bath addition'                                     },
      { date: '2026-04-12', type: 'call',      subj: 'Budget check',          summary: 'Mentioned might extend scope to include kitchen · no commitment'                               },
      { date: '2026-04-05', type: 'site-visit',subj: 'Walk-through Phase 1', summary: 'Jim happy with drywall quality · noted 2 punch-list items (Михаил fixed in 2 days)'          },
      { date: '2026-03-22', type: 'call',      subj: 'Permit delay',          summary: 'Permit for electrical upgrade took 3 weeks · client understood · apologized for delay'        },
      { date: '2026-03-10', type: 'email',     subj: 'Invoice #INV-042',      summary: 'Paid $12,450 · 2 days early'                                                                  },
    ],
    predictedQA: [
      { q: 'When will Phase 2 finish?',                a: 'May 15 — 85% complete, on schedule. Last drywall done, electrical scheduled Apr 25.', src: 'project timeline' },
      { q: 'Why was last invoice higher than estimate?', a: 'Added permits ($425) + change order CO-3 ($1,200) — both signed by you on Apr 8. Net overage 3.1% (within 10% clause).', src: 'invoice + CO log' },
      { q: 'Can you start the bath reno in June?',     a: 'Да — Михаил\'s crew free after May 20, Роман\'s crew free June 10. Need deposit $8k to lock slot.', src: 'crew schedule' },
      { q: 'Status on the punch list?',                  a: 'Все 2 пункта закрыты 2026-04-07 · photos in portal', src: 'site-visit notes' },
      { q: 'Can you match the competitor quote?',        a: '⚠ Competitor quote $8k lower — но у них rating 3.2 stars vs наши 4.8 · предложить гарантию 2 года вместо 1 · not price cut.', src: 'win/loss history' },
      { q: 'Who should I call when Миша (foreman) not available?', a: 'Роман — foreman backup · знает Acme site · phone +1 (305) 555-0105.', src: 'crew roster' },
    ],
    earnStrategy: [
      { title: 'Bath reno upsell',       value: '$32k · 38% margin · ~$12k profit', prob: 72, reason: 'John сам упомянул 12 апреля, ещё тёпленький' },
      { title: 'Kitchen addition',       value: '$48k · 34% margin · ~$16k profit',  prob: 45, reason: 'Mentioned in passing · decision depends on Sarah (CFO)' },
      { title: 'Rate bump +8%',          value: '+$14k lifetime на контракте',       prob: 80, reason: 'Rate frozen с 2024, market moved · reasonable при новой фазе' },
      { title: '3 other properties',     value: 'unknown — bundle discount approach', prob: 30, reason: 'Acme owns 4 locations в Tampa · upsell potential $80k+' },
      { title: 'Maintenance contract',   value: '$2k/мес recurring',                   prob: 25, reason: 'После Phase 2 готового предложить квартальный maintenance' },
    ],
    persuasion: {
      profile: 'Pragmatist · values timeline precision · delegates permits/process · price-aware but not price-driven',
      hotButtons: ['On-time delivery', 'Quality photos after each phase', 'Clear change orders'],
      avoid: ['Over-explaining permits', 'Mentioning subcontractor issues', 'Vague timelines'],
      pastObjections: [
        { obj: 'Price — competitor quoted lower',      win: 'Show warranty, portfolio, response-time SLA · never drop price' },
        { obj: 'Worried about crew experience on new material', win: 'Bring Михаил to site-visit · show last 3 similar projects' },
      ],
      decisionStyle: 'Visual (photos > spreadsheets) · Quick decisions if trust present · Loops in Sarah for >$50k'
    },
    actionPlan: {
      during: [
        'Propose June 10 start for bath reno · lock deposit $8k',
        'Mention rate bump +8% only if he asks about pricing · otherwise delay to proposal',
        'Offer Михаил site-visit Monday — builds trust',
      ],
      after: [
        { task: 'Send formal proposal for bath reno (AI draft → Денис review)', who: 'w1', due: '2026-04-22' },
        { task: 'Site-visit Monday 08:00 with crew lead',                          who: 'w2', due: '2026-04-25' },
        { task: 'Draft change order template for kitchen (if opens up)',          who: 'w1', due: '2026-04-28' },
        { task: 'Check outstanding invoice #INV-044 ($12k) — overdue 18д',        who: 'bookkeeper', due: '2026-04-23' },
      ],
      cadence: 'Touch base every 3 days until signed · Михаил site-visit builds trust · don\'t push Sarah before John buys in',
    }
  }
};

function getClientIntel(cid) {
  return MOCK.clientIntel[cid] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-DOCS LAYER (Phase 1 of self-documenting portal)
// Depends on meta.js (window.PAGES, window.STORAGE, window.ucStats, window.UC_STATUS_META)
// ═══════════════════════════════════════════════════════════════════════════

function mountSelfDocs(pageId) {
  if (!window.PAGES || !window.PAGES[pageId]) {
    console.warn('[self-docs] No PAGES entry for', pageId);
    return;
  }
  initContextCapture();
  injectSelfDocsStyles();
  mountUCCounter(pageId);
  mountUCFooter(pageId);
  mountTzFooter(pageId);
  mountDebugBar(pageId);
}

// ─── CONTEXT CAPTURE (click trail + errors + source fetch) ────────────────

function initContextCapture() {
  if (window.__ctxCapture) return;
  window.__ctxCapture = true;
  window.__lastClicks = [];
  window.__consoleErrors = [];
  window.__sourceCache = null;

  // Click trail — ring buffer of last 10 user clicks
  document.addEventListener('click', (e) => {
    const el = e.target;
    const sel = cssPath(el);
    window.__lastClicks.push({
      selector: sel,
      text: (el.textContent || '').trim().slice(0, 60),
      tag: el.tagName.toLowerCase(),
      at: new Date().toISOString(),
    });
    if (window.__lastClicks.length > 10) window.__lastClicks.shift();
  }, true);

  // Error interceptor
  window.addEventListener('error', (e) => {
    window.__consoleErrors.push({
      type: 'error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
      at: new Date().toISOString(),
    });
    if (window.__consoleErrors.length > 20) window.__consoleErrors.shift();
  });
  const origErr = console.error.bind(console);
  console.error = function (...args) {
    window.__consoleErrors.push({
      type: 'console.error',
      message: args.map(a => String(a)).join(' ').slice(0, 500),
      at: new Date().toISOString(),
    });
    if (window.__consoleErrors.length > 20) window.__consoleErrors.shift();
    origErr(...args);
  };
}

// Build CSS selector path to an element (best-effort)
function cssPath(el) {
  if (!(el instanceof Element)) return '';
  const path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE && path.length < 5) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) { selector += '#' + el.id; path.unshift(selector); break; }
    const cls = [...el.classList].filter(c => !c.startsWith('dbg-') && !c.startsWith('uc-')).slice(0, 2).join('.');
    if (cls) selector += '.' + cls;
    const parent = el.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(n => n.nodeName === el.nodeName);
      if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
    }
    path.unshift(selector);
    el = el.parentElement;
  }
  return path.join(' > ');
}

async function captureContext(pageId) {
  let sourceFile = '';
  try {
    if (!window.__sourceCache) {
      const r = await fetch(window.location.pathname);
      window.__sourceCache = await r.text();
    }
    sourceFile = window.__sourceCache;
  } catch (e) { sourceFile = `// fetch failed: ${e.message}`; }

  return {
    url: window.location.href,
    pathname: window.location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    userAgent: navigator.userAgent.slice(0, 120),
    scrollY: window.scrollY,
    liveDom: document.documentElement.outerHTML.slice(0, 50_000),
    sourceFile: sourceFile.slice(0, 50_000),
    lastClicks: (window.__lastClicks || []).slice(-5),
    consoleErrors: (window.__consoleErrors || []).slice(-10),
    at: new Date().toISOString(),
  };
}

function injectSelfDocsStyles() {
  if (document.getElementById('self-docs-styles')) return;
  const css = `
    /* UC counter in topbar */
    .uc-counter { display:inline-flex; gap:6px; align-items:center; padding:4px 10px; background:#f8fafc; border:1px solid var(--border); border-radius:999px; cursor:pointer; font-size:12px; font-weight:600; transition:all .15s; }
    .uc-counter:hover { background:#f1f5f9; transform:translateY(-1px); }
    .uc-counter .uc-pill { display:inline-flex; gap:3px; align-items:center; }
    .uc-counter .uc-pill.pass { color:#16a34a; }
    .uc-counter .uc-pill.fail { color:#dc2626; }
    .uc-counter .uc-pill.untested { color:#94a3b8; }
    .uc-counter .uc-pill.flaky { color:#eab308; }
    .uc-counter .uc-pill.draft { color:#a855f7; }
    .uc-counter .uc-pill.spec { color:#0284c7; }
    .uc-counter .uc-cov { padding:2px 6px; background:linear-gradient(135deg,#e0e7ff,#ede9fe); color:#4338ca; border-radius:6px; font-size:10px; font-weight:700; }

    /* UC footer */
    .uc-footer { margin-top:32px; border:1px solid var(--border); border-radius:16px; background:#fff; padding:20px 24px; }
    .uc-footer-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border); }
    .uc-footer-title { font-size:16px; font-weight:700; display:flex; gap:10px; align-items:center; }
    .uc-footer-title .uc-count-badge { font-size:11px; background:var(--ai-50); color:var(--ai-600); padding:2px 8px; border-radius:999px; font-weight:600; }
    .uc-actions { display:flex; gap:8px; }
    .uc-btn { font-size:12px; padding:6px 12px; border-radius:8px; border:1px solid var(--border); background:#fff; cursor:pointer; font-weight:500; color:var(--text); transition:all .15s; }
    .uc-btn:hover { background:#f8fafc; border-color:var(--brand); }
    .uc-btn.primary { background:var(--brand); color:#fff; border-color:var(--brand); }
    .uc-btn.primary:hover { background:var(--brand-2, #4f46e5); }
    .uc-btn.ai { background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; border:0; }
    .uc-list { display:flex; flex-direction:column; gap:8px; }
    .uc-row { border:1px solid var(--border); border-radius:10px; padding:10px 14px; transition:all .15s; }
    .uc-row:hover { border-color:var(--brand); }
    .uc-row-head { display:flex; gap:12px; align-items:center; cursor:pointer; }
    .uc-row-status { font-size:16px; width:20px; text-align:center; }
    .uc-row-title { flex:1; font-size:13px; font-weight:600; }
    .uc-row-role { font-size:10px; padding:2px 8px; border-radius:999px; background:#f1f5f9; color:var(--text-2); text-transform:uppercase; letter-spacing:0.3px; }
    .uc-row-meta { font-size:11px; color:var(--text-3); }
    .uc-row-body { margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:none; }
    .uc-row.expanded .uc-row-body { display:block; }
    .uc-row-body pre { background:#f8fafc; border-radius:6px; padding:8px 10px; font-size:11px; font-family:'JetBrains Mono',monospace; white-space:pre-wrap; margin:4px 0; }
    .uc-fail-reason { margin-top:6px; padding:8px 10px; background:#fef2f2; border-left:3px solid #dc2626; border-radius:4px; font-size:12px; color:#7f1d1d; }
    .uc-row-actions { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
    .uc-mini-btn { font-size:11px; padding:4px 10px; border-radius:6px; border:1px solid var(--border); background:#fff; cursor:pointer; }
    .uc-mini-btn.danger { color:#dc2626; border-color:#fecaca; }
    .uc-mini-btn.danger:hover { background:#fef2f2; }
    .uc-mini-btn.warn { color:#c2410c; border-color:#fed7aa; }
    .uc-mini-btn.warn:hover { background:#fff7ed; }
    .uc-mini-btn.info { color:#0284c7; border-color:#bae6fd; }
    .uc-mini-btn.info:hover { background:#f0f9ff; }

    /* add UC form */
    .uc-form { margin-top:12px; padding:14px; background:#f8fafc; border-radius:10px; display:none; }
    .uc-form.open { display:block; }
    .uc-form input, .uc-form textarea, .uc-form select { width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; font-family:inherit; margin-bottom:8px; background:#fff; }
    .uc-form textarea { min-height:60px; resize:vertical; }
    .uc-form-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }

    /* TZ-footer (ХПВ · inputs · outputs · agents · apis) */
    .tz-footer { margin-top:20px; border:1px solid var(--border); border-radius:16px; background:linear-gradient(180deg,#fafbff 0%,#fff 100%); padding:22px 24px; }
    .tz-footer-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border); }
    .tz-footer-title { font-size:16px; font-weight:700; display:flex; gap:10px; align-items:center; }
    .tz-footer-title .tz-owner { font-size:10px; background:#eff2ff; color:#4338ca; padding:2px 10px; border-radius:999px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; }
    .tz-footer-sub { font-size:12px; color:var(--text-3); font-weight:500; }

    .tz-purpose { font-size:13px; color:var(--text-2); margin-bottom:16px; padding:12px 14px; background:#eff6ff; border-left:3px solid var(--brand); border-radius:6px; }

    .tz-grid-io { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
    @media (max-width:700px) { .tz-grid-io { grid-template-columns:1fr; } }
    .tz-io-card { background:#fff; border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
    .tz-io-head { font-size:11px; font-weight:700; color:var(--text-2); text-transform:uppercase; letter-spacing:.4px; margin-bottom:10px; display:flex; gap:6px; align-items:center; }
    .tz-io-head .tz-arrow { font-size:14px; }
    .tz-io-list { display:flex; flex-direction:column; gap:6px; }
    .tz-io-row { display:flex; gap:8px; font-size:12px; align-items:center; padding:4px 0; }
    .tz-io-name { font-weight:600; color:var(--text); font-family:'JetBrains Mono',monospace; font-size:11px; }
    .tz-io-arr { color:#cbd5e1; font-size:10px; }
    .tz-io-src { color:var(--text-2); font-family:'JetBrains Mono',monospace; font-size:11px; flex:1; }
    .tz-io-badge { font-size:9px; font-weight:700; padding:2px 6px; border-radius:999px; background:#fee2e2; color:#991b1b; text-transform:uppercase; letter-spacing:.3px; }
    .tz-io-badge.opt { background:#f1f5f9; color:#64748b; }
    .tz-io-trigger { font-size:10px; color:var(--text-3); font-style:italic; }

    .tz-fab { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px; }
    @media (max-width:700px) { .tz-fab { grid-template-columns:1fr; } }
    .tz-fab-col { padding:14px 16px; border-radius:10px; }
    .tz-fab-col.feat { background:linear-gradient(135deg,#fef3c7 0%,#fef08a 100%); border:1px solid #fbbf24; }
    .tz-fab-col.adv { background:linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%); border:1px solid #60a5fa; }
    .tz-fab-col.ben { background:linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%); border:1px solid #4ade80; }
    .tz-fab-head { font-size:12px; font-weight:800; margin-bottom:10px; display:flex; gap:6px; align-items:center; text-transform:uppercase; letter-spacing:.3px; }
    .tz-fab-col.feat .tz-fab-head { color:#92400e; }
    .tz-fab-col.adv .tz-fab-head  { color:#1e40af; }
    .tz-fab-col.ben .tz-fab-head  { color:#14532d; }
    .tz-fab-list { display:flex; flex-direction:column; gap:6px; font-size:12px; line-height:1.5; }
    .tz-fab-list .tz-fab-item { display:flex; gap:6px; align-items:flex-start; }
    .tz-fab-list .tz-fab-item::before { content:'·'; font-weight:700; flex-shrink:0; }
    .tz-fab-col.feat .tz-fab-item { color:#78350f; }
    .tz-fab-col.adv .tz-fab-item  { color:#1e3a8a; }
    .tz-fab-col.ben .tz-fab-item  { color:#166534; }

    .tz-meta { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding-top:14px; border-top:1px solid var(--border); }
    @media (max-width:700px) { .tz-meta { grid-template-columns:1fr; } }
    .tz-meta-row { display:flex; gap:10px; align-items:flex-start; }
    .tz-meta-label { font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:.3px; min-width:60px; flex-shrink:0; padding-top:3px; }
    .tz-meta-chips { display:flex; gap:5px; flex-wrap:wrap; }
    .tz-meta-chip { font-size:11px; padding:3px 9px; border-radius:6px; background:#f1f5f9; color:var(--text); font-weight:500; font-family:'JetBrains Mono',monospace; }
    .tz-meta-chip.agent { background:#f3e8ff; color:#6d28d9; }
    .tz-meta-chip.api { background:#0f172a; color:#e2e8f0; font-size:10px; }

    .tz-sparse { padding:24px; background:#fffbeb; border:1px dashed #f59e0b; border-radius:10px; text-align:center; color:#92400e; font-size:13px; }
    .tz-sparse strong { display:block; margin-bottom:4px; color:#78350f; }

    /* Debug bar — floating button */
    .dbg-fab { position:fixed; bottom:24px; right:24px; width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg,#1e1b4b,#5b21b6); color:#fff; border:0; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 10px 25px -5px rgba(91,33,182,.5); transition:all .2s; z-index:9998; }
    .dbg-fab:hover { transform:translateY(-2px) scale(1.05); box-shadow:0 15px 30px -5px rgba(91,33,182,.6); }
    .dbg-fab .dbg-badge { position:absolute; top:-4px; right:-4px; background:#dc2626; color:#fff; font-size:10px; font-weight:700; min-width:18px; height:18px; border-radius:9px; display:flex; align-items:center; justify-content:center; padding:0 5px; }

    /* Debug drawer */
    .dbg-drawer { position:fixed; top:0; right:0; width:420px; max-width:100vw; height:100vh; background:#0f172a; color:#e2e8f0; box-shadow:-20px 0 40px -10px rgba(0,0,0,.3); transform:translateX(100%); transition:transform .3s cubic-bezier(.4,0,.2,1); z-index:9999; display:flex; flex-direction:column; }
    .dbg-drawer.open { transform:translateX(0); }
    .dbg-drawer-head { padding:18px 20px; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; }
    .dbg-drawer-title { font-size:15px; font-weight:700; display:flex; gap:10px; align-items:center; }
    .dbg-drawer-close { background:transparent; border:0; color:#94a3b8; font-size:22px; cursor:pointer; line-height:1; }
    .dbg-drawer-close:hover { color:#fff; }
    .dbg-drawer-body { flex:1; overflow-y:auto; padding:18px 20px; }
    .dbg-tabs { display:flex; gap:4px; margin-bottom:16px; background:#1e293b; padding:3px; border-radius:8px; }
    .dbg-tab { flex:1; padding:6px 10px; background:transparent; border:0; color:#94a3b8; font-size:12px; font-weight:600; cursor:pointer; border-radius:6px; }
    .dbg-tab.active { background:#334155; color:#fff; }
    .dbg-label { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#94a3b8; margin-bottom:6px; margin-top:14px; font-weight:600; }
    .dbg-label:first-child { margin-top:0; }
    .dbg-input, .dbg-textarea, .dbg-select { width:100%; padding:10px 12px; background:#1e293b; border:1px solid #334155; color:#e2e8f0; border-radius:8px; font-size:13px; font-family:inherit; }
    .dbg-textarea { min-height:90px; resize:vertical; }
    .dbg-chips { display:flex; gap:6px; flex-wrap:wrap; }
    .dbg-chip { padding:6px 12px; background:#1e293b; border:1px solid #334155; color:#cbd5e1; border-radius:999px; font-size:12px; cursor:pointer; font-weight:500; }
    .dbg-chip.active { border-color:#8b5cf6; color:#fff; background:#4c1d95; }
    .dbg-chip.sev-low.active { background:#0c4a6e; border-color:#0284c7; }
    .dbg-chip.sev-med.active { background:#713f12; border-color:#eab308; }
    .dbg-chip.sev-high.active { background:#7c2d12; border-color:#ea580c; }
    .dbg-chip.sev-blocker.active { background:#7f1d1d; border-color:#dc2626; }
    .dbg-submit { width:100%; margin-top:14px; padding:12px; background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; border:0; border-radius:10px; font-weight:700; cursor:pointer; font-size:13px; }
    .dbg-submit:hover { transform:translateY(-1px); }
    .dbg-feed { display:flex; flex-direction:column; gap:10px; }
    .dbg-feed-item { padding:10px 12px; background:#1e293b; border-radius:8px; border-left:3px solid var(--c); }
    .dbg-feed-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:11px; color:#94a3b8; }
    .dbg-feed-text { font-size:12px; color:#e2e8f0; line-height:1.5; }
    .dbg-empty { text-align:center; padding:24px 10px; color:#64748b; font-size:12px; }

    /* Code tab */
    .dbg-code-subtabs { display:flex; gap:3px; margin-bottom:12px; background:#1e293b; padding:3px; border-radius:8px; }
    .dbg-code-subtab { flex:1; padding:6px 8px; background:transparent; border:0; color:#94a3b8; font-size:11px; font-weight:600; cursor:pointer; border-radius:5px; }
    .dbg-code-subtab.active { background:#334155; color:#fff; }
    .dbg-code-panel { }
    .dbg-code-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    .dbg-code-title { font-size:11px; color:#cbd5e1; font-weight:600; }
    .dbg-code-copy { background:#334155; border:0; color:#e2e8f0; padding:4px 10px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; }
    .dbg-code-copy:hover { background:#475569; }
    .dbg-code-pre { background:#020617; color:#cbd5e1; padding:10px 12px; border-radius:8px; font-size:10px; line-height:1.5; max-height:300px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-family:'JetBrains Mono',monospace; margin:0; }
    .dbg-code-hint { margin-top:8px; font-size:10px; color:#64748b; font-style:italic; }
    .dbg-trail-row { display:flex; gap:10px; padding:8px 10px; background:#1e293b; border-radius:6px; margin-bottom:4px; }
    .dbg-trail-num { background:#4c1d95; color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; }
    .dbg-trail-sel { font-family:'JetBrains Mono',monospace; font-size:10px; color:#c4b5fd; background:#0f172a; padding:2px 6px; border-radius:4px; }
    .dbg-trail-txt { font-size:11px; color:#e2e8f0; margin-top:3px; font-style:italic; }
    .dbg-trail-time { font-size:10px; color:#64748b; margin-top:2px; }
    .dbg-err-row { padding:8px 10px; background:#450a0a; border-radius:6px; margin-bottom:4px; border-left:3px solid #dc2626; }
    .dbg-err-head { font-size:10px; color:#fecaca; font-weight:600; margin-bottom:3px; }
    .dbg-err-msg { font-size:11px; color:#fee2e2; font-family:'JetBrains Mono',monospace; }
    .dbg-err-src { font-size:10px; color:#991b1b; font-family:'JetBrains Mono',monospace; margin-top:3px; }
    .dbg-ctx-badge { display:inline-block; margin-left:6px; padding:1px 6px; background:#4c1d95; color:#e9d5ff; border-radius:4px; font-size:9px; font-weight:700; letter-spacing:.3px; }
  `;
  const style = document.createElement('style');
  style.id = 'self-docs-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function mountUCCounter(pageId) {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const existing = topbar.querySelector('.uc-counter');
  if (existing) existing.remove();

  const s = ucStats(pageId);
  const chip = document.createElement('div');
  chip.className = 'uc-counter';
  chip.title = 'Use cases на этой странице — клик чтобы прокрутить к списку';
  chip.innerHTML = `
    <span class="uc-cov">${s.coverage}%</span>
    ${s.passing  ? `<span class="uc-pill pass">🟢${s.passing}</span>` : ''}
    ${s.failing  ? `<span class="uc-pill fail">🔴${s.failing}</span>` : ''}
    ${s.untested ? `<span class="uc-pill untested">⚪${s.untested}</span>` : ''}
    ${s.flaky    ? `<span class="uc-pill flaky">🟡${s.flaky}</span>` : ''}
    ${s.specOnly ? `<span class="uc-pill spec">🔵${s.specOnly}</span>` : ''}
  `;
  chip.onclick = () => {
    const footer = document.querySelector('.uc-footer');
    if (footer) footer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // insert after the search
  const search = topbar.querySelector('.search');
  if (search) search.after(chip);
  else topbar.prepend(chip);
}

function mountUCFooter(pageId) {
  const content = document.getElementById('page-content');
  if (!content) return;
  const existing = content.querySelector('.uc-footer');
  if (existing) existing.remove();

  const ucs = STORAGE.listUseCases(pageId);
  const page = PAGES[pageId];
  const footer = document.createElement('div');
  footer.className = 'uc-footer';
  footer.innerHTML = `
    <div class="uc-footer-head">
      <div class="uc-footer-title">
        🎯 Use cases
        <span class="uc-count-badge">${ucs.length}</span>
        <span style="font-size:12px;color:var(--text-3);font-weight:500">· ${page.title}</span>
      </div>
      <div class="uc-actions">
        <button class="uc-btn" onclick="toggleUCForm()">+ Добавить</button>
        <button class="uc-btn" onclick="alert('🎙 Voice-input в фазе 3')">🎙 Надиктовать</button>
        <button class="uc-btn ai" onclick="aiGenerateUC('${pageId}')">✨ AI-нагенерить</button>
      </div>
    </div>

    <form class="uc-form" id="uc-form" onsubmit="submitUC(event, '${pageId}')">
      <div class="uc-form-row">
        <input name="title" placeholder="Название (напр. «Админ одобряет expense > $500»)" required/>
        <select name="role">
          <option value="admin">admin</option>
          <option value="foreman">foreman</option>
          <option value="worker">worker</option>
          <option value="client">client</option>
          <option value="system">system</option>
        </select>
      </div>
      <textarea name="preconditions" placeholder="Предусловия (по одному на строку)"></textarea>
      <textarea name="steps" placeholder="Шаги: action | expected (по одному на строку, разделитель |)"></textarea>
      <select name="status">
        <option value="draft">draft (по умолчанию)</option>
        <option value="untested">untested (готов к прогону)</option>
        <option value="spec-only">spec-only (фича ещё не существует)</option>
      </select>
      <div style="display:flex;gap:6px">
        <button type="submit" class="uc-btn primary">Сохранить</button>
        <button type="button" class="uc-btn" onclick="toggleUCForm()">Отмена</button>
      </div>
    </form>

    <div class="uc-list" id="uc-list">
      ${ucs.map(uc => ucRowHTML(uc)).join('') || '<div style="text-align:center;color:var(--text-3);padding:24px;font-size:13px">Пока нет UC. Нажми «+ Добавить» или «✨ AI-нагенерить».</div>'}
    </div>
  `;
  content.appendChild(footer);
}

function ucRowHTML(uc) {
  const m = UC_STATUS_META[uc.status] || UC_STATUS_META['draft'];
  const lastRunTxt = uc.lastRun ? `· ${timeAgo(uc.lastRun)}` : '';
  const preconds = (uc.preconditions || []).map(p => `• ${escapeHtml(p)}`).join('\n');
  const stepsTxt = (uc.steps || []).map((s, i) => `${i + 1}. ${escapeHtml(s.action)}\n   → ${escapeHtml(s.expected)}`).join('\n\n');
  return `
    <div class="uc-row" id="ucrow-${uc.id}">
      <div class="uc-row-head" onclick="toggleUC('${uc.id}')">
        <span class="uc-row-status" title="${m.label}">${m.emoji}</span>
        <span class="uc-row-title">${escapeHtml(uc.title)}</span>
        <span class="uc-row-role">${uc.role}</span>
        <span class="uc-row-meta">${uc.source} ${lastRunTxt}</span>
      </div>
      <div class="uc-row-body">
        ${preconds ? `<div><strong style="font-size:11px;color:var(--text-2)">Pre:</strong><pre>${preconds}</pre></div>` : ''}
        ${stepsTxt ? `<div><strong style="font-size:11px;color:var(--text-2)">Steps:</strong><pre>${stepsTxt}</pre></div>` : ''}
        ${uc.failureReason ? `<div class="uc-fail-reason"><strong>Почему падает:</strong> ${escapeHtml(uc.failureReason)}</div>` : ''}
        <div class="uc-row-actions">
          <button class="uc-mini-btn info" onclick="runUC('${uc.id}')">▶ Прогнать</button>
          <button class="uc-mini-btn warn" onclick="ucToBug('${uc.id}')">🐛 В баг</button>
          <button class="uc-mini-btn info" onclick="ucToSpec('${uc.id}')">📝 В ТЗ</button>
          <button class="uc-mini-btn danger" onclick="deleteUC('${uc.id}')">🗑 Удалить</button>
        </div>
      </div>
    </div>
  `;
}

function toggleUC(id) {
  document.getElementById(`ucrow-${id}`).classList.toggle('expanded');
}

function toggleUCForm() {
  document.getElementById('uc-form').classList.toggle('open');
}

function submitUC(e, pageId) {
  e.preventDefault();
  const f = e.target;
  const preconditions = (f.preconditions.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const steps = (f.steps.value || '').split('\n').map(line => {
    const [action, expected] = line.split('|').map(s => (s || '').trim());
    return action ? { action, expected: expected || '' } : null;
  }).filter(Boolean);
  STORAGE.saveUseCase({
    pageId,
    title: f.title.value.trim(),
    role: f.role.value,
    preconditions,
    steps,
    status: f.status.value,
    source: 'manual',
    createdBy: STORAGE.currentUser(),
  });
  f.reset();
  mountSelfDocs(pageId);
}

function runUC(id) {
  const uc = STORAGE.listUseCases().find(u => u.id === id);
  if (!uc) return;
  const passed = confirm(`Прогнать UC:\n\n"${uc.title}"\n\n✅ OK = passed\n❌ Cancel = failed`);
  STORAGE.saveUseCase({
    ...uc,
    status: passed ? 'passing' : 'failing',
    lastRun: new Date().toISOString(),
    failureReason: passed ? null : (prompt('Причина падения:') || 'ручной fail'),
  });
  mountSelfDocs(uc.pageId);
}

function ucToBug(id) {
  const uc = STORAGE.listUseCases().find(u => u.id === id);
  if (!uc) return;
  const note = prompt(`В баг превращаем:\n"${uc.title}"\n\nДобавить заметку:`, '') || '';
  STORAGE.saveFeedback({
    pageId: uc.pageId,
    type: 'bug',
    severity: 'med',
    text: `UC failed: ${uc.title}\n${note}`,
    linkedUseCase: uc.id,
    createdBy: STORAGE.currentUser(),
  });
  STORAGE.saveUseCase({ ...uc, status: 'failing', failureReason: note || 'converted to bug' });
  mountSelfDocs(uc.pageId);
  alert('🐛 Баг создан, UC помечен failing. Смотри _feedback.html');
}

function ucToSpec(id) {
  const uc = STORAGE.listUseCases().find(u => u.id === id);
  if (!uc) return;
  STORAGE.saveUseCase({ ...uc, status: 'spec-only' });
  mountSelfDocs(uc.pageId);
  alert('📝 Помечен как spec-only — попадёт в roadmap в _master_tz.html');
}

function deleteUC(id) {
  const uc = STORAGE.listUseCases().find(u => u.id === id);
  if (!uc) return;
  if (!confirm(`Удалить UC?\n"${uc.title}"`)) return;
  STORAGE.deleteUseCase(id);
  mountSelfDocs(uc.pageId);
}

function aiGenerateUC(pageId) {
  const page = PAGES[pageId];
  // Prototype mode: seed plausible AI-candidates. In prod — call Claude API.
  const candidates = [
    { title: `Пустое состояние на ${page.title}`, role: 'admin', status: 'draft',
      preconditions: ['все записи удалены'], steps: [{ action: 'открыть страницу', expected: 'empty state сообщение, не ошибка' }] },
    { title: `Responsive: ${page.title} на 375px мобилке`, role: 'admin', status: 'untested',
      preconditions: ['viewport 375px'], steps: [{ action: 'открыть на телефоне', expected: 'таблица scrollable, кнопки кликабельные' }] },
    { title: `Keyboard: навигация Tab/Enter по очереди approvals`, role: 'admin', status: 'spec-only',
      preconditions: ['a11y включена'], steps: [{ action: 'Tab → Enter', expected: 'focus visible, approve работает' }] },
  ];
  const picked = confirm(`AI сгенерировал ${candidates.length} кандидатов:\n\n${candidates.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}\n\n✅ OK = добавить все\n❌ Cancel = не добавлять`);
  if (!picked) return;
  candidates.forEach(c => STORAGE.saveUseCase({ pageId, source: 'ai-generated', createdBy: 'claude', ...c }));
  mountSelfDocs(pageId);
}

// ─── TZ-FOOTER (inputs / outputs / ХПВ / agents / apis) ───────────────────

function mountTzFooter(pageId) {
  const content = document.getElementById('page-content');
  if (!content) return;
  const existing = content.querySelector('.tz-footer');
  if (existing) existing.remove();

  const page = PAGES[pageId];
  const hasFullSpec = !!(page.purpose || (page.inputs && page.inputs.length) || (page.features && page.features.length));

  const footer = document.createElement('div');
  footer.className = 'tz-footer';

  if (!hasFullSpec) {
    footer.innerHTML = `
      <div class="tz-footer-head">
        <div class="tz-footer-title">📋 ТЗ страницы
          ${page.owner ? `<span class="tz-owner">owner: ${page.owner}</span>` : ''}
        </div>
        <div class="tz-footer-sub">· ${page.title}</div>
      </div>
      <div class="tz-sparse">
        <strong>Sparse spec — полные данные не заполнены</strong>
        Добавь в <code style="background:#fff7ed;padding:2px 6px;border-radius:4px">PAGES['${pageId}']</code> поля: <code>purpose · inputs · outputs · features · advantages · benefits · agents · apis</code>
      </div>
    `;
    content.appendChild(footer);
    return;
  }

  const inputs  = page.inputs  || [];
  const outputs = page.outputs || [];
  const feats   = page.features   || [];
  const advs    = page.advantages || [];
  const bens    = page.benefits   || [];
  const agents  = page.agents || [];
  const apis    = page.apis || [];

  footer.innerHTML = `
    <div class="tz-footer-head">
      <div class="tz-footer-title">📋 ТЗ страницы
        ${page.owner ? `<span class="tz-owner">owner: ${page.owner}</span>` : ''}
      </div>
      <div class="tz-footer-sub">· ${page.title}</div>
    </div>

    ${page.purpose ? `<div class="tz-purpose">🎯 ${escapeHtml(page.purpose)}</div>` : ''}

    <div class="tz-grid-io">
      <div class="tz-io-card">
        <div class="tz-io-head"><span class="tz-arrow">⇠</span> Inputs — что приходит</div>
        <div class="tz-io-list">
          ${inputs.length ? inputs.map(i => `
            <div class="tz-io-row">
              <span class="tz-io-name">${escapeHtml(i.name)}</span>
              <span class="tz-io-arr">←</span>
              <span class="tz-io-src">${escapeHtml(i.from)}</span>
              <span class="tz-io-badge ${i.required ? '' : 'opt'}">${i.required ? 'required' : 'optional'}</span>
            </div>
          `).join('') : '<div class="tz-io-row" style="color:var(--text-3);font-size:11px">— пусто —</div>'}
        </div>
      </div>

      <div class="tz-io-card">
        <div class="tz-io-head"><span class="tz-arrow">⇢</span> Outputs — что уходит</div>
        <div class="tz-io-list">
          ${outputs.length ? outputs.map(o => `
            <div class="tz-io-row">
              <span class="tz-io-name">${escapeHtml(o.name)}</span>
              <span class="tz-io-arr">→</span>
              <span class="tz-io-src">${escapeHtml(o.to)}</span>
              <span class="tz-io-trigger">${escapeHtml(o.trigger || '')}</span>
            </div>
          `).join('') : '<div class="tz-io-row" style="color:var(--text-3);font-size:11px">— пусто —</div>'}
        </div>
      </div>
    </div>

    <div class="tz-fab">
      <div class="tz-fab-col feat">
        <div class="tz-fab-head">📊 Характеристики</div>
        <div class="tz-fab-list">
          ${feats.length ? feats.map(f => `<div class="tz-fab-item">${escapeHtml(f)}</div>`).join('') : '<div style="font-size:11px;opacity:.6">— пусто —</div>'}
        </div>
      </div>
      <div class="tz-fab-col adv">
        <div class="tz-fab-head">🚀 Преимущества</div>
        <div class="tz-fab-list">
          ${advs.length ? advs.map(a => `<div class="tz-fab-item">${escapeHtml(a)}</div>`).join('') : '<div style="font-size:11px;opacity:.6">— пусто —</div>'}
        </div>
      </div>
      <div class="tz-fab-col ben">
        <div class="tz-fab-head">💰 Выгоды</div>
        <div class="tz-fab-list">
          ${bens.length ? bens.map(b => `<div class="tz-fab-item">${escapeHtml(b)}</div>`).join('') : '<div style="font-size:11px;opacity:.6">— пусто —</div>'}
        </div>
      </div>
    </div>

    <div class="tz-meta">
      <div class="tz-meta-row">
        <span class="tz-meta-label">🤖 Агенты</span>
        <div class="tz-meta-chips">
          ${agents.length ? agents.map(a => `<span class="tz-meta-chip agent">${escapeHtml(a)}</span>`).join('') : '<span style="font-size:11px;color:var(--text-3)">— нет —</span>'}
        </div>
      </div>
      <div class="tz-meta-row">
        <span class="tz-meta-label">🔌 APIs</span>
        <div class="tz-meta-chips">
          ${apis.length ? apis.map(a => `<span class="tz-meta-chip api">${escapeHtml(a)}</span>`).join('') : '<span style="font-size:11px;color:var(--text-3)">— нет —</span>'}
        </div>
      </div>
    </div>
  `;
  content.appendChild(footer);
}

// ─── DEBUG BAR ─────────────────────────────────────────────────────────────

function mountDebugBar(pageId) {
  window.__currentDbgPageId = pageId;
  if (document.querySelector('.dbg-fab')) document.querySelector('.dbg-fab').remove();
  if (document.querySelector('.dbg-drawer')) document.querySelector('.dbg-drawer').remove();

  const fbCount = STORAGE.listFeedback(pageId).length;
  const fab = document.createElement('button');
  fab.className = 'dbg-fab';
  fab.title = 'Оставить фидбек по этой странице';
  fab.innerHTML = `🐛 ${fbCount ? `<span class="dbg-badge">${fbCount}</span>` : ''}`;
  fab.onclick = () => toggleDebugDrawer(pageId);
  document.body.appendChild(fab);

  const drawer = document.createElement('div');
  drawer.className = 'dbg-drawer';
  drawer.innerHTML = `
    <div class="dbg-drawer-head">
      <div class="dbg-drawer-title">🐛 Debug · ${PAGES[pageId].title}</div>
      <button class="dbg-drawer-close" onclick="toggleDebugDrawer()">×</button>
    </div>
    <div class="dbg-drawer-body">
      <div class="dbg-tabs">
        <button class="dbg-tab active" onclick="switchDbgTab(event,'submit')">📝 Оставить</button>
        <button class="dbg-tab" onclick="switchDbgTab(event,'list')">📋 История (${fbCount})</button>
        <button class="dbg-tab" onclick="switchDbgTab(event,'code')">🔬 Код</button>
      </div>

      <div id="dbg-tab-submit">
        <div class="dbg-label">Тип</div>
        <div class="dbg-chips" id="dbg-type-chips">
          <button class="dbg-chip active" data-val="improvement" onclick="toggleDbgChip(event,'type')">💡 Улучшить</button>
          <button class="dbg-chip" data-val="bug" onclick="toggleDbgChip(event,'type')">🐛 Не работает</button>
        </div>

        <div class="dbg-label">Severity</div>
        <div class="dbg-chips" id="dbg-sev-chips">
          <button class="dbg-chip sev-low active" data-val="low" onclick="toggleDbgChip(event,'sev')">Low</button>
          <button class="dbg-chip sev-med" data-val="med" onclick="toggleDbgChip(event,'sev')">Medium</button>
          <button class="dbg-chip sev-high" data-val="high" onclick="toggleDbgChip(event,'sev')">High</button>
          <button class="dbg-chip sev-blocker" data-val="blocker" onclick="toggleDbgChip(event,'sev')">Blocker</button>
        </div>

        <div class="dbg-label">Описание</div>
        <textarea class="dbg-textarea" id="dbg-text" placeholder="Что улучшить / что не работает. Будь конкретен: «кнопка approve на строке Михаила не реагирует».\n\nScreenshot добавится автоматически в фазе 3."></textarea>

        <button class="dbg-submit" onclick="submitFeedback('${pageId}')">💾 Сохранить фидбек</button>
      </div>

      <div id="dbg-tab-list" style="display:none">
        <div class="dbg-feed" id="dbg-feed"></div>
      </div>

      <div id="dbg-tab-code" style="display:none">
        <div class="dbg-code-subtabs">
          <button class="dbg-code-subtab active" onclick="switchCodeSubtab(event,'live')">Live DOM</button>
          <button class="dbg-code-subtab" onclick="switchCodeSubtab(event,'source')">Source file</button>
          <button class="dbg-code-subtab" onclick="switchCodeSubtab(event,'trail')">Click trail</button>
          <button class="dbg-code-subtab" onclick="switchCodeSubtab(event,'errors')">Errors</button>
        </div>

        <div id="dbg-code-panel-live" class="dbg-code-panel">
          <div class="dbg-code-head">
            <span class="dbg-code-title">DOM в момент открытия · <span id="dbg-live-size">?</span> KB</span>
            <button class="dbg-code-copy" onclick="copyCode('live')">📋 Copy</button>
          </div>
          <pre class="dbg-code-pre" id="dbg-code-live"></pre>
          <div class="dbg-code-hint">outerHTML всей страницы, то что реально видит юзер (после JS-рендера).</div>
        </div>

        <div id="dbg-code-panel-source" class="dbg-code-panel" style="display:none">
          <div class="dbg-code-head">
            <span class="dbg-code-title">Исходник файла · <span id="dbg-src-size">?</span> KB</span>
            <button class="dbg-code-copy" onclick="copyCode('source')">📋 Copy</button>
          </div>
          <pre class="dbg-code-pre" id="dbg-code-source"></pre>
          <div class="dbg-code-hint">fetch(location.pathname) — оригинал из git, до JS-рендера.</div>
        </div>

        <div id="dbg-code-panel-trail" class="dbg-code-panel" style="display:none">
          <div class="dbg-code-head">
            <span class="dbg-code-title">Последние клики · ring buffer [10]</span>
            <button class="dbg-code-copy" onclick="copyCode('trail')">📋 Copy</button>
          </div>
          <div id="dbg-code-trail"></div>
          <div class="dbg-code-hint">Каждый клик записывает selector + текст + время. Прикладывается к feedback автоматом.</div>
        </div>

        <div id="dbg-code-panel-errors" class="dbg-code-panel" style="display:none">
          <div class="dbg-code-head">
            <span class="dbg-code-title">Console errors · последние 10</span>
            <button class="dbg-code-copy" onclick="copyCode('errors')">📋 Copy</button>
          </div>
          <div id="dbg-code-errors"></div>
          <div class="dbg-code-hint">Intercept window.onerror + console.error. Пустой список = всё хорошо.</div>
        </div>

        <div style="margin-top:14px; padding:10px 12px; background:#1e293b; border-radius:8px; border-left:3px solid #8b5cf6; font-size:11px; color:#cbd5e1; line-height:1.6;">
          <strong style="color:#c4b5fd">🤖 При submit фидбека</strong> — весь этот context автоматом прикладывается. AI-Triage получает ready-to-patch пакет: жалоба + код + клики + ошибки.
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(drawer);
}

function toggleDebugDrawer(pageId) {
  const d = document.querySelector('.dbg-drawer');
  if (!d) return;
  d.classList.toggle('open');
  if (d.classList.contains('open') && pageId) {
    renderDbgFeed(pageId);
    loadCodeTab();
  }
}

function switchDbgTab(e, tab) {
  document.querySelectorAll('.dbg-tab').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('dbg-tab-submit').style.display = tab === 'submit' ? 'block' : 'none';
  document.getElementById('dbg-tab-list').style.display   = tab === 'list'   ? 'block' : 'none';
  document.getElementById('dbg-tab-code').style.display   = tab === 'code'   ? 'block' : 'none';
  if (tab === 'code') loadCodeTab();
  if (tab === 'list') {
    const fab = document.querySelector('.dbg-fab');
    const m = fab?.textContent.match(/(\d+)/);
    const pageId = window.__currentDbgPageId;
    if (pageId) renderDbgFeed(pageId);
  }
}

function switchCodeSubtab(e, sub) {
  document.querySelectorAll('.dbg-code-subtab').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  ['live','source','trail','errors'].forEach(s => {
    const p = document.getElementById(`dbg-code-panel-${s}`);
    if (p) p.style.display = s === sub ? 'block' : 'none';
  });
}

async function loadCodeTab() {
  // Live DOM
  const livePre = document.getElementById('dbg-code-live');
  if (livePre) {
    const dom = document.documentElement.outerHTML.slice(0, 50_000);
    livePre.textContent = dom;
    const sizeEl = document.getElementById('dbg-live-size');
    if (sizeEl) sizeEl.textContent = (new Blob([dom]).size / 1024).toFixed(1);
  }

  // Source file
  const srcPre = document.getElementById('dbg-code-source');
  if (srcPre) {
    if (!window.__sourceCache) {
      try {
        const r = await fetch(window.location.pathname);
        window.__sourceCache = await r.text();
      } catch (e) { window.__sourceCache = `// fetch error: ${e.message}`; }
    }
    srcPre.textContent = window.__sourceCache.slice(0, 50_000);
    const sizeEl = document.getElementById('dbg-src-size');
    if (sizeEl) sizeEl.textContent = (new Blob([window.__sourceCache]).size / 1024).toFixed(1);
  }

  // Click trail
  const trail = document.getElementById('dbg-code-trail');
  if (trail) {
    const clicks = (window.__lastClicks || []).slice().reverse();
    if (!clicks.length) {
      trail.innerHTML = '<div class="dbg-empty">Ещё не кликал. Закрой drawer, покликай по странице, открой снова.</div>';
    } else {
      trail.innerHTML = clicks.map((c, i) => `
        <div class="dbg-trail-row">
          <span class="dbg-trail-num">${clicks.length - i}</span>
          <div>
            <code class="dbg-trail-sel">${escapeHtml(c.selector)}</code>
            ${c.text ? `<div class="dbg-trail-txt">"${escapeHtml(c.text)}"</div>` : ''}
            <div class="dbg-trail-time">${timeAgo(c.at)}</div>
          </div>
        </div>
      `).join('');
    }
  }

  // Console errors
  const errs = document.getElementById('dbg-code-errors');
  if (errs) {
    const list = (window.__consoleErrors || []).slice().reverse();
    if (!list.length) {
      errs.innerHTML = '<div class="dbg-empty" style="color:#22c55e">✓ Ни одной ошибки за сессию</div>';
    } else {
      errs.innerHTML = list.map(e => `
        <div class="dbg-err-row">
          <div class="dbg-err-head">${escapeHtml(e.type)} · ${timeAgo(e.at)}</div>
          <div class="dbg-err-msg">${escapeHtml(e.message)}</div>
          ${e.source ? `<div class="dbg-err-src">${escapeHtml(e.source)}:${e.line}</div>` : ''}
        </div>
      `).join('');
    }
  }
}

function copyCode(which) {
  let text = '';
  if      (which === 'live')   text = document.getElementById('dbg-code-live').textContent;
  else if (which === 'source') text = document.getElementById('dbg-code-source').textContent;
  else if (which === 'trail')  text = JSON.stringify(window.__lastClicks || [], null, 2);
  else if (which === 'errors') text = JSON.stringify(window.__consoleErrors || [], null, 2);
  navigator.clipboard.writeText(text).then(
    () => { const btn = event.target; const orig = btn.textContent; btn.textContent = '✓ Скопировано'; setTimeout(() => btn.textContent = orig, 1200); },
    () => alert('Не удалось скопировать')
  );
}

function toggleDbgChip(e, group) {
  const sel = group === 'type' ? '#dbg-type-chips .dbg-chip' : '#dbg-sev-chips .dbg-chip';
  document.querySelectorAll(sel).forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
}

async function submitFeedback(pageId) {
  const type = document.querySelector('#dbg-type-chips .dbg-chip.active')?.dataset.val || 'improvement';
  const sev  = document.querySelector('#dbg-sev-chips .dbg-chip.active')?.dataset.val || 'low';
  const text = document.getElementById('dbg-text').value.trim();
  if (!text) { alert('Опиши что не так или что улучшить'); return; }

  const submitBtn = document.querySelector('.dbg-submit');
  if (submitBtn) { submitBtn.textContent = '⏳ Собираю context...'; submitBtn.disabled = true; }

  const context = await captureContext(pageId);

  STORAGE.saveFeedback({
    pageId, type, severity: sev, text,
    createdBy: STORAGE.currentUser(),
    screenshot: null, // phase-3: html2canvas
    context,
  });
  document.getElementById('dbg-text').value = '';
  const drawer = document.querySelector('.dbg-drawer');
  if (drawer) drawer.classList.remove('open');
  mountDebugBar(pageId);

  const ctxKb = ((new Blob([JSON.stringify(context)]).size) / 1024).toFixed(1);
  setTimeout(() => alert(`✅ Сохранено с context (~${ctxKb} KB):\n• URL · viewport · DOM snapshot\n• ${context.lastClicks.length} последних кликов\n• ${context.consoleErrors.length} ошибок\n• source file\n\nСмотри _feedback.html (след. фаза).`), 100);
}

function renderDbgFeed(pageId) {
  const list = STORAGE.listFeedback(pageId).reverse();
  const wrap = document.getElementById('dbg-feed');
  if (!wrap) return;
  if (!list.length) { wrap.innerHTML = '<div class="dbg-empty">Ещё ничего не оставили. Попробуй сейчас — форма слева.</div>'; return; }
  const colorMap = { improvement: '#8b5cf6', bug: '#dc2626' };
  wrap.innerHTML = list.map(f => {
    const ctx = f.context;
    const ctxSize = ctx ? ((new Blob([JSON.stringify(ctx)]).size) / 1024).toFixed(1) : null;
    return `
    <div class="dbg-feed-item" style="--c:${colorMap[f.type]}">
      <div class="dbg-feed-head">
        <span>${f.type === 'bug' ? '🐛' : '💡'} ${f.severity} · ${f.createdBy}
          ${ctxSize ? `<span class="dbg-ctx-badge" title="DOM + source + ${ctx.lastClicks.length} clicks + ${ctx.consoleErrors.length} errors">📎 ${ctxSize}KB</span>` : ''}
        </span>
        <span>${timeAgo(f.createdAt)}</span>
      </div>
      <div class="dbg-feed-text">${escapeHtml(f.text)}</div>
      ${ctx && ctx.lastClicks.length ? `<div style="margin-top:6px;font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace">last click: <span style="color:#c4b5fd">${escapeHtml(ctx.lastClicks.at(-1).selector)}</span></div>` : ''}
    </div>
  `;
  }).join('');
}

// ─── helpers ───────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s назад`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}
