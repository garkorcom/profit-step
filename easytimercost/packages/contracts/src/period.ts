export interface Period {
  readonly start: Date;
  readonly end: Date;
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'ytd' | 'custom';
