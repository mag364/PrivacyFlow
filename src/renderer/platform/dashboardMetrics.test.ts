import { describe, expect, it } from 'vitest';
import type { DsrCase } from '@shared/types';
import type { CaseStatus } from '@shared/constants';
import { computeMetrics } from './dashboardMetrics';

function request(receivedDate: string, status: CaseStatus = 'Closed', requestTypes = ['Do Not Sell']): DsrCase {
  return { status, requestTypes, jurisdiction: 'US', sla: { receivedDate } } as DsrCase;
}

const now = new Date(2026, 8, 12, 12);

describe('dashboard monthly request counts', () => {
  it('counts all three closed Do Not Sell requests received this month', () => {
    const metrics = computeMetrics({ cases: [
      request('2026-09-01'), request('2026-09-09'), request('2026-09-10'),
    ], projects: [] }, now);
    expect(metrics.doNotSaleCount).toBe(3);
    expect(metrics.receivedThisMonth).toBe(3);
    expect(metrics.openCases).toBe(0);
  });

  it('uses received month and year, regardless of status or creation date', () => {
    const cases = [
      request('2026-09-01', 'New'),
      { ...request('2026-09-30'), createdAt: '2026-08-31T12:00:00Z' },
      { ...request('2026-08-31', 'New'), createdAt: '2026-09-12T12:00:00Z' },
      request('2026-10-01', 'New'),
      request('2025-09-12', 'New'),
    ];
    const metrics = computeMetrics({ cases, projects: [] }, now);
    expect(metrics.doNotSaleCount).toBe(2);
    expect(metrics.receivedThisMonth).toBe(2);
    expect(metrics.openCases).toBe(4);
  });

  it('applies monthly intake to each request type and counts a multi-type request once per type', () => {
    const types = ['Deletion', 'Unsubscribe', 'Do Not Sell', 'Access', 'Correction'];
    const metrics = computeMetrics({ cases: [
      request('2026-09-09', 'Closed', types),
      request('2026-09-10', 'Email Ron K.', types),
      request('2026-08-31', 'New', types),
    ], projects: [] }, now);
    expect([metrics.deletionCount, metrics.unsubscribeCount, metrics.doNotSaleCount,
      metrics.accessCount, metrics.correctionCount]).toEqual([2, 2, 2, 2, 2]);
    expect(metrics.receivedThisMonth).toBe(2);
  });

  it('returns zero for a new month with no received requests', () => {
    const metrics = computeMetrics({ cases: [request('2026-09-30')], projects: [] }, new Date(2026, 9, 1));
    expect(metrics.doNotSaleCount).toBe(0);
    expect(metrics.receivedThisMonth).toBe(0);
  });
});
