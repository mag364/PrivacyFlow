import { describe, expect, it } from 'vitest';
import { computeDueDate, slaSnapshot } from './sla';

describe('computeDueDate', () => {
  it('adds calendar days', () => {
    const due = computeDueDate('2025-01-01T00:00:00Z', { periodDays: 30, businessDays: false });
    expect(due.toISOString().slice(0, 10)).toBe('2025-01-31');
  });

  it('adds business days (skips weekends)', () => {
    // 2025-01-01 is a Wednesday; +5 business days => 2025-01-08 (Wed)
    const due = computeDueDate('2025-01-01T00:00:00Z', { periodDays: 5, businessDays: true });
    expect(due.toISOString().slice(0, 10)).toBe('2025-01-08');
  });
});

describe('slaSnapshot', () => {
  const received = '2025-01-01T00:00:00Z';

  it('flags overdue cases', () => {
    const snap = slaSnapshot({ received, currentDue: '2025-01-10T00:00:00Z', paused: false, closed: false, now: new Date('2025-01-15T00:00:00Z') });
    expect(snap.health).toBe('overdue');
    expect(snap.daysRemaining).toBeLessThan(0);
    expect(snap.percentConsumed).toBe(100);
  });

  it('flags due-soon within threshold', () => {
    const snap = slaSnapshot({ received, currentDue: '2025-01-31T00:00:00Z', paused: false, closed: false, now: new Date('2025-01-28T00:00:00Z') });
    expect(snap.health).toBe('due-soon');
  });

  it('reports on-track with time remaining', () => {
    const snap = slaSnapshot({ received, currentDue: '2025-01-31T00:00:00Z', paused: false, closed: false, now: new Date('2025-01-05T00:00:00Z') });
    expect(snap.health).toBe('on-track');
  });

  it('prioritises paused and closed states', () => {
    expect(slaSnapshot({ received, currentDue: '2025-01-05T00:00:00Z', paused: true, closed: false, now: new Date('2025-01-10T00:00:00Z') }).health).toBe('paused');
    expect(slaSnapshot({ received, currentDue: '2025-01-05T00:00:00Z', paused: false, closed: true, now: new Date('2025-01-10T00:00:00Z') }).health).toBe('closed');
  });
});