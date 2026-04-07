# 🚀 functions/src/services/ — Улучшения AI Сервисов

## 🔴 Критические

### 1. Prompt Management
Промпты сейчас захардкожены в код сервисов. Вынести в:

```
functions/src/prompts/
├── blueprint.ts           — Промпты для чертежей
├── costs.ts               — Промпты для категоризации расходов
├── smartDispatcher.ts     — Промпты Smart Dispatcher
├── taskEstimation.ts      — Промпты оценки задач
├── shopping.ts            — Промпты для списков покупок
└── leadSummary.ts         — Промпты для лидов
```

Это позволит:
- A/B тестировать промпты
- Версионировать промпты
- Быстро менять без деплоя (через Remote Config)

### 2. Unified AI Client
Создать единый интерфейс для работы с AI:

```typescript
// services/aiClient.ts
interface AIResponse {
  text: string;
  model: string;
  tokens: { input: number; output: number };
  latency: number;
}

class UnifiedAIClient {
  async generate(prompt: string, options: {
    provider: 'gemini' | 'claude' | 'openai';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    schema?: z.ZodSchema; // Structured output
  }): Promise<AIResponse> { ... }
}
```

---

## 🟡 Среднесрочные

### 3. Retry Logic с Exponential Backoff
AI API часто возвращают 429/503. Добавить:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(baseDelay * Math.pow(2, i));
    }
  }
}
```

### 4. AI Cost Tracking
Логировать стоимость каждого AI вызова:
```typescript
await auditLogger.log('ai_usage', {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  inputTokens: 1500,
  outputTokens: 800,
  costUsd: 0.0023,
  function: 'analyzeBlueprint',
});
```

### 5. Fallback Chain
Если Gemini недоступен — автоматический fallback на Claude/OpenAI:
```
Gemini Flash → Gemini Pro → Claude Sonnet → Claude Haiku
```

---

## 🟢 Долгосрочные

### 6. Structured Output (JSON Mode)
Использовать Gemini/Claude JSON mode для гарантированного формата ответа.

### 7. AI Evaluation Pipeline
Тестовый набор для оценки качества AI ответов (precision/recall для категоризации).

### 8. Prompt Versioning
Firebase Remote Config для управления промптами без деплоя.
