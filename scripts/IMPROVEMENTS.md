# 🚀 scripts/ — Улучшения Утилитарных Скриптов

## 🔴 Критические

### 1. Организация
23 скрипта без структуры в одной папке. Реорганизовать:

```
scripts/
├── seed/                       — Seed скрипты
│   ├── seedTestData.ts
│   ├── seed-devlog.js
│   ├── seed-devlog-admin.js
│   └── seed-wiki-core.js
├── migrations/                 — Миграции данных
│   ├── migrate-*.js
│   └── migrate-*.ts
├── publish/                    — Публикация контента
│   └── publish-*.js
├── monitoring/                 — Мониторинг
│   └── monitor-production.sh
├── maintenance/                — Обслуживание
│   ├── check-user-role.js
│   ├── link-denis-telegram.*
│   └── load-pasco-inspectors.*
├── build/                      — Сборка
│   └── stamp-sw.js
└── refactor/                   — Рефакторинг
    └── refactor-*.js
```

### 2. Типизация
Большинство скриптов на `.js`. Перевести на TypeScript с `ts-node`.

---

## 🟡 Среднесрочные

### 3. npm Scripts
Добавить в `package.json` удобные скрипты:
```json
{
  "scripts": {
    "seed:test": "ts-node scripts/seed/seedTestData.ts",
    "seed:devlog": "node scripts/seed/seed-devlog.js",
    "migrate:all": "ts-node scripts/migrations/run-all.ts",
    "monitor": "bash scripts/monitoring/monitor-production.sh"
  }
}
```

### 4. Документация
Каждый скрипт должен иметь:
```javascript
/**
 * @script seed-devlog.js
 * @description Заполняет Firestore коллекцию devlog_posts тестовыми данными
 * @usage node scripts/seed/seed-devlog.js
 * @requires FIRESTORE_EMULATOR_HOST or production credentials
 */
```

### 5. Cleanup
Убрать личные скрипты:
- `link-denis-telegram.*` — перенести логику в admin UI
- `investigate-victor.js` — удалить
- `broadcast-bot-instruction.js` — перенести в admin callable функцию

---

## 🟢 Долгосрочные

### 6. CI/CD интеграция
Миграции должны запускаться автоматически при деплое.
