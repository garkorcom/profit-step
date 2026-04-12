/**
 * Unit tests for telegramBridge.ts — Phase 10b
 *
 * Tests message formatting for event notifications.
 */
import { formatEventForTelegram } from '../src/agent/utils/telegramBridge';

describe('telegramBridge', () => {
  describe('formatEventForTelegram', () => {
    test('task assigned event', () => {
      const msg = formatEventForTelegram({
        type: 'task',
        action: 'assigned',
        entityId: 't1',
        entityType: 'gtd_task',
        summary: 'Task "Fix wiring" assigned to Vasya',
        data: { priority: 'high' },
        employeeId: 'uid1',
      });

      expect(msg).toContain('📋');
      expect(msg).toContain('<b>Assigned</b>');
      expect(msg).toContain('gtd task');
      expect(msg).toContain('Fix wiring');
      expect(msg).toContain('Priority: high');
    });

    test('session started event', () => {
      const msg = formatEventForTelegram({
        type: 'session',
        action: 'started',
        entityId: 's1',
        entityType: 'work_session',
        summary: 'Work session started for Jim Dvorkin',
        data: { clientName: 'Jim Dvorkin' },
        employeeId: 'uid2',
      });

      expect(msg).toContain('⏱️');
      expect(msg).toContain('<b>Started</b>');
      expect(msg).toContain('Client: Jim Dvorkin');
    });

    test('cost created event', () => {
      const msg = formatEventForTelegram({
        type: 'cost',
        action: 'created',
        entityId: 'c1',
        entityType: 'cost',
        summary: 'New cost: $150.00 materials',
        data: { amount: 150 },
        employeeId: 'uid3',
      });

      expect(msg).toContain('💰');
      expect(msg).toContain('<b>New</b>');
      expect(msg).toContain('$150');
    });

    test('alert event with no extra data', () => {
      const msg = formatEventForTelegram({
        type: 'alert',
        action: 'budget_warning',
        entityId: 'a1',
        entityType: 'alert',
        summary: 'Budget threshold 80% reached for Project A',
      });

      expect(msg).toContain('🚨');
      expect(msg).toContain('budget_warning'); // falls back to raw action
      expect(msg).toContain('Budget threshold');
    });

    test('unknown event type uses default emoji', () => {
      const msg = formatEventForTelegram({
        type: 'alert',
        action: 'unknown_action',
        entityId: 'x1',
        entityType: 'some_entity',
        summary: 'Something happened',
      });

      expect(msg).toContain('🚨'); // alert type
      expect(msg).toContain('unknown_action');
      expect(msg).toContain('some entity'); // underscores replaced
    });

    test('event with duration data', () => {
      const msg = formatEventForTelegram({
        type: 'session',
        action: 'stopped',
        entityId: 's2',
        entityType: 'work_session',
        summary: 'Session stopped',
        data: { durationMinutes: 45 },
        employeeId: 'uid1',
      });

      expect(msg).toContain('Duration: 45min');
    });
  });
});
