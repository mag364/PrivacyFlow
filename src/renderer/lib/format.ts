import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import type { SlaHealth } from '@shared/sla';

// -----------------------------------------------------------------------------
// Presentation helpers: date formatting and tone mapping for badges.
// -----------------------------------------------------------------------------

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

function safe(value: string): Date | null {
  try {
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function fmtDate(value?: string): string {
  if (!value) return '—';
  const d = safe(value);
  return d ? format(d, 'd MMM yyyy') : '—';
}

export function fmtDateTime(value?: string): string {
  if (!value) return '—';
  const d = safe(value);
  return d ? format(d, 'd MMM yyyy, HH:mm') : '—';
}

export function fmtRelative(value?: string): string {
  if (!value) return '—';
  const d = safe(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '—';
}

export function priorityTone(priority: string): Tone {
  switch (priority) {
    case 'Urgent': return 'danger';
    case 'High': return 'warn';
    case 'Medium': return 'info';
    default: return 'neutral';
  }
}

export function riskTone(risk: string): Tone {
  switch (risk) {
    case 'Critical': return 'danger';
    case 'High': return 'warn';
    case 'Medium': return 'info';
    default: return 'neutral';
  }
}

export function healthTone(health: SlaHealth): Tone {
  switch (health) {
    case 'overdue': return 'danger';
    case 'due-soon': return 'warn';
    case 'paused': return 'info';
    case 'closed': return 'neutral';
    default: return 'success';
  }
}

export function healthLabel(health: SlaHealth): string {
  switch (health) {
    case 'overdue': return 'Overdue';
    case 'due-soon': return 'Due soon';
    case 'paused': return 'Paused';
    case 'closed': return 'Closed';
    default: return 'On track';
  }
}

export function statusTone(status: string): Tone {
  if (status === 'Approved') return 'success';
  if (status === 'Denied') return 'danger';
  if (status === 'Closed') return 'neutral';
  if (status === 'Email Ron K.' || status === 'Follow-up Email Sent' || status === 'Needs Assessment') return 'warn';
  return 'info';
}

export function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}