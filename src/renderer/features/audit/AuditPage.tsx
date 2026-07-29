import React from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { platform } from '../../platform';
import type { AuditEvent, IntegrityReport } from '@shared/types';
import { PageHeader } from '../../layouts/AppShell';
import { GlassPanel, GlassButton, GlassBadge, GlassSelect, Spinner, EmptyState } from '../../components/glass';
import { fmtDateTime } from '../../lib/format';
import { useAuth, can } from '../../store/auth';

const AUDIT_PAGE_SIZES = [10, 25, 50, 100] as const;

export function AuditPage() {
  const [events, setEvents] = React.useState<AuditEvent[] | null>(null);
  const [report, setReport] = React.useState<IntegrityReport | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState<(typeof AUDIT_PAGE_SIZES)[number]>(10);
  const { user } = useAuth();

  const load = React.useCallback(() => platform().audit.list().then(setEvents), []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    setPage(0);
  }, [pageSize]);

  React.useEffect(() => {
    const nextPageCount = Math.max(Math.ceil((events?.length ?? 0) / pageSize), 1);
    setPage((current) => Math.min(current, nextPageCount - 1));
  }, [events?.length, pageSize]);

  async function verify() {
    setVerifying(true);
    const r = await platform().audit.verifyIntegrity();
    setReport(r);
    await load();
    setVerifying(false);
  }

  if (!events) return <Spinner label="Loading audit trail…" />;

  const ordered = [...events].reverse();
  const pageCount = Math.max(Math.ceil(ordered.length / pageSize), 1);
  const pageStart = page * pageSize;
  const visibleEvents = ordered.slice(pageStart, pageStart + pageSize);

  return (
    <div>
      <PageHeader
        title="Audit Integrity"
        subtitle={`${events.length} recorded events in a hash-linked chain.`}
        actions={
          can(user?.role, 'audit.verify') && (
            <GlassButton variant="primary" loading={verifying} onClick={verify}>
              <ShieldCheck className="h-4 w-4" /> Verify chain integrity
            </GlassButton>
          )
        }
      />

      {report && (
        <GlassPanel className={`mb-4 border ${report.ok ? 'border-emerald-500/40' : 'border-red-500/50'}`}>
          <div className="flex items-center gap-3">
            {report.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-red-400" />}
            <div>
              <p className="font-semibold text-ink">{report.ok ? 'Integrity verified' : 'Integrity check failed'}</p>
              <p className="text-sm text-muted">{report.message}</p>
            </div>
            <span className="ml-auto text-xs text-muted">Checked {fmtDateTime(report.checkedAt)}</span>
          </div>
        </GlassPanel>
      )}

      {ordered.length === 0 ? (
        <GlassPanel><EmptyState title="No audit events yet" icon={<RefreshCw className="h-6 w-6" />} /></GlassPanel>
      ) : (
        <div className="content-surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line bg-[var(--pf-surface)] px-4 py-3">
            <GlassSelect
              className="w-36"
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value) as typeof pageSize)}
            >
              {AUDIT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} per page</option>)}
            </GlassSelect>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(current - 1, 0))}
              className="rounded-lg border border-line p-1.5 text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-ring"
              title="Previous audit page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs font-medium text-muted">
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}
              className="rounded-lg border border-line p-1.5 text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-ring"
              title="Next audit page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--pf-surface-2)]">
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">When (UTC)</th>
                <th className="px-4 py-3">Hash</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((e) => (
                <tr key={e.id} className="border-b border-line/60 hover:bg-[var(--pf-highlight)]">
                  <td className="px-4 py-3 text-muted">{e.seq}</td>
                  <td className="px-4 py-3 text-ink">{e.summary}</td>
                  <td className="px-4 py-3 text-ink/90">{e.actorName}<span className="block text-[11px] text-muted">{e.actorRole}</span></td>
                  <td className="px-4 py-3"><GlassBadge tone="neutral">{e.category}</GlassBadge></td>
                  <td className="px-4 py-3 text-ink/90">{fmtDateTime(e.utc)}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted">{e.hash.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Each event is chained to the previous one with a SHA-256 hash. Editing or deleting any record breaks the
        chain and is detected by verification.
      </p>
    </div>
  );
}
