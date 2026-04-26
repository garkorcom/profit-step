---
title: "08.gantt.5 Weather day overlay (Tampa-specific)"
section: "08-modules/construction-gantt"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Weather day overlay (Tampa-specific)

> Серверный cron раз в час дёргает NOAA API по `task.location.lat/lng`. Если forecast >50% rain на день где запланированы outdoor задачи — добавляем маркер ☂ на Gantt над днём. **НЕ сдвигаем молча** — юзер подтверждает.

ТЗ §15.5.

## Anti-pattern

См.: [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #5

**НЕ auto-shift по weather day без подтверждения.** NOAA говорит дождь → показываем маркер ☂ + suggest-modal «сдвинуть на день?». Юзер подтверждает.

## Алгоритм

### 1. Cron каждый час

```typescript
// functions/src/scheduled/weatherCheckCron.ts

export const weatherCheckCron = functions.pubsub
  .schedule('0 * * * *')  // every hour
  .onRun(async () => {
    const upcomingTasks = await db.collection('tasktotime_tasks')
      .where('lifecycle', 'in', ['ready', 'started'])
      .where('plannedStartAt', '>=', Timestamp.now())
      .where('plannedStartAt', '<=', addDays(Timestamp.now(), 7))
      .where('category', '==', 'work')           // не trigger для inspections/permits
      .where('phase', 'in', ['demo', 'rough'])   // outdoor phases
      .get();

    for (const taskDoc of upcomingTasks.docs) {
      const task = taskDoc.data() as Task;
      if (!task.location?.lat || !task.location?.lng) continue;

      const forecast = await noaaApi.getForecast({
        lat: task.location.lat,
        lng: task.location.lng,
        date: task.plannedStartAt
      });

      if (forecast.rainProbability > 50) {
        await taskDoc.ref.update({
          weatherWarning: {
            forecast: forecast.summary,
            rainProbability: forecast.rainProbability,
            checkedAt: Timestamp.now()
          }
        });
      }
    }
  });
```

### 2. Маркер ☂ на Gantt

```
Day 1   Day 2   Day 3   Day 4   Day 5
─────────────────────────────────────
                  ☂                    ← weather marker над днём
─────────────────────────────────────
Demo bathroom    ▓▓▓▓
Roofing                  ▓▓▓▓▓▓▓        ← задачи в этот день
```

### 3. Click на маркер → modal

```
┌──────────────────────────────────────────┐
│ ☂ Weather warning — Apr 8                │
│                                          │
│ NOAA forecast: 70% rain, thunderstorms   │
│                                          │
│ 3 outdoor tasks scheduled:               │
│ • Roofing (Sergey)                       │
│ • Concrete pour (Marcus)                 │
│ • Exterior paint (Bob)                   │
│                                          │
│ Shift these tasks to Apr 9?              │
│                                          │
│        [Cancel] [Shift +1 day]           │
└──────────────────────────────────────────┘
```

### 4. После подтверждения

Bulk update `plannedStartAt += 1d` для отфильтрованных задач, cascade auto-shift через §12.4.

См.: [`../graph-dependencies/auto-shift-cascade.md`](../graph-dependencies/auto-shift-cascade.md)

## NOAA API

Free National Weather Service API:
```
GET https://api.weather.gov/points/{lat},{lng}
GET https://api.weather.gov/gridpoints/{office}/{x},{y}/forecast
```

Returns:
```json
{
  "properties": {
    "periods": [
      {
        "name": "Today",
        "temperature": 75,
        "shortForecast": "Slight Chance Showers",
        "probabilityOfPrecipitation": { "value": 30 }
      }
    ]
  }
}
```

## Service class

```typescript
// tasktotime/backend/services/WeatherService.ts

export class WeatherService {
  async getForecast(opts: { lat: number; lng: number; date: Timestamp }): Promise<Forecast> {
    if (process.env.NODE_ENV !== 'production') {
      return this.getMockForecast(opts.date);  // for dev/test
    }

    const point = await this.noaa.points(opts.lat, opts.lng);
    const forecast = await this.noaa.gridpointForecast(point.office, point.x, point.y);
    const periodForDate = forecast.periods.find(p => isSameDay(p.startTime, opts.date));

    return {
      summary: periodForDate?.shortForecast ?? 'Unknown',
      rainProbability: periodForDate?.probabilityOfPrecipitation?.value ?? 0,
      temperature: periodForDate?.temperature ?? 0
    };
  }

  private getMockForecast(date: Timestamp): Forecast {
    const dayOfWeek = date.toDate().getDay();
    return {
      summary: dayOfWeek === 3 ? 'Thunderstorms' : 'Sunny',
      rainProbability: dayOfWeek === 3 ? 80 : 10,
      temperature: 75
    };
  }
}
```

## Audit

Audit weather decisions для accountability:

```typescript
// При confirm shift, write to taskHistory
{
  type: 'weather_shift',
  reason: 'NOAA forecast 70% rain',
  shiftedDays: 1,
  affectedTaskIds: ['task-1', 'task-2', 'task-3'],
  approvedBy: { id, name },
  at: Timestamp.now()
}
```

## Tampa-specific

Currently все клиенты в Tampa. NOAA API supports US-wide.

**Open question** §14 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«NOAA weather integration — Tampa-only или multi-region? Если планируется outside Florida — нужно multi-region weather API.»

Default: NOAA US-wide work. Outside US — TBD (отдельный API per country).

## Edge cases

### Task без location

Если `task.location.lat/lng === null` — нельзя check weather. UI suggest «Set location for weather check».

### Forecast unavailable

NOAA API down или no data — silent skip (не алерт). Cron retries в next iteration.

### Task already in `started` lifecycle

Если worker уже начал задачу в день дождя — не предлагаем shift. Только маркер для context.

### Multiple days in row with rain

Cascade каждое предложение separately. Юзер confirm/decline per day.

### Task in indoor work

`phase: 'finish'` (drywall, paint, tile inside) — НЕ trigger weather warning. Только outdoor (`demo`, `rough`).

Phase + category check:

```typescript
const isOutdoor = task.category === 'work' && ['demo', 'rough'].includes(task.phase ?? '');
```

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md):
- ✓ Weather marker ☂ показывается при forecast > 50% rain (mock в dev — реальный NOAA в prod)

---

**См. также:**
- [Plan vs actual](plan-vs-actual.md)
- [Critical path](critical-path.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../graph-dependencies/auto-shift-cascade.md`](../graph-dependencies/auto-shift-cascade.md) — cascade after weather shift
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #5 — НЕ auto-shift без подтверждения
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #14
