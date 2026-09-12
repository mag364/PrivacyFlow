import { isSameMonth, parseISO } from 'date-fns';
import { OPEN_STATUSES } from '@shared/constants';
import type { Db } from './seed';
import type { DashboardMetrics, NameValue } from './types';

export function computeMetrics(d: Pick<Db, 'cases' | 'projects'>, now = new Date()): DashboardMetrics {
  const open = d.cases.filter((c) => OPEN_STATUSES.includes(c.status));

  const closed = d.cases.filter((c) => !OPEN_STATUSES.includes(c.status));
  const completedThisMonth = closed.filter(
    (c) => c.sla.closureDate && isSameMonth(parseISO(c.sla.closureDate), now),
  ).length;

  const tally = (items: string[]): NameValue[] => {
    const m = new Map<string, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  // Monthly intake includes requests that have since been closed.
  const received = d.cases.filter(
    (c) => isSameMonth(parseISO(c.sla.receivedDate), now),
  );
  const receivedWithType = (type: string) =>
    received.filter((c) => c.requestTypes.map(String).includes(type)).length;
  const projectClosedStatuses = new Set(['Approved', 'Denied', 'Closed']);
  const projectDateThisMonth = (value?: string) => {
    if (!value) return false;
    try {
      return isSameMonth(parseISO(value), now);
    } catch {
      return false;
    }
  };

  return {
    openCases: open.length,
    newCases: d.cases.filter((c) => c.status === 'New').length,
    completedThisMonth,
    byType: tally(d.cases.flatMap((c) => c.requestTypes.map(String))),
    byJurisdiction: tally(d.cases.map((c) => String(c.jurisdiction))),
    byStatus: tally(d.cases.map((c) => c.status)),
    accessCount: receivedWithType('Access'),
    deletionCount: receivedWithType('Deletion'),
    correctionCount: receivedWithType('Correction'),
    unsubscribeCount: receivedWithType('Unsubscribe'),
    doNotSaleCount: receivedWithType('Do Not Sell'),
    receivedThisMonth: received.length,
    closedThisMonth: completedThisMonth,
    totalProjects: d.projects.length,
    activeProjects: d.projects.filter((p) => !projectClosedStatuses.has(p.status)).length,
    projectsThisMonth: d.projects.filter((p) => projectDateThisMonth(p.dateNotificationReceived ?? p.createdAt)).length,
    closedProjectsThisMonth: d.projects.filter((p) => projectClosedStatuses.has(p.status) && projectDateThisMonth(p.createdAt)).length,
  };
}

