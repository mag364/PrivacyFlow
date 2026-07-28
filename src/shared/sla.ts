import { addBusinessDays, addDays, differenceInCalendarDays, parseISO } from 'date-fns';

// -----------------------------------------------------------------------------
// Statutory SLA calculation. Pure functions — fully unit tested (see sla.test).
// -----------------------------------------------------------------------------

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

export function computeDueDate(
  received: string | Date,
  opts: { periodDays: number; businessDays: boolean },
): Date {
  const start = toDate(received);
  return opts.businessDays ? addBusinessDays(start, opts.periodDays) : addDays(start, opts.periodDays);
}

export type SlaHealth = 'on-track' | 'due-soon' | 'overdue' | 'paused' | 'closed';

export interface SlaSnapshot {
  daysRemaining: number;
  percentConsumed: number;
  health: SlaHealth;
}

export function slaSnapshot(input: {
  received: string | Date;
  currentDue: string | Date;
  paused: boolean;
  closed: boolean;
  now?: Date;
  dueSoonThreshold?: number;
}): SlaSnapshot {
  const now = input.now ?? new Date();
  const received = toDate(input.received);
  const due = toDate(input.currentDue);
  const threshold = input.dueSoonThreshold ?? 5;

  const daysRemaining = differenceInCalendarDays(due, now);
  const total = Math.max(1, differenceInCalendarDays(due, received));
  const elapsed = differenceInCalendarDays(now, received);
  const percentConsumed = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));

  let health: SlaHealth;
  if (input.closed) health = 'closed';
  else if (input.paused) health = 'paused';
  else if (daysRemaining < 0) health = 'overdue';
  else if (daysRemaining <= threshold) health = 'due-soon';
  else health = 'on-track';

  return { daysRemaining, percentConsumed, health };
}