import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Plus, Download, FolderKanban, CalendarDays } from 'lucide-react';
import { platform } from '../../platform';
import type { DsrCase } from '@shared/types';
import { CASE_STATUSES, OPEN_STATUSES, REQUEST_TYPES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassBadge, Spinner, EmptyState } from '../../components/glass';
import { fmtDate, fmtDateTime, statusTone } from '../../lib/format';
import { readLastYear, writeLastYear, clearLastYear } from '../../lib/lastYear';
import { useAuth, can } from '../../store/auth';

type StatusFilter = 'all' | 'open' | 'closed' | string;

export function CasesPage() {
  const { year: yearParam } = useParams();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [cases, setCases] = React.useState<DsrCase[] | null>(null);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('open');
  const [type, setType] = React.useState<string>('all');
  const navigate = useNavigate();
  const { user } = useAuth();

  React.useEffect(() => {
    if (year) {
      writeLastYear('cases', year);
    } else {
      const remembered = readLastYear('cases');
      if (remembered) navigate(`/cases/year/${remembered}`, { replace: true });
    }
  }, [year, navigate]);

  React.useEffect(() => {
    platform().cases.list().then(setCases);
  }, [year]);
  if (!cases) return <Spinner label="Loading requests…" />;

  const yearCases = year
    ? cases.filter((c) => new Date(c.sla.receivedDate).getFullYear() === year)
    : cases;

  let rows = yearCases.filter((c) => {
    if (status === 'open' && !OPEN_STATUSES.includes(c.status)) return false;
    if (status === 'closed' && OPEN_STATUSES.includes(c.status)) return false;
    if (status !== 'all' && status !== 'open' && status !== 'closed' && c.status !== status) return false;
    if (type !== 'all' && !c.requestTypes.map(String).includes(type)) return false;
    if (q) {
      const requestId = c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? c.subject.firstName ?? '';
      const hay = `${c.caseNumber} ${requestId} ${c.subject.lastName} ${c.subject.emails.join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  rows = [...rows].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  function showAllYears() {
    clearLastYear('cases');
    navigate('/cases');
  }

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const header = [
      'Request', 'Status', 'Request Types', 'Intake Channel',
      'Team', 'Business Unit', 'Description',
      'Request ID', 'Requester Last Name', 'Requester Emails',
      'Relationship', 'Minor', 'Authorized Agent',
      'Client Center Status', 'Emailed FA',
      'Date Received',
      "Date Client Svcs. Rec'd Email", "Date DPP Rec'd Email from Client Svcs.",
      'Standard Response Sent', 'Forwarded Email to Ron K.', 'Follow-up Email Sent',
      'Created At', 'Updated At', 'Last Activity',
    ];

    const lines = rows.map((c) => [
      c.caseNumber,
      c.status,
      c.requestTypes.join('; '),
      c.intakeChannel,
      c.team,
      c.businessUnit,
      c.description,
      c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? '',
      c.subject.lastName,
      c.subject.emails.join('; '),
      c.subject.relationship,
      c.subject.minor ? 'Yes' : 'No',
      c.subject.authorizedAgent ? 'Yes' : 'No',
      c.subject.clientCenterStatus,
      fmtDate(c.subject.emailedFA),
      fmtDate(c.sla.receivedDate),
      fmtDate(c.intakeDates?.dateClientServiceReceivedEmail),
      fmtDate(c.intakeDates?.dateDppReceivedEmail),
      fmtDate(c.intakeDates?.standardResponseSent),
      fmtDate(c.intakeDates?.forwardedEmailToRon),
      fmtDate(c.intakeDates?.followUpEmailSent),
      fmtDateTime(c.createdAt),
      fmtDateTime(c.updatedAt),
      fmtDateTime(c.lastActivityAt),
    ]);

    const csv = [header, ...lines].map((r) => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = year ? `privacyflow-requests-${year}.csv` : 'privacyflow-requests.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title={year ? `Requests — ${year}` : 'Requests'}
        subtitle={`${rows.length} request${rows.length === 1 ? '' : 's'} shown${year ? ` received in ${year}` : ''}.`}
        actions={
          <>
            {year && (
              <GlassButton onClick={showAllYears}>
                <CalendarDays className="h-4 w-4" /> Show all years
              </GlassButton>
            )}
            <GlassButton onClick={exportCsv}><Download className="h-4 w-4" /> Export</GlassButton>
            {can(user?.role, 'requests.create') && (
              <GlassButton variant="primary" onClick={() => navigate('/cases/new')}>
                <Plus className="h-4 w-4" /> New request
              </GlassButton>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <GlassInput className="pl-9" placeholder="Search request number, name, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <GlassSelect className="w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open requests</option>
          <option value="closed">Closed requests</option>
          <option value="all">All statuses</option>
          {CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </GlassSelect>
        <GlassSelect className="w-44" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </GlassSelect>
      </div>

      <div className="content-surface overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title={year ? `No requests in ${year}` : 'No matching requests'}
            description={year
              ? 'No requests were received in this year yet. New requests appear here automatically based on their received date.'
              : 'Adjust your filters or create a new request.'}
            icon={year ? <CalendarDays className="h-6 w-6" /> : <FolderKanban className="h-6 w-6" />}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--pf-surface-2)]">
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Request ID</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Types</th>
                <th className="px-4 py-3">Date Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const requestId =
                  c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ??
                  c.subject.firstName ??
                  '—';
                const dateReceived = c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate;
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="cursor-pointer border-b border-line/60 hover:bg-[var(--pf-highlight)]"
                  >
                    <td className="px-4 py-3 font-medium text-accent">{c.caseNumber}</td>
                    <td className="px-4 py-3"><GlassBadge tone={statusTone(c.status)}>{c.status}</GlassBadge></td>
                    <td className="px-4 py-3 text-ink/90">{requestId}</td>
                    <td className="px-4 py-3 text-ink">{c.subject.lastName}</td>
                    <td className="px-4 py-3 text-muted">{c.requestTypes.join(', ')}</td>
                    <td className="px-4 py-3 text-ink/90">{fmtDate(dateReceived)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
