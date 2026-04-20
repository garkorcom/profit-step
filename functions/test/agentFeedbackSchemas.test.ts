/**
 * Tests for Agent Feedback Schemas — bug reports, improvements, TZ
 */
import {
  CreateAgentFeedbackSchema,
  UpdateAgentFeedbackSchema,
  ListAgentFeedbackQuerySchema,
  FEEDBACK_TYPES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
} from '../src/agent/schemas/agentFeedbackSchemas';

describe('Agent Feedback Schemas', () => {

  // ── Constants ───────────────────────────────────────────────────

  describe('constants', () => {
    it('defines 4 feedback types', () => {
      expect(FEEDBACK_TYPES).toEqual(['bug', 'improvement', 'feature_request', 'performance']);
    });

    it('defines 4 severity levels', () => {
      expect(FEEDBACK_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
    });

    it('defines 5 statuses', () => {
      expect(FEEDBACK_STATUSES).toEqual(['open', 'in_review', 'resolved', 'wontfix', 'duplicate']);
    });
  });

  // ── CreateAgentFeedbackSchema ───────────────────────────────────

  describe('CreateAgentFeedbackSchema', () => {
    it('accepts minimal valid feedback (bug)', () => {
      const result = CreateAgentFeedbackSchema.parse({
        type: 'bug',
        title: 'Something is broken',
      });
      expect(result.type).toBe('bug');
      expect(result.title).toBe('Something is broken');
      expect(result.severity).toBe('medium'); // default
    });

    it('accepts full feedback with all fields', () => {
      const result = CreateAgentFeedbackSchema.parse({
        type: 'improvement',
        title: 'Inventory API should support batch operations',
        description: 'Currently need to call N times for N items',
        severity: 'low',
        endpoint: 'POST /api/inventory/v2/transactions',
        errorMessage: 'N/A — not an error',
        errorCode: 'N/A',
        stepsToReproduce: ['Call endpoint 100 times', 'Observe slow performance'],
        expectedBehavior: 'Single batch call',
        actualBehavior: '100 individual calls required',
        agentVersion: '0.2.0',
        metadata: { itemCount: 100, avgLatency: 250 },
        idempotencyKey: 'feedback-2026-04-12-001',
      });
      expect(result.type).toBe('improvement');
      expect(result.severity).toBe('low');
      expect(result.stepsToReproduce).toHaveLength(2);
      expect(result.metadata).toEqual({ itemCount: 100, avgLatency: 250 });
    });

    it('accepts all feedback types', () => {
      for (const type of FEEDBACK_TYPES) {
        const result = CreateAgentFeedbackSchema.parse({ type, title: `Test ${type}` });
        expect(result.type).toBe(type);
      }
    });

    it('accepts all severity levels', () => {
      for (const sev of FEEDBACK_SEVERITIES) {
        const result = CreateAgentFeedbackSchema.parse({
          type: 'bug', title: 'Test', severity: sev,
        });
        expect(result.severity).toBe(sev);
      }
    });

    it('rejects empty title', () => {
      expect(() => CreateAgentFeedbackSchema.parse({
        type: 'bug', title: '',
      })).toThrow();
    });

    it('rejects title shorter than 3 chars', () => {
      expect(() => CreateAgentFeedbackSchema.parse({
        type: 'bug', title: 'ab',
      })).toThrow();
    });

    it('rejects invalid type', () => {
      expect(() => CreateAgentFeedbackSchema.parse({
        type: 'question', title: 'Test',
      })).toThrow();
    });

    it('rejects invalid severity', () => {
      expect(() => CreateAgentFeedbackSchema.parse({
        type: 'bug', title: 'Test', severity: 'urgent',
      })).toThrow();
    });

    it('rejects too many steps to reproduce (>10)', () => {
      const steps = Array.from({ length: 11 }, (_, i) => `Step ${i + 1}`);
      expect(() => CreateAgentFeedbackSchema.parse({
        type: 'bug', title: 'Test', stepsToReproduce: steps,
      })).toThrow();
    });

    it('defaults severity to medium when not provided', () => {
      const result = CreateAgentFeedbackSchema.parse({ type: 'bug', title: 'Test bug' });
      expect(result.severity).toBe('medium');
    });
  });

  // ── UpdateAgentFeedbackSchema ───────────────────────────────────

  describe('UpdateAgentFeedbackSchema', () => {
    it('accepts status update', () => {
      const result = UpdateAgentFeedbackSchema.parse({ status: 'in_review' });
      expect(result.status).toBe('in_review');
    });

    it('accepts all valid statuses', () => {
      for (const status of FEEDBACK_STATUSES) {
        const result = UpdateAgentFeedbackSchema.parse({ status });
        expect(result.status).toBe(status);
      }
    });

    it('accepts assignedTo update', () => {
      const result = UpdateAgentFeedbackSchema.parse({ assignedTo: 'dev-uid-123' });
      expect(result.assignedTo).toBe('dev-uid-123');
    });

    it('accepts linkedTaskId', () => {
      const result = UpdateAgentFeedbackSchema.parse({ linkedTaskId: 'task_abc' });
      expect(result.linkedTaskId).toBe('task_abc');
    });

    it('accepts resolution text', () => {
      const result = UpdateAgentFeedbackSchema.parse({
        status: 'resolved',
        resolution: 'Fixed in commit abc123',
      });
      expect(result.resolution).toBe('Fixed in commit abc123');
    });

    it('rejects empty update (no fields)', () => {
      expect(() => UpdateAgentFeedbackSchema.parse({})).toThrow();
    });

    it('rejects invalid status', () => {
      expect(() => UpdateAgentFeedbackSchema.parse({ status: 'closed' })).toThrow();
    });
  });

  // ── ListAgentFeedbackQuerySchema ────────────────────────────────

  describe('ListAgentFeedbackQuerySchema', () => {
    it('accepts empty query (all defaults)', () => {
      const result = ListAgentFeedbackQuerySchema.parse({});
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('accepts type filter', () => {
      const result = ListAgentFeedbackQuerySchema.parse({ type: 'bug' });
      expect(result.type).toBe('bug');
    });

    it('accepts severity filter', () => {
      const result = ListAgentFeedbackQuerySchema.parse({ severity: 'critical' });
      expect(result.severity).toBe('critical');
    });

    it('accepts status filter', () => {
      const result = ListAgentFeedbackQuerySchema.parse({ status: 'open' });
      expect(result.status).toBe('open');
    });

    it('accepts pagination params', () => {
      const result = ListAgentFeedbackQuerySchema.parse({ limit: '50', offset: '10' });
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(10);
    });

    it('defaults limit to 20', () => {
      const result = ListAgentFeedbackQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });

    it('rejects limit > 100', () => {
      expect(() => ListAgentFeedbackQuerySchema.parse({ limit: '200' })).toThrow();
    });
  });
});
