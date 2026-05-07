---
title: 6.2 Mobile-first capture UX
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase C)
---

# Mobile-first capture UX

The foreman view is mobile-first. Web is the secondary path.

## Hard constraints

- iPhone SE (375px) is the smallest target. No horizontal scroll.
- Tap targets ≥ 44×44px (WCAG 2.2 §2.5.8).
- Voice / photo capture buttons reachable in the bottom 1/3 of the screen
  (thumb zone).
- Offline fallback: section reads cached for 24h; writes queue for retry
  when network returns.

## Primary surfaces

### Telegram bot (most common)

The bot already exists (`onWorkerBotMessage`). Adding capture surface:
- Voice / photo / receipt → bot replies inline with section preview +
  buttons.
- `/wiki <task-name>` command lets foreman read current wiki of any task.
- `/dispatch` shows assigned tasks with quick actions per task.

### Mobile web (PWA)

When foreman opens the web app on phone:
- Auto-redirects to foreman view at `/foreman` or `/m/wiki`.
- Bottom bar: `[+ Voice] [+ Photo] [+ Receipt] [Edit]`.
- Pull-to-refresh on section cards.
- Capture buttons trigger the same use cases as bot — same audit shape.

## Camera vs file picker

Photo button uses `<input type="file" accept="image/*" capture="environment">`
to default to back camera. Foreman can pick from gallery if they prefer.

## Voice button

`MediaRecorder` API → upload blob to `Storage` → invoke
`captureVoice` callable. Visual indicator: red pulsing dot during record;
"transcribing…" while waiting for VoiceTranscriptionPort.

## Receipt detection

Photo button has a "scan receipt" sub-mode. Different upload path —
explicitly classified as receipt, skips the photo→section heuristic.

## Confirmation UI

After AI suggests section, foreman sees a card preview:
```
┌─────────────────────────────────────┐
│ Saving as: Materials                │
│                                     │
│ • 1/2 PEX manifold — 30 ft          │
│ • Solder fittings — 5 pcs           │
│                                     │
│ [Save] [Other section] [Discard]    │
└─────────────────────────────────────┘
```

Default tap target on `Save`. `Other section` opens a quick-pick of valid
section keys. `Discard` confirms with a tiny "are you sure?" since
discarding throws away the AI parse.

## Inherited L1 banner

When viewing L2 wiki, the L1 banner is collapsed:
```
┌─────────────────────────────────────┐
│ ▾ Inherited from project (tap)      │
└─────────────────────────────────────┘
```

Tap → expands to show Address / Brigade / Permits / Selections.

## Acceptance (Phase C + D mobile UAT)

- Foreman can capture a voice note + see structured section preview in
  <8 seconds end-to-end.
- All capture flows work on iPhone SE (375px).
- Offline writes queue and retry within 5 min of network return.
