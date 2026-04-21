// meta.js — single source of truth for page metadata, use cases, and feedback.
// Data types:
//   PAGES[id]     — static page spec (purpose, owner, inputs, outputs, FAB, agents)
//   UseCase       — acceptance tests attached to a page (localStorage-backed)
//   Feedback      — bugs/improvements captured via debug bar (localStorage-backed)

// ─── PAGE SPEC (static, hardcoded) ─────────────────────────────────────────
const PAGES = {
  'dashboard': {
    id: 'dashboard',
    title: 'Dashboard',
    file: 'index.html',
    owner: 'admin',
    purpose: 'Role-based home page. Админ/фореман видит pulse компании утром: деньги, смены, approvals, клиенты.',
    inputs: [
      { name: 'workers[]',  from: 'WorkerService',  required: true },
      { name: 'sessions[]', from: 'TimeService',    required: true },
      { name: 'expenses[]', from: 'ExpenseService', required: true },
      { name: 'clients[]',  from: 'ClientService',  required: true },
    ],
    outputs: [
      { name: 'drill-in session', to: 'session-detail.html', trigger: 'row click' },
      { name: 'drill-in expense', to: 'expense-detail.html', trigger: 'row click' },
      { name: 'trigger pay run',  to: 'workers/payouts',     trigger: 'primary button' },
    ],
    features:   ['KPI cards (revenue/labor/materials/balance)', 'Active sessions live', 'Pending approvals', 'Top P&L clients', 'Top workers'],
    advantages: ['Одна страница утром — всё видно', 'Клики ведут в детали без поиска', 'Pending items подсвечены жёлтым'],
    benefits:   ['Экономия 15 мин/день', 'Меньше забытых approvals', 'Понятнее где деньги'],
    agents:     ['kpi-aggregator', 'alert-monitor'],
    apis:       ['GET /api/dashboard/summary', 'POST /api/payroll/run'],
  },

  'expenses': {
    id: 'expenses',
    title: 'Затраты',
    file: 'expenses.html',
    owner: 'finance-admin-agent',
    purpose: 'Админский поток одобрения чеков. Фильтры, очередь approval, категоризация, billable/reimbursable флаги.',
    inputs: [
      { name: 'expenses[]',    from: 'ExpenseService',  required: true },
      { name: 'workers[]',     from: 'WorkerService',   required: true },
      { name: 'clients[]',     from: 'ClientService',   required: true },
      { name: 'ocr-receipts[]', from: 'receipt-ocr-agent', required: false },
    ],
    outputs: [
      { name: 'approve',          to: 'ExpenseService.approve',  trigger: '✓ button' },
      { name: 'reject',           to: 'ExpenseService.reject',   trigger: '✗ button' },
      { name: 'drill-in',         to: 'expense-detail.html',     trigger: 'row click' },
      { name: 'reimburse-trigger', to: 'PayrollService.queue',   trigger: 'batch approve' },
    ],
    features:   ['KPI: approved/pending/billable/reimbursable', 'Category breakdown bar chart', 'Inline approval queue', 'Full expenses table with flags (B/R/receipt)', 'Multi-select filters'],
    advantages: ['Админ видит что ждёт одобрения сразу', 'Можно одобрить не открывая', 'Flags показывают кому что должны'],
    benefits:   ['Approvals за 30 сек вместо 5 мин', '99% чеков категоризированы (auto)', 'Zero забытых reimbursements'],
    agents:     ['receipt-ocr-agent', 'approval-bot', 'category-classifier'],
    apis:       ['GET /api/expenses', 'POST /api/expenses/:id/approve', 'POST /api/expenses/:id/reject'],
  },

  'mobile-worker': {
    id: 'mobile-worker',
    title: 'Mobile worker',
    file: 'mobile-worker.html',
    owner: 'worker-agent',
    purpose: 'Чат-first интерфейс для бригадира на телефоне. Start/stop смен, submit чеков, EOD summary.',
    inputs: [
      { name: 'worker-session', from: 'TimeService',    required: true },
      { name: 'current-client', from: 'ClientService',  required: true },
      { name: 'geo-location',   from: 'device GPS',     required: true },
    ],
    outputs: [
      { name: 'start-shift',    to: 'TimeService.start',    trigger: '✓ в чате' },
      { name: 'submit-expense', to: 'ExpenseService.submit', trigger: 'photo + amount' },
      { name: 'request-day-off', to: 'PlanningService',     trigger: 'меню hub' },
    ],
    features:   ['Chat с личным AI', 'Propose/approve UI', 'Camera receipt + OCR', 'EOD auto-summary', 'Hub быстрых действий'],
    advantages: ['Работник не думает — только да/нет', 'OCR чека за секунду', 'AI помнит контекст смены'],
    benefits:   ['85% смен без ошибок timestamp', '95% чеков submitted в день', '10× быстрее чем форма'],
    agents:     ['worker-agent', 'receipt-ocr-agent', 'location-tracker'],
    apis:       ['POST /api/shifts/start', 'POST /api/expenses/submit'],
  },

  'time': {
    id: 'time', title: 'Время', file: 'time.html', owner: 'time-admin',
    purpose: 'Live-табло активных смен + история + approval queue. Админ видит кто сейчас на каких объектах.',
    inputs: [
      { name: 'sessions[]', from: 'TimeService', required: true },
      { name: 'workers[]', from: 'WorkerService', required: true },
      { name: 'geo-fences', from: 'ClientService', required: false },
    ],
    outputs: [
      { name: 'approve-session', to: 'TimeService.approve', trigger: 'batch button' },
      { name: 'drill-in', to: 'session-detail.html', trigger: 'row click' },
      { name: 'force-stop', to: 'TimeService.stop', trigger: 'stop button' },
    ],
    features: ['Live-feed активных смен', 'Geo-validation indicator', 'Pending approval queue', 'История по периоду', 'Filter по worker/client'],
    advantages: ['Видно кто где прямо сейчас', 'Approve оптом без кликов', 'Geo-ошибки подсвечены'],
    benefits: ['Фантомные смены падают на 90%', 'Approvals за 2 мин вместо 20', 'Fewer disputes с работниками'],
    agents: ['session-watcher', 'geo-validator', 'approval-bot'],
    apis: ['GET /api/sessions/active', 'POST /api/sessions/:id/approve'],
  },

  'clients': {
    id: 'clients', title: 'Клиенты', file: 'clients.html', owner: 'client-manager',
    purpose: 'Список клиентов с P&L-роллапом. Сортировка по margin, filter по статусу проекта.',
    inputs: [
      { name: 'clients[]', from: 'ClientService', required: true },
      { name: 'projects[]', from: 'ProjectService', required: true },
      { name: 'cost-rollup', from: 'ClientCostRollup', required: true },
    ],
    outputs: [
      { name: 'drill-in', to: 'client-overview.html', trigger: 'row click' },
      { name: 'new-client', to: 'ClientService.create', trigger: '+ button' },
    ],
    features: ['Таблица с Revenue / Labor / Materials / Margin', 'Цветная сигнальная margin', 'Progress bar по бюджету', 'Search + filter'],
    advantages: ['Самые убыточные клиенты сверху', 'Сразу видно кого дожать', 'Margin в цвете — zero thinking'],
    benefits: ['Финансовые дыры ловятся за часы', 'Минус 15% бесприбыльных проектов', '30% времени экономии менеджера'],
    agents: ['pl-rollup-agent', 'margin-alerter'],
    apis: ['GET /api/clients', 'GET /api/clients/:id/rollup'],
  },

  'workers': {
    id: 'workers', title: 'Работники', file: 'workers.html', owner: 'hr-agent',
    purpose: 'Список работников с балансами к выплате. Sortable по earned/paid/balance/hours.',
    inputs: [
      { name: 'workers[]', from: 'WorkerService', required: true },
      { name: 'earnings-ledger', from: 'PayrollService', required: true },
      { name: 'payout-history', from: 'PayrollService', required: true },
    ],
    outputs: [
      { name: 'drill-in', to: 'worker-profile.html', trigger: 'row click' },
      { name: 'run-payroll', to: 'PayrollService.queuePayRun', trigger: '+ Pay run button' },
      { name: 'add-worker', to: 'WorkerService.create', trigger: '+ button' },
    ],
    features: ['Колонки: Hours / Earned / Paid / Balance', 'Цветные chips по роли', 'Фильтр по crew', 'Quick pay button inline'],
    advantages: ['Видно кто больше всех заработал / должен', 'Pay run одной кнопкой', 'Crew grouping'],
    benefits: ['Нет забытых выплат', 'Payroll за 5 мин вместо часа', 'Зеро disputes'],
    agents: ['payroll-aggregator', 'balance-validator'],
    apis: ['GET /api/workers', 'POST /api/payroll/run', 'POST /api/workers'],
  },

  'audit': {
    id: 'audit', title: 'Audit log', file: 'audit.html', owner: 'compliance-agent',
    purpose: 'Immutable лог всех действий системы: кто (человек или AI), когда, что, откуда.',
    inputs: [
      { name: 'audit-events[]', from: 'AuditService', required: true },
    ],
    outputs: [
      { name: 'export-range', to: 'AuditService.export', trigger: 'export button' },
      { name: 'drill-source', to: 'source page/event', trigger: 'row click' },
    ],
    features: ['Reverse chron timeline', 'Actor type badges (human/agent/system)', 'Event type filter', 'Date range picker', 'JSON diff viewer'],
    advantages: ['Всё в одном месте', 'AI и человек равноправно', 'Diff показывает что именно изменилось'],
    benefits: ['Compliance reports за 10 мин', 'Spot AI drift за минуту', 'Debug any state mutation'],
    agents: ['audit-writer', 'compliance-reporter'],
    apis: ['GET /api/audit?from=&to=', 'POST /api/audit/export'],
  },

  'a2a': {
    id: 'a2a', title: 'A2A orchestration', file: 'a2a.html', owner: 'admin',
    purpose: 'Визуализация связей между агентами + live message feed + очередь конфликтов для человека.',
    inputs: [
      { name: 'agents[]', from: 'AgentRegistry', required: true },
      { name: 'messages[]', from: 'A2ABus', required: true },
      { name: 'conflicts[]', from: 'ConflictResolver', required: true },
    ],
    outputs: [
      { name: 'resolve-conflict', to: 'ConflictResolver.resolve', trigger: 'resolve button' },
      { name: 'pause-agent', to: 'AgentRegistry.pause', trigger: 'pause button' },
      { name: 'manual-trigger', to: 'A2ABus.send', trigger: '+ Manual trigger' },
    ],
    features: ['SVG-граф нод-агентов в 4 lanes', 'Live streaming message feed', 'Cost breakdown per agent', 'Conflicts queue для human resolution'],
    advantages: ['Видно когда агент "зациклился"', 'Конфликты не теряются', 'Понятно кому сколько стоит'],
    benefits: ['Отлавливаешь loop за 5 мин вместо дня', 'Cost per agent trackable', 'Fast human override'],
    agents: ['a2a-bus', 'conflict-resolver', 'cost-tracker'],
    apis: ['GET /api/a2a/messages/stream', 'POST /api/a2a/conflicts/:id/resolve'],
  },

  'agents': {
    id: 'agents', title: 'Agent registry', file: 'admin-agents.html', owner: 'admin',
    purpose: 'Реестр всех агентов в системе: кто работает на кого, model, authority level, savings, статус.',
    inputs: [
      { name: 'agents[]', from: 'AgentRegistry', required: true },
      { name: 'actions-log', from: 'AuditService', required: true },
      { name: 'cost-stats', from: 'CostTracker', required: false },
    ],
    outputs: [
      { name: 'configure-agent', to: 'AgentRegistry.update', trigger: 'row click' },
      { name: 'create-agent', to: 'AgentRegistry.create', trigger: '+ button' },
      { name: 'pause-all', to: 'AgentRegistry.pauseAll', trigger: 'emergency button' },
    ],
    features: ['4 KPI: total / actions / saved / cost', 'Per-agent row with авторитет chip', 'Top savers bar chart', '«Нужен review» alerts'],
    advantages: ['Single source of truth для AI', 'Видно кого из агентов выгодно держать', '«Emergency pause» — one click'],
    benefits: ['Cost контроль 100%', 'Agents не убегают из-под контроля', 'Fast onboarding новых агентов'],
    agents: ['agent-registrar', 'cost-tracker'],
    apis: ['GET /api/agents', 'POST /api/agents', 'POST /api/agents/pause-all'],
  },

  // остальные 11 страниц — sparse shell
  'my-time':         { id: 'my-time',         title: 'Моё время',        file: 'my-time.html',         owner: 'worker-self' },
  'my-expenses':     { id: 'my-expenses',     title: 'Мои затраты',      file: 'my-expenses.html',     owner: 'worker-self' },
  'session-detail':  { id: 'session-detail',  title: 'Session detail',   file: 'session-detail.html',  owner: 'time-admin' },
  'expense-detail':  { id: 'expense-detail',  title: 'Expense detail',   file: 'expense-detail.html',  owner: 'finance-admin-agent' },
  'client-overview': { id: 'client-overview', title: 'Client overview',  file: 'client-overview.html', owner: 'client-manager' },
  'worker-profile':  { id: 'worker-profile',  title: 'Worker profile',   file: 'worker-profile.html',  owner: 'hr-agent' },
  'call-brief':      { id: 'call-brief',      title: 'Call brief',       file: 'call-brief.html',      owner: 'sales-agent' },
  'call-live':       { id: 'call-live',       title: 'Live call',        file: 'call-live.html',       owner: 'sales-agent' },
  'call-summary':    { id: 'call-summary',    title: 'Call summary',     file: 'call-summary.html',    owner: 'sales-agent' },
  'policies':        { id: 'policies',        title: 'Automation rules', file: 'ai-policies.html',     owner: 'admin' },
  'onboarding':      { id: 'onboarding',      title: 'Onboarding',       file: 'onboarding.html',      owner: 'admin' },
  'landing':         { id: 'landing',         title: 'Sales landing',    file: 'landing.html',         owner: 'marketing' },
};

// ─── USE CASE SEED DATA (merged into localStorage on first load) ──────────
const SEED_USE_CASES = [
  // === expenses ===
  { pageId: 'expenses', title: 'Админ одобряет expense < $500 одним кликом', role: 'admin',
    preconditions: ['авторизован как admin', 'в очереди 1+ submitted expense < $500'],
    steps: [
      { action: 'открыть /expenses', expected: 'очередь approval видна справа' },
      { action: 'нажать ✓ на строке', expected: 'строка пропадает из очереди, chip меняется на approved' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'expenses', title: 'Expense > $500 требует двойного подтверждения', role: 'admin',
    preconditions: ['expense.amount > 500', 'authority level admin = L1'],
    steps: [
      { action: 'нажать ✓ на expense $547', expected: 'модалка «Confirm — сумма выше порога»' },
      { action: 'подтвердить', expected: 'approve применяется, audit записывает double-check' },
    ], status: 'untested', source: 'ai-generated' },

  { pageId: 'expenses', title: 'OCR корректно парсит чек Home Depot', role: 'system',
    preconditions: ['receipt photo uploaded', 'ocr-agent online'],
    steps: [
      { action: 'worker отправил фото чека', expected: 'в течение 3с появляется draft expense с vendor/amount/date' },
      { action: 'админ открывает expense', expected: 'все поля заполнены, confidence > 90%' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'expenses', title: 'OCR падает на китайских/иероглифических чеках', role: 'system',
    preconditions: ['receipt в non-latin script'],
    steps: [
      { action: 'upload photo чека 海底捞', expected: 'draft с confidence > 70%' },
    ], status: 'failing', failureReason: 'Claude Vision confidence 0.4 на CJK, нет fallback на Google Vision', source: 'from-bug' },

  { pageId: 'expenses', title: 'Split expense между 2 клиентами 50/50', role: 'admin',
    preconditions: ['expense не привязан к client'],
    steps: [
      { action: 'open expense-detail', expected: 'кнопка Split' },
      { action: 'выбрать 2 клиентов + 50%', expected: 'создаются 2 линки по 50% от суммы' },
    ], status: 'spec-only', failureReason: 'UI ещё не построен', source: 'manual' },

  { pageId: 'expenses', title: 'Reject expense с причиной → notify worker в Telegram', role: 'admin',
    preconditions: ['expense status = submitted', 'worker имеет Telegram link'],
    steps: [
      { action: 'нажать ✗', expected: 'popup для reason' },
      { action: 'ввести reason и submit', expected: 'expense→rejected, worker получает tg message' },
    ], status: 'untested', source: 'ai-generated' },

  // === mobile-worker ===
  { pageId: 'mobile-worker', title: 'Воркер стартует смену одним «да»', role: 'worker',
    preconditions: ['worker has active tg bot link', 'geo = client site'],
    steps: [
      { action: 'AI: "Ты на Acme, стартуем?"', expected: 'кнопки Да/Не сегодня/Другой клиент' },
      { action: 'тап Да', expected: 'смена стартует, таймер запущен, session создан' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'mobile-worker', title: 'Face-mismatch на start-selfie блокирует смену', role: 'system',
    preconditions: ['face.confidence < 0.7', 'policy: require-selfie = true'],
    steps: [
      { action: 'worker делает selfie', expected: 'confidence < threshold' },
      { action: 'система реагирует', expected: 'смена на hold, админ получает warning push, audit event' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'mobile-worker', title: 'Фото чека в чат → auto-expense draft', role: 'worker',
    preconditions: ['активная смена', 'чек читаем'],
    steps: [
      { action: 'воркер шлёт фото в чат', expected: 'в течение 3с AI: "Распознал — проверь"' },
      { action: 'тап "верно"', expected: 'expense submitted, admin получает notification' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'mobile-worker', title: 'EOD summary автоматически формируется в 18:00', role: 'worker',
    preconditions: ['смена была активна сегодня', 'time > 18:00'],
    steps: [
      { action: 'cron в 18:00', expected: 'AI шлёт EOD карточку: hours, earned, expenses, tomorrow' },
    ], status: 'untested', source: 'manual' },

  { pageId: 'mobile-worker', title: 'Voice command: "стоп смена"', role: 'worker',
    preconditions: ['PWA работает', 'mic permission granted'],
    steps: [
      { action: 'долгий тап mic + сказать "стоп"', expected: 'AI предлагает confirm stop' },
    ], status: 'spec-only', failureReason: 'voice UI не реализован', source: 'ai-generated' },

  // === dashboard ===
  { pageId: 'dashboard', title: 'Admin видит все 4 KPI карточки при загрузке', role: 'admin',
    preconditions: ['logged in as admin'],
    steps: [
      { action: 'открыть /', expected: 'KPI: Revenue YTD, Labor, Materials, К выплате' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'dashboard', title: 'Клик на активную смену ведёт в session-detail', role: 'admin',
    preconditions: ['есть активная смена'],
    steps: [
      { action: 'клик на строку сессии', expected: 'переход на session-detail.html?id=s1' },
    ], status: 'passing', source: 'manual' },

  { pageId: 'dashboard', title: 'Pending approvals блок пустой если всё одобрено', role: 'admin',
    preconditions: ['все expenses status !== submitted'],
    steps: [
      { action: 'открыть dashboard', expected: 'блок показывает "Нет pending" или скрыт' },
    ], status: 'untested', failureReason: 'проверки на empty state нет', source: 'ai-generated' },
];

// ─── STORAGE LAYER (localStorage-backed, prod will swap for Firestore) ─────
const STORAGE = {
  keys: {
    useCases: 'etc:useCases:v1',
    feedback: 'etc:feedback:v1',
    userName: 'etc:user:v1',
  },

  _read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  },
  _write(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

  initUseCases() {
    if (!localStorage.getItem(this.keys.useCases)) {
      const seeded = SEED_USE_CASES.map((uc, i) => ({
        id: `${uc.pageId}-uc-${String(i + 1).padStart(3, '0')}`,
        ...uc,
        lastRun: uc.status === 'passing' || uc.status === 'failing' ? new Date(Date.now() - Math.random() * 86400000 * 3).toISOString() : null,
        linkedBugs: [],
        linkedAgents: [],
        globalRef: null,
        createdAt: new Date().toISOString(),
        createdBy: 'seed',
      }));
      this._write(this.keys.useCases, seeded);
    }
  },

  listUseCases(pageId) {
    this.initUseCases();
    const all = this._read(this.keys.useCases);
    return pageId ? all.filter(uc => uc.pageId === pageId) : all;
  },

  saveUseCase(uc) {
    const all = this._read(this.keys.useCases);
    const idx = all.findIndex(x => x.id === uc.id);
    if (idx >= 0) all[idx] = { ...all[idx], ...uc, updatedAt: new Date().toISOString() };
    else {
      const id = uc.id || `${uc.pageId}-uc-${String(all.length + 1).padStart(3, '0')}`;
      all.push({ ...uc, id, createdAt: new Date().toISOString() });
    }
    this._write(this.keys.useCases, all);
    return all;
  },

  deleteUseCase(id) {
    const all = this._read(this.keys.useCases).filter(uc => uc.id !== id);
    this._write(this.keys.useCases, all);
    return all;
  },

  listFeedback(pageId) {
    const all = this._read(this.keys.feedback);
    return pageId ? all.filter(f => f.pageId === pageId) : all;
  },

  saveFeedback(fb) {
    const all = this._read(this.keys.feedback);
    const id = fb.id || `fb-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const entry = {
      id,
      ...fb,
      createdAt: fb.createdAt || new Date().toISOString(),
      status: fb.status || 'raw',
    };
    all.push(entry);
    this._write(this.keys.feedback, all);
    return entry;
  },

  currentUser() {
    return localStorage.getItem(this.keys.userName) || 'Денис';
  },
};

// ─── UC STATS (per page) ───────────────────────────────────────────────────
function ucStats(pageId) {
  const ucs = STORAGE.listUseCases(pageId);
  return {
    total:      ucs.length,
    passing:    ucs.filter(uc => uc.status === 'passing').length,
    failing:    ucs.filter(uc => uc.status === 'failing').length,
    untested:   ucs.filter(uc => uc.status === 'untested').length,
    flaky:      ucs.filter(uc => uc.status === 'flaky').length,
    draft:      ucs.filter(uc => uc.status === 'draft').length,
    specOnly:   ucs.filter(uc => uc.status === 'spec-only').length,
    coverage:   ucs.length ? Math.round((ucs.filter(uc => uc.status === 'passing').length / ucs.length) * 100) : 0,
    lastRun:    ucs.map(uc => uc.lastRun).filter(Boolean).sort().pop(),
  };
}

// ─── STATUS META ───────────────────────────────────────────────────────────
const UC_STATUS_META = {
  'passing':   { emoji: '🟢', label: 'passing',   color: '#16a34a' },
  'failing':   { emoji: '🔴', label: 'failing',   color: '#dc2626' },
  'untested':  { emoji: '⚪', label: 'untested',  color: '#94a3b8' },
  'flaky':     { emoji: '🟡', label: 'flaky',     color: '#eab308' },
  'draft':     { emoji: '🟣', label: 'draft',     color: '#a855f7' },
  'spec-only': { emoji: '🔵', label: 'spec-only', color: '#0284c7' },
};

// expose to window for easy debugging
if (typeof window !== 'undefined') {
  window.PAGES = PAGES;
  window.STORAGE = STORAGE;
  window.ucStats = ucStats;
  window.UC_STATUS_META = UC_STATUS_META;
}
