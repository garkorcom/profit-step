# 🗄️ RESTORE PLAN — Timer v2 (FSM / time_logs)

## Что архивировано

| Файл | Оригинальный путь | Назначение |
|------|-------------------|------------|
| `timeTrackingService.ts` | `src/services/` | Сервис записи time_logs в Firestore |
| `TaskTimerButton.tsx` | `src/components/tasks/` | UI кнопка таймера с камерой, geo-fence, work/travel |
| `fsm.types.ts` | `src/types/` | TypeScript типы: Task, Site, TimeLog, FSM модель |
| `calculations.ts` | `src/utils/` | Утилиты расчётов (часы, оплата по time_logs) |

## Зачем архивировано

- Таймер **никогда не использовался в production** — только на DevIndexPage для тестирования
- Production использует `work_sessions` (Telegram Bot, OpenClaw, Web Admin)
- Две параллельные системы таймеров = путаница и мёртвый код
- Firestore коллекция `time_logs` пуста в production

## Как восстановить (5 минут)

```bash
cd /Users/denysharbuzov/Projects/profit-step

# 1. Скопировать файлы обратно
cp _archived/timer-v2-fsm/timeTrackingService.ts src/services/
cp _archived/timer-v2-fsm/TaskTimerButton.tsx src/components/tasks/
cp _archived/timer-v2-fsm/fsm.types.ts src/types/
cp _archived/timer-v2-fsm/calculations.ts src/utils/

# 2. Раскомментировать импорты в DevIndexPage.tsx
# Найти строки с [ARCHIVED] и раскомментировать
# - import TaskTimerButton
# - testTask/testSite useState
# - useEffect fetchTestData
# - JSX блок с <TaskTimerButton />

# 3. Build
npm run build
```

## Фичи мёртвого таймера (для будущей интеграции)

### 1. 📍 Geo-fence verification
- `useGeoLocation` hook — получение координат
- `calculateDistance()` — проверка расстояния до сайта
- Радиус по умолчанию: 150м (`Site.geo.radius`)
- Override с причиной если вне зоны

### 2. 📷 Camera capture (proof of arrival)
- Фото при старте таймера через `navigator.mediaDevices`
- Подтверждение что работник на месте

### 3. 🚗 Work / Travel mode
- Два режима: `work` (на объекте) и `travel` (в дороге)
- Разные ставки и логирование
- `TimeLogType = 'work' | 'travel'`

### 4. 🔄 FSM Task Status Model
- Статусы: `backlog → todo → scheduled → traveling → in_progress → review → done`
- Автоматическая смена статуса при старте/стопе таймера

### 5. 🏗️ Site Model
- Привязка к клиенту
- Адрес + координаты + радиус
- Контакты на объекте + заметки доступа
- Фото объекта

## Как встроить фичи в work_sessions (будущее)

### Phase A: Geo-fence для work_sessions
- Добавить `geo` поля в `work_sessions`: `startLat`, `startLng`, `siteId`
- Переиспользовать `useGeoLocation` hook
- При старте таймера (Telegram/Web) проверять расстояние до сайта клиента

### Phase B: Camera proof
- При старте через Web — опционально фото
- Через Telegram Bot — `/timer start` с приложенным фото
- Сохранять URL в `work_sessions.proofPhotoUrl`

### Phase C: Travel tracking
- Добавить `type: 'work' | 'travel'` в work_sessions (уже есть поле `type`)
- Разные ставки для travel vs work
- Telegram: `/timer travel` / `/timer work`

---

*Дата архивации: 2026-03-21*
*Коммит: 🗄️ Archive dead timer (time_logs/FSM)*
