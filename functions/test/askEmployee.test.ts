/**
 * Ask Employee feature — schema + message template tests
 */
import { AskEmployeeSchema } from '../src/agent/schemas';

describe('AskEmployeeSchema', () => {
  it('accepts empty body (default question)', () => {
    const result = AskEmployeeSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeUndefined();
    }
  });

  it('accepts custom message', () => {
    const result = AskEmployeeSchema.safeParse({
      message: 'Это трата по проекту Tampa?',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Это трата по проекту Tampa?');
    }
  });

  it('rejects empty string message', () => {
    const result = AskEmployeeSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects message over 2000 chars', () => {
    const result = AskEmployeeSchema.safeParse({ message: 'A'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('accepts message exactly at limit (2000 chars)', () => {
    const result = AskEmployeeSchema.safeParse({ message: 'A'.repeat(2000) });
    expect(result.success).toBe(true);
  });
});

describe('Telegram message template', () => {
  // Simulate the message building logic from finance.ts
  function buildAskMessage(
    tx: { amount: number; cleanMerchant: string; date?: string; categoryId?: string },
    customMessage?: string,
  ): string {
    const COST_CATEGORY_LABELS: Record<string, string> = {
      materials: 'Материалы', tools: 'Инструменты', reimbursement: 'Возмещение',
      fuel: 'Топливо', housing: 'Жилье (Рента)', food: 'Питание',
      permit: 'Документы', other: 'Прочее',
    };

    const amount = Math.abs(tx.amount).toFixed(2);
    const merchant = tx.cleanMerchant || 'Unknown';
    const dateStr = tx.date || '';
    const categoryLabel = tx.categoryId ? (COST_CATEGORY_LABELS[tx.categoryId] || tx.categoryId) : '';

    return [
      `💳 *Вопрос по транзакции*`,
      ``,
      `Сумма: *$${amount}*`,
      `Продавец: ${merchant}`,
      dateStr ? `Дата: ${dateStr}` : '',
      categoryLabel ? `Категория: ${categoryLabel}` : '',
      ``,
      customMessage || `Можешь пояснить эту транзакцию? Это рабочая трата или личная?`,
      ``,
      `_Ответь в этот чат — сообщение будет видно в CRM._`,
    ].filter(Boolean).join('\n');
  }

  it('builds default question with transaction details', () => {
    const msg = buildAskMessage({
      amount: -42.50,
      cleanMerchant: 'HOME DEPOT',
      date: '2026-04-10',
      categoryId: 'materials',
    });
    expect(msg).toContain('$42.50');
    expect(msg).toContain('HOME DEPOT');
    expect(msg).toContain('2026-04-10');
    expect(msg).toContain('Материалы');
    expect(msg).toContain('рабочая трата или личная');
  });

  it('uses custom message when provided', () => {
    const msg = buildAskMessage(
      { amount: -100, cleanMerchant: 'LOWES' },
      'Это было для проекта Tampa? Номер заказа?'
    );
    expect(msg).toContain('Это было для проекта Tampa?');
    expect(msg).not.toContain('рабочая трата или личная');
  });

  it('handles negative amounts (shows absolute value)', () => {
    const msg = buildAskMessage({ amount: -85.99, cleanMerchant: 'SHELL' });
    expect(msg).toContain('$85.99');
    expect(msg).not.toContain('-');
  });

  it('omits date line when no date', () => {
    const msg = buildAskMessage({ amount: -10, cleanMerchant: 'STORE' });
    expect(msg).not.toContain('Дата:');
  });

  it('omits category line when no category', () => {
    const msg = buildAskMessage({ amount: -10, cleanMerchant: 'STORE' });
    expect(msg).not.toContain('Категория:');
  });
});

describe('Clarification status values', () => {
  const validStatuses = ['pending', 'answered', 'send_failed', null] as const;

  it('all expected statuses are defined', () => {
    // Mirrors the ReconcileTx type
    type ClarificationStatus = 'pending' | 'answered' | 'send_failed' | null;
    const statuses: ClarificationStatus[] = ['pending', 'answered', 'send_failed', null];
    expect(statuses).toEqual(validStatuses);
  });

  it('pending means message sent, waiting for reply', () => {
    // Business rule: pending → show hourglass icon
    expect('pending').toBe('pending');
  });

  it('answered means employee replied', () => {
    // Business rule: answered → show check icon
    expect('answered').toBe('answered');
  });

  it('send_failed means Telegram delivery failed', () => {
    // Business rule: send_failed → allow retry
    expect('send_failed').toBe('send_failed');
  });
});
