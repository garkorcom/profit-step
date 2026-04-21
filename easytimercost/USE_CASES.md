# 100 Use Cases · Where AI Wins, Where It Breaks, How To Fix

> Ночной разбор. Для каждого юз-кейса: что хочет пользователь, почему это тяжело для AI,
> как ломается на практике, и как мы это решаем.
> Дата: 2026-04-20. Автор: Claude Opus 4.7. Для Дениса к утреннему обзору.

---

## Как читать

Каждый кейс имеет 5 полей:
- **Что ожидает пользователь** — happy path
- **Почему сложно** — техническая или социальная проблема
- **Как ломается** — конкретные failure modes
- **Как решаем** — конкретная митигация
- **Confidence** — 🟢 high / 🟡 medium / 🔴 low уверенность что AI справится в MVP

Разбиты на 12 категорий. В конце — выводы и top-10 рисков.

---

# A. Worker time tracking (1–10)

## 1. Auto-start смены по geo-proximity
- **Ожидает:** Подъехал к объекту — AI сам спросил "стартуем?" — я ответил да — смена пошла.
- **Почему сложно:** Geo данные шумные (±20–50м в городе), прораб может заехать проверить на 10 минут, водитель может просто забросить материал.
- **Как ломается:**
  - Ложный старт когда работник просто привёз инструмент
  - Не срабатывает в подвалах / high-rise (нет GPS)
  - Часовой пояс путается у приезжих из другого штата
  - Иногда 2 объекта рядом — не понятно какой
- **Решаем:** (a) confirmation required первые 30 дней, (b) time-window check (обычное время старта ± 15мин), (c) минимум 5 минут staying время, (d) fallback на manual start через один tap.
- **Confidence:** 🟡 medium (работает 80% случаев, но нужен гибридный режим)

## 2. Auto-close при уходе с объекта
- **Ожидает:** Уехал — AI сам предложил закрыть.
- **Почему сложно:** Работник может отъехать за материалами, на обед, в банк, в клинику.
- **Как ломается:** Закрыл смену во время обеда, получил недоплату. Доверие потеряно.
- **Решаем:** (a) wait 30 minutes distance > 500m, (b) не auto-close, только propose, (c) учесть lunch breaks, (d) если уход > 2ч — эскалация прорабу.
- **Confidence:** 🟡 medium

## 3. Селфи check-in (face verification)
- **Ожидает:** Селфи для отметки присутствия.
- **Почему сложно:** Освещение, шапка, маска, борода, близнецы, share-phone fraud.
- **Как ломается:** Работник в каске/очках — false-negative. Кто-то отправляет старое селфи. На стройке руки грязные — плохое qualityphoto.
- **Решаем:** (a) liveness detection (моргни/повернись), (b) confidence < 0.95 → flag admin, (c) EXIF проверка (не из галереи), (d) face + geo + time tuple.
- **Confidence:** 🟡 medium (гигиеническая проверка, не primary)

## 4. Overtime detection
- **Ожидает:** AI заметил что я перерабатываю и предложил закрыть.
- **Почему сложно:** Некоторые работают overtime специально, некоторые забывают.
- **Как ломается:** Paged foreman среди ночи, worker annoyed что его дёргают.
- **Решаем:** (a) policy toggle per worker, (b) threshold config, (c) silent flag в admin daily digest.
- **Confidence:** 🟢 high

## 5. Multi-site в один день
- **Ожидает:** Работал на 2 клиентах — AI разделил смены корректно.
- **Почему сложно:** Переезд между объектами, time допустимо считать или нет?
- **Как ломается:** Billing ambiguous (travel time payable или no?).
- **Решаем:** (a) явный client policy "travel between sites paid if > 30min", (b) AI детектит переход, предлагает split, (c) audit каждого split.
- **Confidence:** 🟡 medium

## 6. Забыл выйти со смены до следующего утра
- **Ожидает:** AI понял что я уже сплю дома — перенёс close на 17:00 вчера.
- **Почему сложно:** Ambiguous — может worker реально там ночевал (emergency).
- **Как ломается:** Retroactive edit без confirmation → потеря доверия.
- **Решаем:** (a) propose retro-close с reason prompt, (b) никогда silent edit, (c) show последнее geo до drop-off.
- **Confidence:** 🟢 high (если confirmation)

## 7. GPS не работает (indoor работа)
- **Ожидает:** Check-in без GPS через QR на стене объекта.
- **Почему сложно:** QR может быть взят заранее (fraud).
- **Как ломается:** Работник отсканил QR дома.
- **Решаем:** (a) QR + фото (face match) + время (должно быть +- 30 мин от schedule), (b) BLE beacon на объекте + phone proximity.
- **Confidence:** 🟡 medium (требует железо)

## 8. Крю из 5 человек — один check-in для всех
- **Ожидает:** Прораб check-in за всю бригаду одним действием.
- **Почему сложно:** Ответственность за чужие hours, каждый worker должен явно согласиться.
- **Как ломается:** Прораб ставит присутствие когда человек ещё не приехал.
- **Решаем:** (a) crew check-in создаёт proposed sessions (not confirmed), (b) каждый worker получает notification, (c) auto-confirm если geo-match в течение 30 мин.
- **Confidence:** 🟡 medium

## 9. Время vs часы на задаче (task time)
- **Ожидает:** Часы по задаче (drywall · 4h, paint · 2h).
- **Почему сложно:** Работник не захочет постоянно переключать timer.
- **Как ломается:** Вся смена записывается на первую задачу.
- **Решаем:** (a) AI спрашивает EOD "как распределил время?", (b) photos и captions auto-classify task, (c) foreman approves.
- **Confidence:** 🟡 medium

## 10. Штраф за опоздание / bonus за punctuality
- **Ожидает:** AI посчитает automatically.
- **Почему сложно:** Опоздание vs forgiven (traffic), bonus threshold varies.
- **Как ломается:** Работник штрафован за traffic, который объективный.
- **Решаем:** (a) policy per company, (b) AI учитывает traffic via Google Maps (если >15мин delay традиционно — forgive), (c) human final decision.
- **Confidence:** 🟡 medium

---

# B. Expense management (11–20)

## 11. Receipt OCR из email
- **Ожидает:** Письмо от Home Depot → чек автоматически в системе.
- **Почему сложно:** Вендоры меняют template, total может быть в середине, tax separate.
- **Как ломается:** Неверный amount, wrong date, wrong vendor.
- **Решаем:** (a) vendor-specific parser для топ-20, (b) confidence score per field, (c) <90% confidence → прошу юзера подтвердить, (d) fine-tune на confirmed данных.
- **Confidence:** 🟢 high для топ-20 vendor, 🟡 для остальных

## 12. Receipt из физического фото
- **Ожидает:** Щёлкнул бумажный чек — AI всё распознал.
- **Почему сложно:** Размытое, перегнутое, выцветший thermal receipt.
- **Как ломается:** Amount распознан как $47 вместо $147.
- **Решаем:** (a) multi-image support (если blurry — щёлкни ещё раз), (b) amount sanity check (сравнить с обычным средним по вендору), (c) always show original photo рядом с extracted data.
- **Confidence:** 🟡 medium

## 13. Автокатегоризация (materials / fuel / meals)
- **Ожидает:** AI сам поймёт что "Home Depot" = materials.
- **Почему сложно:** Work-related vs personal mixed (работник купил краску + семейные продукты).
- **Как ломается:** Семейные продукты billed клиенту.
- **Решаем:** (a) знать что у Home Depot есть разный merch, (b) subcategorize by line items если receipt детальный, (c) admin review expenses > $200, (d) policy "single receipt only if one category".
- **Confidence:** 🟡 medium

## 14. Привязка к проекту / клиенту
- **Ожидает:** AI свяжет расход с правильным клиентом.
- **Почему сложно:** Работник может быть на 2 клиентах в день.
- **Как ломается:** Billed wrong client.
- **Решаем:** (a) geo at receipt timestamp matches active session, (b) если многозначно — AI спрашивает, (c) default на active session у данного worker'а.
- **Confidence:** 🟢 high

## 15. Duplicate detection
- **Ожидает:** Не хочу платить дважды за один чек.
- **Почему сложно:** Одна покупка приходит email + worker фотографирует.
- **Как ломается:** Дубль approved, over-pay.
- **Решаем:** (a) hash по vendor+amount+date ±1день, (b) при добавлении — алерт "похоже на expense #e14", (c) policy "не auto-approve если дубль подозрение".
- **Confidence:** 🟢 high

## 16. Non-billable expenses (коффе, личное)
- **Ожидает:** Coffee 4.50 — сразу понял "не billable".
- **Почему сложно:** Категория meals — может быть rejected, client-billed, crew lunch.
- **Как ломается:** Coffee billed to client — embarassing.
- **Решаем:** (a) rule per category × amount threshold, (b) meal > $30/person — requires note, (c) company default "no drinks unless CLIENT_APPROVED=true".
- **Confidence:** 🟢 high

## 17. Receipt без чека (забыл или потерял)
- **Ожидает:** Записал словами сумму — AI простил чек.
- **Почему сложно:** Риск fraud.
- **Как ломается:** Работники начинают submit expenses без receipt массово.
- **Решаем:** (a) policy "expense > $X обязательно receipt", (b) AI requests receipt via Telegram (ждёт до 48ч), (c) log pattern per worker — too many no-receipt = audit.
- **Confidence:** 🟢 high (это больше policy чем AI)

## 18. Mileage tracking
- **Ожидает:** AI сам посчитает проехал Я 84 мили.
- **Почему сложно:** Точность GPS, иногда phone off, иногда passenger in another car.
- **Как ломается:** Overcount (замер "в офис → home после" засчитан).
- **Решаем:** (a) mileage только если active session, (b) IRS rate auto-apply, (c) user может edit, (d) sanity check (не > 200mi/day normally).
- **Confidence:** 🟡 medium

## 19. Equipment rental tracking
- **Ожидает:** Взял genie lift, автоматически billed пока не вернул.
- **Почему сложно:** Return time может быть не зафиксирован.
- **Как ломается:** 2 дня rental but charged 5.
- **Решаем:** (a) AI напоминает вернуть с фото, (b) rental company email при возврате — автоматический parse.
- **Confidence:** 🟡 medium

## 20. Expense > $500 threshold
- **Ожидает:** Крупный расход не auto-approved.
- **Почему сложно:** Straightforward.
- **Как ломается:** Not much — working policy.
- **Решаем:** Просто reliable policy + escalate.
- **Confidence:** 🟢 high

---

# C. Sales / client interactions (21–30)

## 21. Incoming call brief (pre-call)
- **Ожидает:** Клиент звонит — я уже знаю кто он и о чём.
- **Почему сложно:** Нужно собрать 47 email + 12 calls + invoices + CO в 2 секунды.
- **Как ломается:** AI пропустил важное (last email conflict), выдал generic brief.
- **Решаем:** (a) pre-cache brief каждую ночь + incremental refresh per new email, (b) Twilio caller ID lookup, (c) fallback на 5-sec brief если caller unknown.
- **Confidence:** 🟡 medium (работает для known clients, для unknown — weaker)

## 22. Predicted Q&A на звонке
- **Ожидает:** AI предугадывает 6 вопросов клиента.
- **Почему сложно:** Клиент может спросить что угодно.
- **Как ломается:** Большинство brief предсказаний не сбылись, теряется доверие.
- **Решаем:** (a) top-3 highest-probability questions (не 6), (b) AI tracks hit rate — показывает честно "last calls 60% hit", (c) training loop на actual conversations.
- **Confidence:** 🟡 medium

## 23. Live transcription + next-question prediction
- **Ожидает:** Во время звонка AI показывает что спросят дальше.
- **Почему сложно:** Latency. Распознавание в шумной среде. Language-switching (ru/en).
- **Как ломается:** AI задержался, prediction устарело.
- **Решаем:** (a) Realtime API (Deepgram Nova-3 или OpenAI Realtime), (b) только после каждой законченной мысли, не realtime-realtime, (c) fallback "слушаю..." если unsure.
- **Confidence:** 🔴 low в MVP, 🟡 medium к GA

## 24. Post-call summary + commitments → tasks
- **Ожидает:** После call — AI сам записал что я обещал и создал задачи.
- **Почему сложно:** Commitment может быть неявный ("типа посмотрю").
- **Как ломается:** Half-commitments засчитываются как real tasks → junk backlog.
- **Решаем:** (a) confidence scoring, (b) "hedge" detection (maybe / probably / будем посмотрим), (c) require user review of every auto-task.
- **Confidence:** 🟡 medium

## 25. Cold lead qualification
- **Ожидает:** Новый контакт на email — AI сказал стоит ли лидировать.
- **Почему сложно:** Junk emails, spam, real leads mixed.
- **Как ломается:** Real lead classified as spam.
- **Решаем:** (a) conservative classifier, (b) everything borderline → human inbox, (c) learn from ignored/responded patterns.
- **Confidence:** 🟡 medium

## 26. Proposal generation
- **Ожидает:** AI сделал draft предложения за 5 мин.
- **Почему сложно:** Pricing зависит от 20 факторов, которые не все в данных.
- **Как ломается:** Pricing wrong by 30%.
- **Решаем:** (a) AI draftит только structure/text, не pricing, (b) pricing заполняется по template на основе profitability history, (c) human полный review обязателен.
- **Confidence:** 🟡 medium

## 27. Upsell detection from conversation
- **Ожидает:** Клиент сказал "mbe bath reno в июне" — AI caught это как opportunity.
- **Почему сложно:** Контекст subtle.
- **Как ломается:** Миллион false positives → сам себе создал шум.
- **Решаем:** (a) high-threshold signals (client самостоятельно mentioned, не в ответ), (b) track probability over time, (c) admin curates list.
- **Confidence:** 🟡 medium

## 28. Client sentiment tracking over time
- **Ожидает:** Graph "клиент happiness" over 6 months.
- **Почему сложно:** Sentiment subtle, sarcasm, language mixing.
- **Как ломается:** Ложное срабатывание "he's angry" когда клиент просто короткий.
- **Решаем:** (a) multi-modal: не только текст emails но также response time, paid on time, complaints, (b) не alert on single signal.
- **Confidence:** 🟡 medium

## 29. Competitor quote defense
- **Ожидает:** Клиент "a у X дешевле" — AI подсказал что ответить.
- **Почему сложно:** Нужно знать наш differentiator, их weakness.
- **Как ломается:** Generic answer "we're better" → клиент раздражён.
- **Решаем:** (a) pre-seeded company playbook (warranty, portfolio, response-time SLA), (b) past objection log в Knowledge Base, (c) live coach.
- **Confidence:** 🟡 medium

## 30. Automatic CRM data enrichment
- **Ожидает:** Клиент upsold → его record обновлён (LTV, projects, stakeholders).
- **Почему сложно:** Conflict resolution (если two emails → два разных stakeholders роли).
- **Как ломается:** Record goes stale или мешанина.
- **Решаем:** (a) human approves updates, (b) AI predicts update → shows diff → human click accept, (c) merge conflict detection.
- **Confidence:** 🟢 high

---

# D. Foreman / crew management (31–40)

## 31. Crew scheduling на следующую неделю
- **Ожидает:** AI предложил расстановку крю на 7 дней.
- **Почему сложно:** Constraints: skills, geography, overtime, PTO, client deadlines.
- **Как ломается:** Double-booking, skill mismatch (electrician sent to drywall), unfair overtime distribution.
- **Решаем:** (a) constraint solver + LLM for edge cases, (b) AI только proposes, foreman approves, (c) history learning (who works well together).
- **Confidence:** 🟡 medium

## 32. Conflict detection (double-booked)
- **Ожидает:** AI flagged что Михаил booked on two sites at once.
- **Почему сложно:** Легко.
- **Как ломается:** N/A.
- **Решаем:** Basic overlap check.
- **Confidence:** 🟢 high

## 33. Subcontractor tender
- **Ожидает:** AI разослал ТЗ 5 субам, собрал ответы, показал сравнительно.
- **Почему сложно:** Разные субы шлют разный формат (PDF, email, phone).
- **Как ломается:** Upload'ил свой quote AI не распарсил, 1 упущенный subcontractor выиграл бы.
- **Решаем:** (a) structured tender form → сабам, не свободный формат, (b) phone-to-email prompt "пожалуйста пришлите на email", (c) manual entry fallback.
- **Confidence:** 🟡 medium (см. §2 in PROJECT_WORKFLOW_SPEC_V1.md)

## 34. Site-visit planning с travel time
- **Ожидает:** Михаил назначен на 3 visits — AI учёл traffic.
- **Почему сложно:** Travel time не точно предсказуем.
- **Как ломается:** Опоздал на второй visit.
- **Решаем:** (a) Google Maps API live traffic, (b) buffer +30 min, (c) notify клиенту at departure.
- **Confidence:** 🟢 high

## 35. Handoff between shifts
- **Ожидает:** Утренний рабочий поставил вечернему о состоянии.
- **Почему сложно:** Нужно knowledge transfer, не просто timestamp.
- **Как ломается:** Evening shift не знает что утренняя бригада разбила.
- **Решаем:** (a) EOD summary в chat → next shift start, (b) photos как evidence, (c) AI extracts handoff notes.
- **Confidence:** 🟢 high

## 36. Unexpected worker absence
- **Ожидает:** Работник не вышел — AI нашёл замену.
- **Почему сложно:** Replacement может не иметь skills.
- **Как ломается:** Отправили wrong guy.
- **Решаем:** (a) skill-matched pool, (b) overtime еarlier вместо replacement, (c) rescheduling of non-urgent work.
- **Confidence:** 🟡 medium

## 37. Material shortage at site
- **Ожидает:** "Кончился шпаклёвка" → AI заказал delivery.
- **Почему сложно:** Нужна инвентарь integration.
- **Как ломается:** Overbuy, wrong SKU.
- **Решаем:** (a) Knowledge Base о vendors, (b) AI proposes order → foreman approves in 1 tap, (c) track what was used vs ordered.
- **Confidence:** 🟡 medium

## 38. Крю balance / fairness
- **Ожидает:** AI следит чтобы overtime распределялся равномерно.
- **Почему сложно:** Некоторые workers просят OT, некоторые избегают.
- **Как ломается:** Forced OT → quit.
- **Решаем:** (a) preference per worker, (b) rotation, (c) monthly fairness report.
- **Confidence:** 🟢 high

## 39. Weather-based schedule shift
- **Ожидает:** Дождь → roofing shifted.
- **Почему сложно:** Forecast может врать, некоторые работы OK в дождь.
- **Как ломается:** Shifted когда дождь был 15 мин утром.
- **Решаем:** (a) AI предлагает, не shifts автоматически, (b) threshold >80% rain probability for 4+ hours, (c) category-specific rules.
- **Confidence:** 🟡 medium

## 40. Crew communication (group chat summary)
- **Ожидает:** Множество group chats → AI дал digest.
- **Почему сложно:** Multi-language, off-topic banter mixed with work.
- **Как ломается:** Missed important message in banter, 50% generic summary.
- **Решаем:** (a) focus только на сообщения с action items, (b) @mentioned or questions, (c) morning digest.
- **Confidence:** 🟡 medium

---

# E. Payroll (41–48)

## 41. Period close automation
- **Ожидает:** End of period — AI сам posted ведомость.
- **Почему сложно:** Sessions/expenses могут приходить поздно.
- **Как ломается:** Closed period, late expense appeared → adjustment mess.
- **Решаем:** (a) soft close (grace 2 days), (b) late expense → next period with note, (c) human approves final.
- **Confidence:** 🟢 high

## 42. Variance detection (эта неделя vs обычно)
- **Ожидает:** AI alert "Павел +23% OT этот месяц — посмотри".
- **Почему сложно:** False positives (holiday, big project push).
- **Как ломается:** Admin устал от noise.
- **Решаем:** (a) only alert if not explained by known cause, (b) threshold scaled by sample size, (c) batch in weekly digest.
- **Confidence:** 🟡 medium

## 43. ACH file generation
- **Ожидает:** Один клик — все получили деньги.
- **Почему сложно:** Bank format specifics (NACHA), error recovery.
- **Как ломается:** Rejected file по мелочи, delay payroll на день.
- **Решаем:** (a) validate pre-submit, (b) support Dwolla/Stripe as fallback, (c) retry mechanism.
- **Confidence:** 🟡 medium

## 44. Tax withholding calculation
- **Ожидает:** AI сам разобрал состояния W-4 формы и withhold правильно.
- **Почему сложно:** State-by-state правила сложные, изменяются.
- **Как ломается:** Under-withhold → работник платит тагом IRS.
- **Решаем:** (a) не реализуем self для MVP, use Gusto/Stripe Tax API, (b) AI только data entry, не calc.
- **Confidence:** 🔴 low (не делаем сами)

## 45. 1099 vs W-2 classification
- **Ожидает:** AI правильно classified contractor vs employee.
- **Почему сложно:** IRS rules complex, misclassification = fine.
- **Как ломается:** Misclassified — legal exposure.
- **Решаем:** (a) AI показывает matrix вопросов, (b) final decision — human + accountant, (c) never auto-classify.
- **Confidence:** 🔴 low (чисто UX помощь)

## 46. Per-diem rates by location
- **Ожидает:** IRS auto-rate по ZIP code.
- **Почему сложно:** Updates каждый год.
- **Как ломается:** Stale rate after 1 Jan.
- **Решаем:** (a) IRS API integration, (b) nightly refresh, (c) alert if no update > 30 days.
- **Confidence:** 🟢 high

## 47. Bonus / commission calc
- **Ожидает:** Hit milestone → auto bonus calculated.
- **Почему сложно:** Rules vary per company / worker / period.
- **Как ломается:** Over-pay bonus, legal dispute.
- **Решаем:** (a) rules engine with explicit formula, (b) human approve actualwire, (c) audit every bonus event.
- **Confidence:** 🟡 medium

## 48. Worker sees upcoming pay (forecast)
- **Ожидает:** Работник видит "$3,200 next Friday".
- **Почему сложно:** Depends on OT, expenses, unsolved.
- **Как ломается:** Expected $3,200, got $2,800 — angry.
- **Решаем:** (a) show range "$2.9k–$3.3k", (b) explain variables, (c) lock estimate 48h before payday.
- **Confidence:** 🟢 high

---

# F. Change orders / contracts (49–55)

## 49. CO detection from email
- **Ожидает:** Client email "добавить бассейн" → CO drafted.
- **Почему сложно:** Intent vs casual mention.
- **Как ломается:** Draft CO for every mention → CO spam.
- **Решаем:** (a) требуется explicit intent signal ("пожалуйста добавьте", "quote it"), (b) propose CO с confidence score, (c) human confirms.
- **Confidence:** 🟡 medium

## 50. Pricing for new scope
- **Ожидает:** AI быстро предложил price для CO.
- **Почему сложно:** Cost estimation hard for novel scope.
- **Как ломается:** Under-price.
- **Решаем:** (a) template-based pricing для known scopes, (b) unknown → "need site-visit" flag, (c) AI showing historical similar.
- **Confidence:** 🟡 medium

## 51. Client e-signature
- **Ожидает:** Отправил — клиент подписал — я вижу signed.
- **Почему сложно:** DocuSign/HelloSign integration.
- **Как ломается:** Client не получил email, CO thought signed not.
- **Решаем:** (a) DocuSign webhook → update status, (b) follow-up reminder after 48h, (c) fallback SMS.
- **Confidence:** 🟢 high

## 52. CO linked to invoice
- **Ожидает:** Signed CO → invoice adjusted automatically.
- **Почему сложно:** Invoice может уже быть partially paid.
- **Как ломается:** Invoice duplicate charge.
- **Решаем:** (a) always separate "CO invoice", not edit existing, (b) reconciliation flow.
- **Confidence:** 🟢 high

## 53. Contract initial generation
- **Ожидает:** Новый client → AI draft contract from template.
- **Почему сложно:** Legal language, state-specific clauses.
- **Как ломается:** Missing WC clause → liability exposure.
- **Решаем:** (a) approved template library только, (b) AI fills blanks (names, dates, amounts), (c) attorney review before first use.
- **Confidence:** 🟢 high (with templates)

## 54. Terms conflict detection
- **Ожидает:** Client redline против наш contract → AI alerts diffs.
- **Почему сложно:** Legal nuance.
- **Как ломается:** Missed material change (e.g. indemnity removed).
- **Решаем:** (a) diff highlighting, (b) LLM summarizes changes in plain English, (c) owner must approve redlines (never auto).
- **Confidence:** 🟡 medium

## 55. Expired / renew alerts
- **Ожидает:** Insurance expires → AI напоминает за 30 days.
- **Почему сложно:** Easy.
- **Как ломается:** N/A.
- **Решаем:** Scheduled job.
- **Confidence:** 🟢 high

---

# G. Compliance / permits (56–62)

## 56. Permit expiry tracking
- **Ожидает:** AI напоминает за 14 дней до expiry.
- **Почему сложно:** Нужна база permits с expiry dates.
- **Как ломается:** Not tracked → missed.
- **Решаем:** (a) manual entry на первых порах, (b) OCR permit docs to extract expiry, (c) city-specific APIs where available.
- **Confidence:** 🟢 high

## 57. Permit required для scope
- **Ожидает:** Новый проект — AI сказал нужен ли permit.
- **Почему сложно:** Caraerquirements по штатам, городам, scope.
- **Как ломается:** AI говорит "не нужно" — а нужно → fine.
- **Решаем:** (a) AI только informational, не binding, (b) "ask your permit runner" disclaimer, (c) common cases library.
- **Confidence:** 🟡 medium

## 58. Insurance coverage check (WC/liability)
- **Ожидает:** Новый worker — AI проверил coverage.
- **Почему сложно:** Insurance API varies.
- **Как ломается:** Gap in coverage → incident → liability.
- **Решаем:** (a) monthly sync с carrier (API or email parse), (b) worker start blocked if no coverage, (c) grace period with alerts.
- **Confidence:** 🟡 medium

## 59. OSHA logs / safety incidents
- **Ожидает:** Incident reported → OSHA form auto-drafted.
- **Почему сложно:** Form 300 rules strict.
- **Как ломается:** Incorrect fields → fine.
- **Решаем:** (a) draft only, attorney review, (b) checklist-based (не free-form), (c) conservative default.
- **Confidence:** 🟡 medium

## 60. Background check for new hire
- **Ожидает:** Connect to Checkr → auto-kick off.
- **Почему сложно:** Consent required, legal process.
- **Как ломается:** Compliance issue if run без consent.
- **Решаем:** (a) worker explicitly opts-in в onboarding, (b) documented chain.
- **Confidence:** 🟢 high (just plumbing)

## 61. E-Verify / I-9 compliance
- **Ожидает:** Новый employee → E-Verify done.
- **Почему сложно:** Federal requirement, timing strict.
- **Как ломается:** Missed deadline → fine.
- **Решаем:** (a) onboarding checklist блокирует shift_start until I-9 signed, (b) E-Verify integration, (c) re-verification alert.
- **Confidence:** 🟢 high

## 62. State sales tax on materials pass-through
- **Ожидает:** AI разделил billable materials + markup + tax.
- **Почему сложно:** Tax rules differ per state.
- **Как ломается:** Over-collect or under-collect.
- **Решаем:** (a) TaxJar/Avalara integration, (b) AI just data prep, (c) CPA reviews quarterly.
- **Confidence:** 🟡 medium

---

# H. Inventory / materials (63–69)

## 63. What's in my warehouse
- **Ожидает:** Real-time inventory на складе.
- **Почему сложно:** Workers такой счёт не ведут.
- **Как ломается:** Inventory stale.
- **Решаем:** (a) barcode scanning at check-out (worker scans phone before takes), (b) reconciliation every week, (c) AI reminds if discrepancy.
- **Confidence:** 🟡 medium

## 64. Auto-reorder when low
- **Ожидает:** Screws below 500 → AI заказал.
- **Почему сложно:** Lead time varies, price varies.
- **Как ломается:** Overstock, wrong vendor.
- **Решаем:** (a) propose, не auto, (b) price comparison across vendors, (c) owner one-click approve.
- **Confidence:** 🟡 medium

## 65. Cross-project material sharing
- **Ожидает:** Project A finished — leftover → Project B.
- **Почему сложно:** Billing — who pays?
- **Как ломается:** A billed for B's materials.
- **Решаем:** (a) transfer log, (b) AI proposes transfer (not auto), (c) cost re-attribution.
- **Confidence:** 🟢 high

## 66. Surplus return to vendor
- **Ожидает:** AI напомнил вернуть unused materials.
- **Почему сложно:** 30-day return window.
- **Как ломается:** Missed return.
- **Решаем:** (a) calendar trigger at 20 days, (b) packing list templated.
- **Confidence:** 🟢 high

## 67. Material waste tracking
- **Ожидает:** AI flagged что waste % abnormal (15% vs avg 8%).
- **Почему сложно:** Measuring waste accurately.
- **Как ломается:** False positive.
- **Решаем:** (a) photos on project close, (b) EOD entry by worker, (c) trend over multiple projects.
- **Confidence:** 🟡 medium

## 68. Vendor price comparison
- **Ожидает:** AI сравнил price у 3 vendors перед заказом.
- **Почему сложно:** Real-time prices not always available.
- **Как ломается:** Stale price, не honored.
- **Решаем:** (a) confirmed pricing через API / cart, (b) fallback на 30-day avg.
- **Confidence:** 🟡 medium

## 69. Tools checked out to workers
- **Ожидает:** AI знает у кого мой impact drill.
- **Почему сложно:** Workers не логируют.
- **Как ломается:** Lost tool, no accountability.
- **Решаем:** (a) QR/barcode on tools, (b) chat-based check-out ("у меня drill #3"), (c) monthly inventory.
- **Confidence:** 🟡 medium

---

# I. Site-visits / scheduling (70–76)

## 70. Schedule site-visit with traffic
- **Ожидает:** AI предложил время учитывая traffic.
- **Почему сложно:** Future traffic unpredictable.
- **Как ломается:** Actual traffic worse.
- **Решаем:** (a) Google Maps Distance Matrix API, (b) add 30% buffer, (c) live traffic alert при старте.
- **Confidence:** 🟢 high

## 71. Reminders before site-visit
- **Ожидает:** 24h + 2h reminders всем participants.
- **Почему сложно:** Легко.
- **Как ломается:** N/A.
- **Решаем:** Scheduled notifications.
- **Confidence:** 🟢 high

## 72. Reschedule cascade
- **Ожидает:** Cancel visit → AI предложил новые slots для всех.
- **Почему сложно:** Multi-party scheduling (client, foreman, subcontractors).
- **Как ломается:** Proposed slot conflicts.
- **Решаем:** (a) Calendly-like group scheduling, (b) calendar API integration, (c) human final approve.
- **Confidence:** 🟡 medium

## 73. Remote vs in-person decision
- **Ожидает:** AI советует "this может быть remote".
- **Почему сложно:** Context-dependent.
- **Как ломается:** AI сказал "remote OK" — client wanted in-person.
- **Решаем:** (a) client preference stored, (b) type of meeting matters (estimate required physical), (c) AI suggests — owner decides.
- **Confidence:** 🟡 medium

## 74. Measurement / photo capture on visit
- **Ожидает:** Foreman снял — AI засёк все measurements.
- **Почему сложно:** Photo-to-measurement OCR пока слабый.
- **Как ломается:** Wrong dimensions → wrong estimate.
- **Решаем:** (a) LiDAR (iPhone Pro) integration, (b) manual entry with photo reference, (c) NOT AI OCR для measurement.
- **Confidence:** 🔴 low (AR too early)

## 75. Site-visit summary → estimate draft
- **Ожидает:** После visit — draft estimate в 10 минут.
- **Почему сложно:** Много variables.
- **Как ломается:** Draft wrong by 40%.
- **Решаем:** (a) template-based, (b) similar projects matched, (c) human confirms each line.
- **Confidence:** 🟡 medium

## 76. Weather contingency
- **Ожидает:** Rain forecast → reschedule.
- **Почему сложно:** Forecast 3-days accuracy ~60%.
- **Как ломается:** Rescheduled unnecessarily.
- **Решаем:** (a) only shift within-24h forecast, (b) client consent preferred, (c) weather insurance for big.
- **Confidence:** 🟡 medium

---

# J. Communication (voice/chat/email) (77–84)

## 77. Multi-language chat (worker speaks Spanish)
- **Ожидает:** Worker чат на Spanish → admin видит English.
- **Почему сложно:** Translation quality varies (idioms).
- **Как ломается:** Meaning lost, offense taken.
- **Решаем:** (a) show original + translation side-by-side, (b) high-quality model (DeepL, Claude), (c) fallback to human translator flag.
- **Confidence:** 🟢 high

## 78. Voice message transcription
- **Ожидает:** Worker шлёт voice message — AI транскрибирует.
- **Почему сложно:** Background noise, accent.
- **Как ломается:** Transcription wrong, action taken on wrong data.
- **Решаем:** (a) require confirmation if uncertain, (b) store original audio, (c) multiple model voting.
- **Confidence:** 🟡 medium

## 79. Incoming SMS from client
- **Ожидает:** Client texts — routed to right project.
- **Почему сложно:** Numbers могут быть shared.
- **Как ломается:** Routed to wrong project.
- **Решаем:** (a) contact lookup, (b) if ambiguous → ask user "is this about Acme or Westfield?", (c) threaded.
- **Confidence:** 🟢 high

## 80. Outgoing email — AI-drafted follow-up
- **Ожидает:** AI drafted reply — я просмотрел и отправил.
- **Почему сложно:** Tone, professionalism.
- **Как ломается:** Sent wrong recipient, wrong tone.
- **Решаем:** (a) NEVER auto-send, (b) pre-filled draft in Gmail, (c) tone matching past emails.
- **Confidence:** 🟢 high

## 81. Emoji / short-hand interpretation
- **Ожидает:** Worker "👍" → AI понял "да, понял".
- **Почему сложно:** Ambiguity.
- **Как ломается:** "👍" as sarcasm.
- **Решаем:** (a) conservative interpretation, (b) clarify if action-critical.
- **Confidence:** 🟢 high

## 82. Typo tolerance
- **Ожидает:** "sheetrock" или "drywlal" — AI понял.
- **Почему сложно:** LLM handles это.
- **Как ломается:** Rarely.
- **Решаем:** Default LLM behavior.
- **Confidence:** 🟢 high

## 83. Formal vs informal channel
- **Ожидает:** Telegram worker = informal, client email = formal.
- **Почему сложно:** AI должен know channel norms.
- **Как ломается:** Too formal in Telegram — wooden; too informal in email — unprofessional.
- **Решаем:** (a) channel-specific prompts, (b) example responses library.
- **Confidence:** 🟢 high

## 84. Knowledge Base search ("do I have permit for Acme?")
- **Ожидает:** Chat question → instant answer from docs.
- **Почему сложно:** RAG accuracy, doc freshness.
- **Как ломается:** Outdated info → wrong answer.
- **Решаем:** (a) Doc re-index nightly, (b) freshness timestamp в ответе, (c) cite source.
- **Confidence:** 🟡 medium

---

# K. Multi-tenancy / security (85–90)

## 85. Cross-tenant data leakage
- **Ожидает:** Никогда.
- **Почему сложно:** Firestore rules + LLM context bleed.
- **Как ломается:** Prompt injection → leak другому tenant.
- **Решаем:** (a) RLS на DB level (Firestore security rules), (b) LLM never see cross-tenant data, (c) red-team tests.
- **Confidence:** 🟡 medium (требует ongoing vigilance)

## 86. Prompt injection through user input
- **Ожидает:** Safe.
- **Почему сложно:** "Ignore previous instructions" attacks.
- **Как ломается:** Malicious client email → AI leaks или takes action.
- **Решаем:** (a) input sanitization, (b) system prompts wrapped in immutable delimiters, (c) function calling rather than free text.
- **Confidence:** 🟡 medium

## 87. PII in logs / transcripts
- **Ожидает:** SSN, bank accs never stored in plaintext.
- **Почему сложно:** Hard to detect in free text.
- **Как ломается:** Worker посылает SSN в chat — в logs forever.
- **Решаем:** (a) PII redaction pre-storage, (b) regex + LLM detector, (c) separate encrypted PII vault.
- **Confidence:** 🟡 medium

## 88. GDPR / CCPA right to delete
- **Ожидает:** Client says "delete my data" — AI does.
- **Почему сложно:** Data spread across Firestore, Storage, backups, LLM fine-tune data.
- **Как ломается:** Missed one place.
- **Решаем:** (a) single "delete user" function touching all collections, (b) backups rotate out within 90 days, (c) never fine-tune на user data.
- **Confidence:** 🟡 medium

## 89. Role-based access control (RBAC)
- **Ожидает:** Worker не видит admin data.
- **Почему сложно:** Fine-grained permissions.
- **Как ломается:** UI hides data but API returns it.
- **Решаем:** (a) server-side enforcement, (b) tested matrix per role, (c) audit on access.
- **Confidence:** 🟢 high

## 90. API abuse / rate limiting
- **Ожидает:** Prevent one tenant DDOS'ing.
- **Почему сложно:** Firebase quotas are global.
- **Как ломается:** One tenant спамит LLM → cost blowup.
- **Решаем:** (a) per-tenant rate limits, (b) per-tenant cost caps, (c) alert at 80% threshold.
- **Confidence:** 🟢 high

---

# L. Edge cases / cultural / safety (91–100)

## 91. Worker refuses AI agent (privacy concerns)
- **Ожидает:** Worker can opt out.
- **Почему сложно:** Trust, cultural variance.
- **Как ломается:** Forced AI → discontent → turnover.
- **Решаем:** (a) opt-in for geo-tracking, (b) human-only mode available, (c) transparent data use.
- **Confidence:** 🟢 high (matter of UX)

## 92. Worker на лекарствах / медуслугах (HIPAA)
- **Ожидает:** AI never sees medical info.
- **Почему сложно:** Worker can paste medical info in chat.
- **Как ломается:** Medical info in logs.
- **Решаем:** (a) PII detector (includes medical), (b) warning при sensitive input, (c) redact automatically.
- **Confidence:** 🟡 medium

## 93. Worker injured on-site (emergency)
- **Ожидает:** AI прекратил autokvantizing, notified emergency contacts.
- **Почему сложно:** Emergency detection.
- **Как ломается:** False alarm, или missed real emergency.
- **Решаем:** (a) keyword trigger ("911", "hospital", "accident"), (b) dedicated SOS button на mobile, (c) never auto-call — just surface to admin.
- **Confidence:** 🟡 medium

## 94. Worker stealing / time fraud
- **Ожидает:** AI flagged unusual patterns.
- **Почему сложно:** Privacy concerns, false accusations.
- **Как ломается:** Innocent flagged, lawsuit.
- **Решаем:** (a) patterns shown to admin (never directly accuse), (b) multiple independent signals required, (c) human investigation.
- **Confidence:** 🟡 medium

## 95. Disagreement worker ↔ admin about hours
- **Ожидает:** AI shows evidence (geo, face, etc.) → neutral ground.
- **Почему сложно:** One party may feel AI biased.
- **Как ломается:** Trust broken.
- **Решаем:** (a) AI shows both versions, (b) human arbiter, (c) audit trail immutable.
- **Confidence:** 🟢 high

## 96. Natural disaster (hurricane shutdown)
- **Ожидает:** AI поставил на паузу schedules, notified everyone.
- **Почему сложно:** Coordination mass scale.
- **Как ломается:** Miscoordinated.
- **Решаем:** (a) admin "emergency mode" switch, (b) pre-templated comms, (c) insurance partner integration.
- **Confidence:** 🟡 medium

## 97. Strike / union rules
- **Ожидает:** AI respects union hours.
- **Почему сложно:** Rules are legal contracts.
- **Как ломается:** Unintended violation.
- **Решаем:** (a) union rules encoded in policy engine, (b) separate calendar for union work, (c) warnings before sched.
- **Confidence:** 🟡 medium

## 98. Seasonal worker / H-2B visas
- **Ожидает:** AI tracks visa expiry.
- **Почему сложно:** Immigration rules complex.
- **Как ломается:** Work past visa → company fine.
- **Решаем:** (a) visa expiry in worker record, (b) shift_start blocked after expiry, (c) 60-day warning.
- **Confidence:** 🟢 high

## 99. Owner / admin goes on vacation
- **Ожидает:** AI продолжает делать routine, не escalates.
- **Почему сложно:** Threshold escalation depends on admin responsiveness.
- **Как ломается:** AI waiting на admin → bottleneck.
- **Решаем:** (a) "vacation mode" (raise thresholds), (b) deputy auto-approves in admin's absence, (c) digest email with only critical.
- **Confidence:** 🟢 high

## 100. Business sold / closed
- **Ожидает:** Data export, legal compliance.
- **Почему сложно:** Data retention laws.
- **Как ломается:** Data lost или not properly transferred.
- **Решаем:** (a) one-click export (CSV + PDF), (b) 90-day retention after cancellation, (c) buyer-friendly API.
- **Confidence:** 🟢 high

---

# Выводы · топ-10 рисков

1. **Money actions без human approve** — blast radius огромен. Лечим: L0–L3 authority с threshold, escalation queues.
2. **Prompt injection** — attack через email/chat input. Лечим: structured function calling, не free-text, prompt firewalling.
3. **Cross-tenant data leak** — legal + trust-killer. Лечим: DB-level RLS, LLM context isolation, red-team tests.
4. **Hallucination на critical data** (hours, dollars, dates) — скрыть невозможно. Лечим: "numbers never LLM-generated, только функциональный output", confidence score visible.
5. **OCR wrong amount** — direct money loss. Лечим: per-field confidence, <90% требует confirm, sanity checks.
6. **Trust loss if AI wrong once** — workers/clients отказываются. Лечим: "propose only" default, явные undo, show reasoning.
7. **LLM cost blowup** — $10k billing bomb. Лечим: per-tenant caps, budget alerts, prompt caching.
8. **Geo false positives** — false shift starts/closes. Лечим: confirmation required, time-window, staying time.
9. **Compliance violations (I-9, visas, permits)** — легальная ответственность. Лечим: human-in-loop, чек-листы, integrations.
10. **Mobile UX для low-tech workers** — если не работает на телефоне просто — adoption fails. Лечим: chat-first (WhatsApp-like), no UI to learn.

---

# Стратегические рекомендации

## Приоритеты для MVP (что точно делаем)
1. 🟢 Receipt OCR (высокий ROI, низкий риск) — начинаем с этого
2. 🟢 Call brief generator (дифференциатор) — большой "wow"
3. 🟢 Worker chat agent (Telegram) — адоптация через знакомый канал
4. 🟢 Auto-approve expense ≤$500 (clear ROI)
5. 🟢 CO drafting from email (reduce admin time)

## Откладываем до GA
- 🔴 Live call transcription + next-question (технически незрело в real-time)
- 🔴 Auto-payroll (слишком high-stakes для v1)
- 🔴 Photo-to-measurement (AR пока слабо)
- 🔴 Tax calculation self-hosted (Gusto/Stripe делают лучше)

## Ни одного MVP без
- Explicit human approval queue
- Undo на каждое AI-действие
- Cost meter per agent
- Audit log visible to user
- "Почему AI это сделал" explain modal
- Опция "pause this agent"

## Метрики которые отслеживаем с дня 1
- **Acceptance rate** AI-предложений (должно быть > 70%)
- **Override rate** (< 30%)
- **Cost per user per day** ($3–8 MVP, < $5 GA)
- **Time-to-value** (от onboarding до first AI approval < 24h)
- **Error rate per agent** (< 5% alertable)
- **Customer NPS** (target > 50 у design partners)

---

*100/100 кейсов разобрано. Готов к утверждению.*

*Резюме одной фразой: AI хорош в 70% контора-ops если признать где он плох и включить человека в loop именно там. Наш edge — explicit trust layer + boring-thing-automation, не "magic AI".*
