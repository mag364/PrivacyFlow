import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, Trash2, BellOff, Ban, Inbox, CheckCircle2, Plus, FolderPlus, ClipboardList, Activity,
} from 'lucide-react';
import { platform } from '../../platform';
import type { AuditEvent, DsrCase, Project } from '@shared/types';
import type { DashboardMetrics } from '../../platform/types';
import { PageHeader } from '../../layouts/AppShell';
import { GlassCard, GlassPanel, GlassBadge, GlassButton, Spinner, EmptyState } from '../../components/glass';
import { fmtDate, statusTone } from '../../lib/format';
import { useAuth, can } from '../../store/auth';

function Metric({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: 'neutral' | 'info' | 'success' | 'warn' | 'danger';
}) {
  const toneText: Record<string, string> = {
    neutral: 'text-ink', info: 'text-accent', success: 'text-emerald-400',
    warn: 'text-amber-400', danger: 'text-red-400',
  };
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <div className={`grid h-9 w-9 place-items-center rounded-xl bg-[var(--pf-highlight)] ${toneText[tone]}`}>
          {icon}
        </div>
      </div>
      <p className={`mt-3 text-2xl font-bold ${toneText[tone]}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </GlassCard>
  );
}

export function DashboardPage() {
  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null);
  const [cases, setCases] = React.useState<DsrCase[] | null>(null);
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [audit, setAudit] = React.useState<AuditEvent[] | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  React.useEffect(() => {
    platform().dashboard.metrics().then(setMetrics);
    platform().cases.list().then(setCases);
    platform().projects.list().then(setProjects);
    platform().audit.list().then(setAudit);
  }, []);

  if (!metrics || !cases || !projects || !audit) return <Spinner label="Loading dashboard…" />;

  const recent = [...cases]
    .sort((a, b) => b.sla.receivedDate.localeCompare(a.sla.receivedDate))
    .slice(0, 5);

  const recentProjects = [...projects]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentActivity = [...audit]
    .sort((a, b) => b.utc.localeCompare(a.utc))
    .slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview of your data subject requests."
        actions={
          can(user?.role, 'requests.create') && (
            <>
              <GlassButton onClick={() => navigate('/projects/new')}>
                <FolderPlus className="h-4 w-4" /> Add Project
              </GlassButton>
              <GlassButton variant="primary" onClick={() => navigate('/cases/new')}>
                <Plus className="h-4 w-4" /> New request
              </GlassButton>
            </>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric icon={<FolderOpen className="h-4 w-4" />} label="Open requests" value={metrics.openCases} tone="info" />
        <Metric icon={<Trash2 className="h-4 w-4" />} label="Deletions" value={metrics.deletionCount} tone="danger" />
        <Metric icon={<BellOff className="h-4 w-4" />} label="Unsubscribe" value={metrics.unsubscribeCount} tone="warn" />
        <Metric icon={<Ban className="h-4 w-4" />} label="Do Not Sell" value={metrics.doNotSaleCount} tone="danger" />
        <Metric icon={<FolderPlus className="h-4 w-4" />} label="Total projects" value={metrics.totalProjects} tone="info" />
        <Metric icon={<ClipboardList className="h-4 w-4" />} label="Active projects" value={metrics.activeProjects} tone="warn" />
        <Metric icon={<Inbox className="h-4 w-4" />} label="Projects this month" value={metrics.projectsThisMonth} tone="info" />
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Closed projects this month" value={metrics.closedProjectsThisMonth} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Recent Request</h3>
            <button className="text-xs text-accent focus-ring" onClick={() => navigate('/cases')}>View all requests</button>
          </div>
          {recent.length === 0 ? (
            <EmptyState title="No requests yet" description="Logged requests will appear here." icon={<Inbox className="h-6 w-6" />} />
          ) : (
            <div className="flex max-h-[242px] flex-col gap-2 overflow-y-auto pr-1">
              {recent.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/cases/${c.id}`)}
                  className="flex items-center gap-4 rounded-xl border border-line px-4 py-3 text-left transition-all hover:bg-[var(--pf-highlight)] focus-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {c.caseNumber} · {c.subject.lastName}
                    </p>
                    <p className="truncate text-xs text-muted">{c.requestTypes.join(', ')}</p>
                  </div>
                  <p className="text-[11px] text-muted">{fmtDate(c.sla.receivedDate)}</p>
                </button>
              ))}
            </div>
          )}
        </GlassPanel>

        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Recent Project</h3>
            <button className="text-xs text-accent focus-ring" onClick={() => navigate('/tasks')}>View all projects</button>
          </div>
          {recentProjects.length === 0 ? (
            <EmptyState title="No projects yet" description="Logged projects will appear here." icon={<FolderPlus className="h-6 w-6" />} />
          ) : (
            <div className="flex max-h-[242px] flex-col gap-2 overflow-y-auto pr-1">
              {recentProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="flex items-center gap-4 rounded-xl border border-line px-4 py-3 text-left transition-all hover:bg-[var(--pf-highlight)] focus-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {p.projectNumber} · {p.projectName}
                    </p>
                    <p className="truncate text-xs text-muted">{p.source}{p.investmentClass ? ` · ${p.investmentClass}` : ''}</p>
                  </div>
                  <p className="text-[11px] text-muted">
                    {p.notificationCancelled ? 'Cancelled' : fmtDate(p.dateNotificationReceived)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="mt-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Recent activity</h3>
        <div className="flex max-h-[210px] flex-col gap-1.5 overflow-y-auto pr-1">
          {recentActivity.map((event) => (
            <div key={event.id} className="flex items-center gap-3 py-1.5 text-sm">
              <GlassBadge tone="neutral">{event.category}</GlassBadge>
              <Activity className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-muted">{event.summary}</span>
              <span className="shrink-0 text-[11px] text-muted">{fmtDate(event.utc)}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
