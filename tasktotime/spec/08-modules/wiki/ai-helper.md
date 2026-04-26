---
title: "08.wiki.4 AI helper for wiki"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# AI-помощник для wiki

> AI ассистент в wiki editor: «Дополни wiki», «Wiki из голоса», «Generate wiki from estimate». Все AI-вмешательства пишутся в `versionHistory` с `updatedBy: { id: 'ai-assistant', name: 'Claude AI' }`.

ТЗ §13.4.

## 3 AI features

### 1. «Дополни wiki» (suggest additions)

AI читает task fields + current wiki + history events → suggest дополнения.

**Trigger:** кнопка «AI Suggest» в editor toolbar.

**Поведение:**

```
Click [AI Suggest] →
   → Claude analysis:
     - lifecycle === 'completed' но wiki не содержит section ## Lessons learned
     - taskHistory содержит «found rotted joist» событие
     → suggest добавить section Lessons learned со списком найденных gotchas
   → Modal с предложенным diff
   → User: [Apply] / [Edit] / [Cancel]
```

**Prompt skeleton:**

```
You are a construction project assistant. Read this task's wiki, fields, and history events. Suggest 1-3 helpful additions to the wiki.

Examples of good additions:
- "Lessons learned" section if task is completed
- "Permits" section if estimate mentions inspections
- Missing photos for material reference if lifecycle === 'started' and no photos

Be specific, actionable, and brief.

Task: {task_data}
Current wiki: {wiki.contentMd}
History (last 20 events): {history}

Return JSON: { suggestions: [{ section, content, reason }] }
```

### 2. «Wiki из голоса» (voice → wiki append)

Voice transcription с тэгом `wiki` в Telegram → appends к wiki с timestamp.

**Workflow:**

```
Worker в Telegram: "/wiki Marcus сказал что в среду water shutoff с 9 утра, надо успеть"
   ↓
Bot: Whisper transcription
   ↓
Bot calls API: POST /api/tasktotime/tasks/{taskId}/wiki/append
{
  appendMd: "## Update from Sergey, Apr 25 14:30\n\nMarcus сказал что в среду water shutoff с 9 утра, надо успеть",
  source: 'telegram_voice'
}
   ↓
Wiki updated, version incremented
   ↓
Bot acks: «Записал в wiki Bathroom remodel»
```

**Prompt:**

Voice tag command pattern in Telegram bot:
```
/wiki <voice transcription>     → appends to current task's wiki
/wiki-task {taskId} <text>      → appends to specific task's wiki
```

### 3. «Generate wiki from estimate»

При `confirmTask` если `wiki === null` AI создаёт draft.

**Trigger:** автоматически при `decomposeEstimate` или manually «Generate wiki» button.

**Output:**

```markdown
# {task.title}

## Scope
{from estimate item description}

## Materials
- {material 1}: {qty}
- {material 2}: {qty}
...

## Permits
{if estimate mentions inspections}

## Risks
- {AI-generated based on similar projects}

## Acceptance criteria
- [ ] {criterion 1}
- [ ] {criterion 2}
```

## AI provenance

Все AI-вмешательства пишутся в `versionHistory` с:

```typescript
{
  version: N,
  contentMd: '...',
  updatedAt: Timestamp,
  updatedBy: { id: 'ai-assistant', name: 'Claude AI' },
  changeSummary: 'AI added "Lessons learned" section'
}
```

В Wiki history view — events с `updatedBy.id === 'ai-assistant'` помечены robot icon.

## AI safety

Все AI flows wiki следуют общим правилам [`../../07-ai/ai-safety.md`](../../07-ai/ai-safety.md):

- **`aiAuditLogId`** на каждом mutation — записывается в `wiki.versionHistory[].aiAuditLogId`
- **Preview/diff** перед apply — modal показывает proposed changes
- **Undo snackbar 4s** после применения
- **Rate limit** max 1 AI mutation на wiki за 60 секунд

## UI in editor

Toolbar button:
```
┌─────────────────────────────────────────┐
│  Wiki editor              [Saving] [✨ AI]│
│                                         │
│  ## Scope                               │
│  - drywall                              │
│                                         │
└─────────────────────────────────────────┘
```

Click [✨ AI] → bottom sheet:

```
┌─────────────────────────────────┐
│  ✨ AI assist                   │
│                                 │
│  📝 Suggest additions           │
│  📋 Generate from estimate      │
│  🎤 Append from voice           │
│  🔄 Translate / paraphrase      │
│  ✓ Improve writing              │
│                                 │
└─────────────────────────────────┘
```

## Implementation

```typescript
// tasktotime/backend/ai/wikiAssist.ts

export async function suggestWikiAdditions(taskId: string): Promise<WikiSuggestion[]> {
  const task = await getTask(taskId);
  const history = task.history.slice(-20);

  const prompt = `${SYSTEM_PROMPT}\n\nTask: ${JSON.stringify(task)}\nWiki: ${task.wiki?.contentMd ?? '(empty)'}\nHistory: ${JSON.stringify(history)}`;

  const response = await claude.complete({
    model: 'claude-sonnet-4.7',
    prompt,
    response_format: { type: 'json_object' }
  });

  const suggestions = JSON.parse(response.content) as WikiSuggestion[];

  // Audit log
  await logAiAudit({
    flow: 'wikiAssist',
    taskId,
    inputSummary: 'Suggest additions',
    outputSummary: `${suggestions.length} suggestions`,
  });

  return suggestions;
}
```

## Edge cases

### Empty wiki

«Дополни wiki» работает: AI генерирует initial structure based on task fields.

### Wiki > 100KB

AI suggestions всё равно generates, но при apply — warning «Wiki near max size, consider moving content to attachments».

### Conflicting AI + manual edits

AI suggest based on snapshot. Если manual edit произошло пока AI thinking — на apply check `version` mismatch → user resolves через conflict UI.

### Multilingual

Wiki может быть на русском или английском. AI должен respect language задачи (если original wiki на русском — suggestions на русском).

---

**См. также:**
- [Concept](concept.md)
- [Editor UI](editor-ui.md)
- [Storage](storage.md)
- [Templates](templates.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../../07-ai/ai-safety.md`](../../07-ai/ai-safety.md)
- [`../../07-ai/integration-overview.md`](../../07-ai/integration-overview.md)
