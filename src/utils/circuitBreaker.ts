/**
 * Circuit Breaker Pattern для защиты от runaway costs
 *
 * Защищает систему от каскадных сбоев и перерасхода Firestore reads
 * при возникновении проблем.
 *
 * States:
 * - CLOSED: нормальная работа, запросы проходят
 * - OPEN: слишком много ошибок, запросы блокируются
 * - HALF_OPEN: пробный режим после таймаута
 */

export interface CircuitBreakerOptions {
  /** Количество ошибок подряд до открытия circuit */
  failureThreshold?: number;
  /** Время в мс до попытки восстановления */
  timeout?: number;
  /** Callback при открытии circuit */
  onOpen?: () => void;
  /** Callback при закрытии circuit */
  onClose?: () => void;
  /** Callback при половинном открытии */
  onHalfOpen?: () => void;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  protected state: CircuitState = 'CLOSED'; // protected для наследования
  private readonly failureThreshold: number;
  private readonly timeout: number;
  protected readonly onOpen?: () => void; // protected для наследования
  private readonly onClose?: () => void;
  private readonly onHalfOpen?: () => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 60000; // 1 минута
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.onHalfOpen = options.onHalfOpen;
  }

  /**
   * Выполняет функцию через circuit breaker
   * @param fn - Async функция для выполнения
   * @returns Результат функции
   * @throws Error если circuit открыт или функция провалилась
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Проверяем состояние circuit
    if (this.state === 'OPEN') {
      const now = Date.now();

      // Проверяем, прошел ли таймаут
      if (now - this.lastFailTime > this.timeout) {
        console.log('🔄 Circuit breaker: Entering HALF_OPEN state');
        this.state = 'HALF_OPEN';
        this.onHalfOpen?.();
      } else {
        const remainingMs = this.timeout - (now - this.lastFailTime);
        const remainingSec = Math.ceil(remainingMs / 1000);
        throw new Error(
          `Circuit breaker is OPEN - too many failures. Retry in ${remainingSec}s`
        );
      }
    }

    try {
      // Выполняем функцию
      const result = await fn();

      // Успех - сбрасываем счетчик и закрываем если нужно
      if (this.state === 'HALF_OPEN') {
        console.log('✅ Circuit breaker: Closing after successful test');
        this.state = 'CLOSED';
        this.failures = 0;
        this.onClose?.();
      } else if (this.state === 'CLOSED' && this.failures > 0) {
        // Постепенно уменьшаем счетчик при успехе
        this.failures = Math.max(0, this.failures - 1);
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailTime = Date.now();

      console.error(
        `❌ Circuit breaker: Failure ${this.failures}/${this.failureThreshold}`,
        error
      );

      // Проверяем, нужно ли открыть circuit
      if (this.failures >= this.failureThreshold && this.state === 'CLOSED') {
        console.error('🚨 Circuit breaker: OPENING - threshold reached');
        this.state = 'OPEN';
        this.onOpen?.();
      }

      throw error;
    }
  }

  /**
   * Принудительно сбрасывает circuit breaker в CLOSED состояние
   */
  reset(): void {
    console.log('🔄 Circuit breaker: Manual reset to CLOSED');
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailTime = 0;
  }

  /**
   * Получает текущее состояние circuit
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Получает количество ошибок
   */
  getFailures(): number {
    return this.failures;
  }

  /**
   * Проверяет, открыт ли circuit
   */
  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /**
   * Получает оставшееся время до half-open (в мс)
   */
  getTimeUntilHalfOpen(): number {
    if (this.state !== 'OPEN') return 0;

    const now = Date.now();
    const elapsed = now - this.lastFailTime;
    return Math.max(0, this.timeout - elapsed);
  }

  /**
   * Получает статистику circuit breaker
   */
  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      threshold: this.failureThreshold,
      timeout: this.timeout,
      isOpen: this.isOpen(),
      timeUntilHalfOpen: this.getTimeUntilHalfOpen(),
    };
  }
}

/**
 * Создает глобальный circuit breaker для Firestore операций
 */
export const firestoreCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3, // 3 ошибки подряд
  timeout: 60000, // 1 минута до попытки восстановления
  onOpen: () => {
    console.error('🚨 FIRESTORE CIRCUIT BREAKER OPEN - blocking queries');
    console.error('⚠️  Too many failures detected. Queries will be blocked for 60 seconds.');
  },
  onClose: () => {
    console.log('✅ FIRESTORE CIRCUIT BREAKER CLOSED - normal operation resumed');
  },
  onHalfOpen: () => {
    console.log('🔄 FIRESTORE CIRCUIT BREAKER HALF-OPEN - testing connection');
  },
});

/**
 * Cost protection circuit breaker - специально для защиты от перерасхода
 */
export class CostProtectionBreaker extends CircuitBreaker {
  private totalReads = 0;
  private readonly readLimit: number;
  private readonly warningThreshold: number;
  private onWarning?: (reads: number, limit: number) => void;

  constructor(options: CircuitBreakerOptions & {
    readLimit?: number;
    warningThreshold?: number;
    onWarning?: (reads: number, limit: number) => void;
  } = {}) {
    super(options);
    this.readLimit = options.readLimit || 5000; // 5K reads per session
    this.warningThreshold = options.warningThreshold || 1000; // Warning at 1K
    this.onWarning = options.onWarning;
  }

  /**
   * Трекает количество Firestore reads
   */
  trackReads(reads: number): void {
    this.totalReads += reads;

    // Проверка warning threshold
    if (
      this.totalReads >= this.warningThreshold &&
      this.totalReads - reads < this.warningThreshold
    ) {
      console.warn(`⚠️  Cost warning: ${this.totalReads} reads reached`);
      this.onWarning?.(this.totalReads, this.readLimit);
    }

    // Проверка hard limit
    if (this.totalReads >= this.readLimit) {
      console.error(`🚨 Cost limit exceeded: ${this.totalReads}/${this.readLimit} reads`);
      this.state = 'OPEN';
      this.onOpen?.();
    }
  }

  /**
   * Получает текущее количество reads
   */
  getTotalReads(): number {
    return this.totalReads;
  }

  /**
   * Получает оценочную стоимость
   */
  getEstimatedCost(): number {
    return this.totalReads * (0.06 / 100000); // $0.06 per 100K reads
  }

  /**
   * Сбрасывает счетчик reads
   */
  resetReads(): void {
    this.totalReads = 0;
  }

  /**
   * Полный сброс включая reads
   */
  reset(): void {
    super.reset();
    this.resetReads();
  }

  /**
   * Получает детальную статистику
   */
  getStats() {
    return {
      ...super.getStats(),
      totalReads: this.totalReads,
      readLimit: this.readLimit,
      warningThreshold: this.warningThreshold,
      estimatedCost: this.getEstimatedCost(),
      readsRemaining: Math.max(0, this.readLimit - this.totalReads),
      utilizationPercent: (this.totalReads / this.readLimit) * 100,
    };
  }
}

/**
 * Глобальный cost protection breaker
 */
export const costProtectionBreaker = new CostProtectionBreaker({
  readLimit: 5000,
  warningThreshold: 1000,
  failureThreshold: 5,
  timeout: 120000, // 2 минуты
  onWarning: (reads, limit) => {
    console.warn(`⚠️  High Firestore usage: ${reads}/${limit} reads`);
  },
  onOpen: () => {
    console.error('🚨 COST PROTECTION BREAKER OPEN');
    console.error('⚠️  Too many Firestore reads. Please refresh the page.');
  },
});
