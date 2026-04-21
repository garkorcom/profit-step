# Migration Guide — взять starter-kit в новый проект

Пошаговая инструкция: от нуля до первой self-documented страницы за 5 минут.

---

## Сценарий 1 · Новый HTML/JS проект (no framework)

```bash
mkdir my-app && cd my-app

# 1. Скопируй self-docs.js в проект
cp /path/to/starter-kit/self-docs.js ./

# 2. Скопируй шаблон страницы (для каждой страницы — один файл)
cp /path/to/starter-kit/templates/page-template.html ./dashboard.html

# 3. Замени плейсхолдеры
sed -i '' 's/{{PAGE_ID}}/dashboard/g; s/{{PAGE_TITLE}}/Dashboard/g' dashboard.html

# 4. Запусти локально
npx http-server . -p 5175
# → http://127.0.0.1:5175/dashboard.html
```

Готово. Откроешь страницу — внизу справа «?» иконка, `Cmd+Shift+D` → полный debug drawer.

**Следующий шаг:** заполни в script tag блок `SelfDocs.registerPage()` — `purpose`, `inputs`, `outputs`, `features`, `advantages`, `benefits`, `agents`, `apis`, `devNotes`. Это и есть ТЗ твоей страницы, которое теперь живёт в коде и видно всем.

---

## Сценарий 2 · React / Next.js

```bash
# 1. Положи self-docs.js в public/
cp /path/to/starter-kit/self-docs.js ./public/

# 2. Подключи в _document.tsx (Next.js) или index.html (CRA/Vite)
```

**Next.js** `pages/_document.tsx`:
```tsx
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head>
        <script src="/self-docs.js" defer />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

**Vite/CRA** `index.html`:
```html
<script src="/self-docs.js"></script>
```

Далее скопируй `examples/react-adapter.tsx` → `src/components/SelfDocsPage.tsx` и используй:

```tsx
import { SelfDocsPage } from './SelfDocsPage';

export default function UsersPage() {
  return (
    <SelfDocsPage pageId="users" spec={{ title: 'Users', owner: 'admin', ... }}>
      <YourExistingContent />
    </SelfDocsPage>
  );
}
```

Важно: твой app должен где-то рендерить `.topbar` элемент (UC-counter инжектится туда). Если у тебя свой layout — укажи селектор:

```tsx
useEffect(() => {
  window.SelfDocs.config({ topbarSelector: '.my-header' });
}, []);
```

---

## Сценарий 3 · Существующий проект (incremental rollout)

### Фаза 1 — подключить ядро (5 мин)
1. Скопируй `self-docs.js` в `public/` / `static/` / `assets/`
2. Добавь `<script>` в главный HTML template
3. Проверь в dev console что `window.SelfDocs` доступен

### Фаза 2 — первая страница (10 мин)
Выбери одну важную страницу (обычно dashboard или главный flow). Добавь:

```js
// В конец bundle или в самой странице
SelfDocs.registerPage('dashboard', {
  title: 'Dashboard',
  owner: 'admin',
  purpose: '<одна строка что делает>',
  inputs: [], outputs: [], features: [], advantages: [], benefits: [],
  agents: [], apis: [],
  devNotes: { rules: [], access: { roles: [] }, gotchas: [], changelog: [] },
});
SelfDocs.mount('dashboard');
```

Заполни `purpose` сразу. Остальное — потом. Strict minimum → UC-footer и debug-bar уже работают.

### Фаза 3 — остальные страницы (30 мин на 20 страниц)
Шаблонная обработка: 2 строки в каждую страницу/компонент.

### Фаза 4 — мета-страницы (1 час)
Скопируй из `easytimercost/prototype/`:
- `_feedback.html` — Kanban
- `_master_tz.html` — coverage map
- `_tz_lint.html` — consistency checks
- `_review.html` — entry point
- `infodebag.html` — docs

Отредактируй `PAGES` референсы если переименовал storage keys.

### Фаза 5 — backend (optional, production)

Замени `localStorage` на свой backend:

```js
SelfDocs.config({
  onFeedbackSubmit: async (fb) => {
    await fetch('/api/feedback', {
      method: 'POST',
      body: JSON.stringify(fb),
      headers: { 'Content-Type': 'application/json' },
    });
  },
});
```

Для полного async storage нужно override `SelfDocs.storage.*` методов — см. README §Custom storage.

---

## Checklist — что важно не пропустить

- [ ] `#page-content` container существует (или настроен `contentSelector`)
- [ ] `.topbar` существует (или настроен `topbarSelector`)
- [ ] `SelfDocs.config({ locale })` задан до `mount`
- [ ] Каждый `pageId` уникален
- [ ] `PAGES[id].owner` заполнен (иначе RLS/routing feedback сломается)
- [ ] Минимум `purpose` заполнен (иначе TZ-footer показывает sparse warning)
- [ ] CSP — если используешь, разреши `'unsafe-inline'` для styles (self-docs инжектит `<style>`)

---

## Типичные ошибки

**«UC-counter не появляется в топбаре»**
→ Проверь `topbarSelector`. Self-docs ищет элемент `.topbar` по умолчанию.

**«UC-footer не появляется внизу страницы»**
→ Проверь что container с `id="page-content"` существует до вызова `mount()`.

**«Debug drawer открывается за content»**
→ Style `.sd-drawer { z-index: 9999 }` — если у тебя выше, override через CSS.

**«Cmd+Shift+D не работает»**
→ Проверь что ни один `preventDefault` в твоем коде не перехватывает keydown. Можно явно `SelfDocs.toggleDevMode()` из консоли.

**«feedback теряется после перезагрузки»**
→ localStorage по умолчанию. Если в incognito — не сохранится. Для прод — hook на backend.

---

## Что дальше

После подключения self-docs к проекту:

1. **Набери 30–50 UC на главных страницах** — это даёт coverage и ты видишь где пусто
2. **Запусти `_tz_lint.html`** — найдёт противоречия в спеках (sparse ХПВ, orphan agents, missing owners)
3. **Собери первый фидбек** — покажи страницу 3-5 юзерам, они прокликают по debug-bar'у, появятся реальные баги с context'ом
4. **Настрой AI-triage** — `config.aiGenerateFn` + backend proxy к Claude/OpenAI = автоматическая классификация и patch-suggestions
5. **Интегрируй с CI** — `_tz_lint.html` как headless-check в GitHub Actions

---

## Roadmap v1 → v2

| Сейчас (v1) | v2 |
|---|---|
| Sync localStorage | Async storage adapter (Firestore/Supabase) |
| 1 user per browser | Multi-user (SelfDocs.config({ userId })) |
| 1 page load = 1 mount | SPA-ready: unmount + remount on route change |
| Manual AI-generate | Background cron AI-triage agent |
| No tests | Unit tests для core + E2E для UI |

Это всё — в `starter-kit/TODO.md` (next iteration).
