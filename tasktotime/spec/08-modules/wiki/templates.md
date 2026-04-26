---
title: "08.wiki.5 Wiki Templates"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki Templates

> Шаблоны wiki в коллекции `wikiTemplates/{templateId}` с placeholders для substitution. Use case: «Bathroom remodel — full» template, который можно apply к новой task с auto-fill переменных из task fields.

ТЗ §13.5.

## Storage

Отдельная коллекция `wikiTemplates/{templateId}`:

```typescript
interface WikiTemplate {
  id: string;
  name: string;                    // "Bathroom remodel — full"
  category: 'remodel' | 'install' | 'inspection' | 'permit' | 'punch' | 'custom';
  contentMd: string;               // Markdown с placeholders {{clientName}} / {{address}}
  variables: string[];             // список {{var}} для substitution
  createdBy: UserRef;
  isCompanyDefault: boolean;
}
```

## Пример template

```markdown
# {{taskTitle}}

**Client:** {{clientName}}
**Address:** {{address}}
**Started:** {{plannedStartAt}}
**Estimated duration:** {{estimatedDurationFormatted}}

## Scope

[Default scope для bathroom remodel:]

- Demo existing bathroom (toilet, sink, tub, tile)
- Plumbing rough-in (water lines, drains)
- Electrical rough-in (GFCI outlets, lighting, vent fan)
- Drywall hang and finish
- Tile install (shower walls, floor)
- Plumbing finish (faucets, toilet, fixtures)
- Trim install (baseboards, doors)
- Final cleanup and walkthrough

## Materials

(Update with actuals from estimate)

## Permits

- [ ] Building permit #
- [ ] Plumbing permit #
- [ ] Electrical permit #

## Inspections

- [ ] Plumbing rough inspection (date: __)
- [ ] Electrical rough inspection (date: __)
- [ ] Drywall inspection (date: __)
- [ ] Final inspection (date: __)

## Risks

- Possibility of rotted subfloor under tub (10% chance based on similar buildings in {{address}})
- Cast iron drains might need replacement (15% chance, $400-800 extra)

## Client preferences

- Color scheme: TBD
- Tile choice: TBD
- Fixture brand: TBD

## Contacts

- **Client:** {{clientPhone}} (preferred contact: {{clientPreference}})
- **Building manager:** TBD (get from client)
- **Inspector:** TBD (city contact)

## Acceptance criteria

- [ ] All work to code
- [ ] All inspections passed
- [ ] Final walkthrough with client
- [ ] Punch list completed
- [ ] Cleanup complete (debris removed, surfaces wiped)
```

## Variables

`{{variableName}}` placeholders подставляются из task fields:

| Variable | Source |
|---|---|
| `{{taskTitle}}` | task.title |
| `{{clientName}}` | task.clientName |
| `{{address}}` | task.location.address |
| `{{plannedStartAt}}` | formatDate(task.plannedStartAt) |
| `{{estimatedDurationFormatted}}` | formatDuration(task.estimatedDurationMinutes) |
| `{{clientPhone}}` | client lookup, denormalized |
| `{{projectName}}` | task.projectName |
| `{{taskNumber}}` | task.taskNumber |

Custom variables можно добавить per-template (e.g. `{{warrantyPeriod}}` для install template).

## Применение template

При создании task:

```typescript
POST /api/tasktotime/tasks
{
  // ... task fields
  wiki: {
    templateId: 'bathroom-remodel-full'
  }
}
```

Server:
```typescript
async function applyTemplate(taskData: Task, templateId: string) {
  const template = await getTemplate(templateId);

  let contentMd = template.contentMd;
  for (const variable of template.variables) {
    const value = resolveVariable(variable, taskData);
    contentMd = contentMd.replace(new RegExp(`{{${variable}}}`, 'g'), value);
  }

  taskData.wiki = {
    contentMd,
    updatedAt: Timestamp.now(),
    updatedBy: { id: 'system', name: 'Template applied' },
    version: 1,
    templateId
  };

  return taskData;
}
```

## UI: template picker

В Detail page → Tab «Wiki» → если wiki empty → button «Apply template»:

```
┌─────────────────────────────────────┐
│  Wiki is empty.                     │
│                                     │
│  [Apply template] [Generate from AI]│
│                                     │
└─────────────────────────────────────┘
```

Click [Apply template] → modal:

```
┌─────────────────────────────────────┐
│  Choose template                    │
│                                     │
│  Remodel category:                  │
│  ◉ Bathroom remodel — full          │
│  ○ Kitchen remodel — full           │
│  ○ Master bedroom remodel           │
│                                     │
│  Install category:                  │
│  ○ Window install                   │
│  ○ Door install                     │
│                                     │
│  [Preview] [Apply]                  │
└─────────────────────────────────────┘
```

[Preview] — показывает contentMd с substitution в drawer для review.
[Apply] — создаёт wiki с template applied.

## Шаблоны как «collective knowledge»

Templates можно сохранять из existing wiki:

В Wiki page → button «Save as template»:

```
┌─────────────────────────────────────┐
│  Save as template                   │
│                                     │
│  Name: [Bathroom remodel — Tampa]    │
│  Category: [Remodel ▼]               │
│                                     │
│  Auto-detect variables from text:    │
│  [✓] {{clientName}}                  │
│  [✓] {{address}}                     │
│  [_] John Smith → {{clientName}}    │
│  [✓] {{plannedStartAt}}              │
│                                     │
│  Set as company default for category? │
│  [_] Yes                             │
│                                     │
│  [Cancel] [Save]                    │
└─────────────────────────────────────┘
```

После save — другие PMs могут apply.

## Open question

§ Open question #13 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«Wiki templates — кто куратор? PMs ad-hoc создают, или мы делаем стартовый набор системой из 20-30 industry-standard templates?»

Default: PMs создают сами. System templates — Phase 4+.

## Backwards lookup

Для каждой task — мы знаем какой template applied (`wiki.templateId`). Можно искать «все tasks которые использовали template X» — для:
- Анализа какие шаблоны популярны
- Massupdate template — apply changes к existing tasks (with conflict detection)

---

**См. также:**
- [Concept](concept.md)
- [Storage](storage.md)
- [Editor UI](editor-ui.md) — template picker UI
- [AI helper](ai-helper.md) — alternative «Generate from AI»
- [Inheritance](inheritance.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #13
