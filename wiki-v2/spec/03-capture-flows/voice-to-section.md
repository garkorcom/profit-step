---
title: 3.2 Voice → Section
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
status: outline (refine in Phase C)
---

# Voice → Section capture flow

Foreman sends voice note in Telegram → AI structures → section entry
proposed → foreman confirms → wiki updated.

## Pipeline

1. **Trigger:** `onWorkerBotMessage` detects `voice` message type.
2. **Idempotency key:** `tg:voice:<chat_id>:<message_id>`.
3. **Download blob** to Storage at
   `wikis_v2/captures/voice/{idempotencyKey}.ogg` (TTL 90 days per Q7).
4. **Transcribe** via `VoiceTranscriptionPort.transcribe({ audioUrl, languageHint })`.
   Foreman language is RU/EN; bot detects from Telegram language.
5. **Structure** via Anthropic call: prompt asks for `{ sectionKey, body }`.
   Prompt template documented separately in
   [../07-ai-features/enhance-section.md](../07-ai-features/enhance-section.md).
6. **Confidence gate (Q11):** v1 always confirms.
7. **Bot reply** with inline buttons: `[Save as Materials] [Other section] [Discard]`.
8. **On confirm** → `CaptureFromVoice` use case → `PatchSection`.
9. **Audit event** recorded: `kind: 'capture-voice'`, `actor: { kind: 'agent', agentId: 'voice-intake' }`,
   `confirmedBy: <foremanUserId>`.

## Open questions

- See Q11 in [../10-decisions/open-questions.md](../10-decisions/open-questions.md).
- Whisper local vs Anthropic transcription: separate question, document
  when adapter implementation chooses provider.

## Acceptance criteria (Phase C)

- Foreman sends 30-second voice describing materials used → bot returns
  structured Materials entries within 8 seconds.
- Confirm button writes to wiki; refusal does not.
- Unconfirmed captures auto-purge from Storage after 7 days.
- 50+ successful captures from real foreman in pilot week with <15%
  wrong-section suggestions.
