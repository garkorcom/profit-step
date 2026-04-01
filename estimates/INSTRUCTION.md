# Категория: Estimates (Сметы и Проекты)

## Назначение
Модуль для оценки стоимости проектов и генерации красивых коммерческих предложений (Estimates). Интенсивно обрастает AI функционалом (Blueprint Estimator, Electrical Calculator).

## Как работать (Сценарии пользователя)
- **Calculator (Electrical)**: Инструмент для быстрого расчета электромонтажных или других работ. Подтягиваются заранее заведенные расценки (rates), выбираются комнаты (Rooms), количество точек (Points).
- **Project Library**: Библиотека всех проектов (Смет) в статусах Draft, Sent, Approved, Rejected, Completed.
- **AI Blueprint Estimator**: Автоматизированная загрузка чертежа (PDF). AI парсит чертеж, распознает масштаб, узлы, считает розетки, кабель, трубы и выдает готовую смету.

## Основные Связи (Отношения с другими модулями)
- **Estimates ↔ Finance**: После аппрува сметы (`Approved`), ее финальная стоимость уходит в `Finance` как 예상емый Доход по проекту (Plan vs Fact).
- **Estimates ↔ Tasks (GTD)**: Нажатием одной кнопки "Convert to Tasks" многостраничная смета может разбиться на десятки `Next Action` задач в Inbox для рабочих ("Установить розетку в спальне 1").
- **Estimates ↔ CRM**: Смета всегда привязана к `clientId`. Имя сметы часто содержит адрес объекта.
- **Estimates ↔ OpenClaw (Агенты)**: Это основной хаб для взаимодействия с Vision OCR и модулем `Super-Estimator pipeline`.

## Как это устроено (Для разработчика)
- **Коллекции Firestore**: 
  - `projects` (Сметы фактически хранятся как проекты), `estimates`.
  - Вложенные коллекции: `rooms`, `items`.
- **Файлы/Компоненты**: 
  - `src/components/estimates/pipeline/` (Для AI пайплайна).
- **Архитектура AI Estimator**: 
  - Модуль работает через внешний gateway (OpenClaw), который вызывает `Gemini/Claude Opus` с использованием Vision Tool, а потом результат (`JSON` со сметой) возвращается в Profit Step через вебхуки на Firestore. Общение часто проходит через брокер вроде `SessionNotifier`. Обязательно присутствует *AI Confidence Scoring* (указание на визуальном слое, где ИИ сомневается).

## Что посмотреть на GitHub или в Документации
- Обязательно смотреть KI `AI Infrastructure & Features` (файлы: `ai_task_estimation_architecture.md`, `price_estimation.md`, `smart_task_input.md`). Конфиг пайплайна и промпты для LLM обычно лежат в OpenClaw Gateway на VPS `farmersmilkbot`, а не только в Profit Step.
