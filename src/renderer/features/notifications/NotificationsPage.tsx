import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Flame, UserX, BellOff, BellRing } from 'lucide-react';
import { platform } from '../../platform';
import type { DsrCase, OrgSettings } from '@shared/types';
import { OPEN_STATUSES } from '@shared/constants';
import { slaSnapshot } from '@shared/sla';
import { PageHeader } from '../../layouts/AppShell';
import { GlassPanel, GlassBadge, Spinner, EmptyState } from '../../components/glass';
import { fmtDate } from '../../lib/format';

interface Alert {
  id: string;
  caseId: string;
  caseNumber: string;
  tone: 'danger' | 'warn' | 'info';
  icon: React.ReactNode;
  label: string;
  detail: string;
}

function buildAlerts(cases: DsrCase[], settings: OrgSettings): Alert[] {
  const alerts: Alert[] = [];
  const threshold = settings.dueSoonThresholdDays ?? 5;
  const cadence = settings.reminderCadenceDays ?? [];
  const escalation = settings.escalationAlerts !== false;

  for (const c of cases) {
    const open = OPEN_STATUSES.includes(c.status);
    const snap = slaSnapshot({
      received: c.sla.receivedDate, currentDue: c.sla.currentDueDate,
      paused: !!c.sla.currentPauseReason, closed: !open,
      dueSoonThreshold: threshold,
    });
    if (open && snap.health === 'overdue') {
      alerts.push({ id: `${c.id}-od`, caseId: c.id, caseNumber: c.caseNumber, tone: 'danger', icon: <AlertTriangle className="h-4 w-4" />, label: 'Overdue', detail: `Due ${fmtDate(c.sla.currentDueDate)} — ${Math.abs(snap.daysRemaining)} days past.` });
    } else if (open && snap.health === 'due-soon') {
      alerts.push({ id: `${c.id}-ds`, caseId: c.id, caseNumber: c.caseNumber, tone: 'warn', icon: <Clock className="h-4 w-4" />, label: 'Due soon', detail: `Due ${fmtDate(c.sla.currentDueDate)} — ${snap.daysRemaining} days left.` });
    }
    // Reminder-cadence alerts from the Automation tab.
    if (open && !c.sla.currentPauseReason && snap.daysRemaining >= 0 && cadence.includes(snap.daysRemaining)) {
      alerts.push({ id: `${c.id}-rc`, caseId: c.id, caseNumber: c.caseNumber, tone: 'info', icon: <BellRing className="h-4 w-4" />, label: 'Reminder', detail: `${snap.daysRemaining} day${snap.daysRemaining === 1 ? '' : 's'} until due — matches your reminder cadence.` });
    }
    if (escalation && open && (c.risk === 'High' || c.risk === 'Critical')) {
      alerts.push({ id: `${c.id}-hr`, caseId: c.id, caseNumber: c.caseNumber, tone: 'danger', icon: <Flame className="h-4 w-4" />, label: `${c.risk} risk`, detail: 'Requires senior review.' });
    }
    if (open && !c.ownerId) {
      alerts.push({ id: `${c.id}-ua`, caseId: c.id, caseNumber: c.caseNumber, tone: 'warn', icon: <UserX className="h-4 w-4" />, label: 'Unassigned', detail: 'No owner assigned yet.' });
    }
  }
  const order = { danger: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.tone] - order[b.tone]);
}

export function NotificationsPage() {
  const [cases, setCases] = React.useState<DsrCase[] | null>(null);
  const [settings, setSettings] = React.useState<OrgSettings | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    platform().cases.list().then(setCases);
    platform().system.settings().then(setSettings);
  }, []);

  if (!cases || !settings) return <Spinner label="Checking for alerts…" />;

  const alerts = buildAlerts(cases, settings);

  return (
    <div>
      <PageHeader title="Notifications" subtitle={`${alerts.length} active alert${alerts.length === 1 ? '' : 's'} require attention.`} />
      {alerts.length === 0 ? (
        <GlassPanel><EmptyState title="All clear" description="No overdue, at-risk, or unassigned requests right now." icon={<BellOff className="h-6 w-6" />} /></GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate(`/cases/${a.caseId}`)}
              className="content-surface flex items-center gap-4 px-4 py-3 text-left transition-all hover:bg-[var(--pf-highlight)] focus-ring"
            >
              <div className={`grid h-9 w-9 place-items-center rounded-xl bg-[var(--pf-highlight)] ${a.tone === 'danger' ? 'text-red-400' : a.tone === 'warn' ? 'text-amber-400' : 'text-accent'}`}>
                {a.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">{a.caseNumber} · {a.label}</p>
                <p className="text-xs text-muted">{a.detail}</p>
              </div>
              <GlassBadge tone={a.tone}>{a.label}</GlassBadge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}