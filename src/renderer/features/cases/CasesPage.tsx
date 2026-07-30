import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Plus, Download, FolderKanban, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { platform } from '../../platform';
import type { DsrCase } from '@shared/types';
import { CASE_STATUSES, OPEN_STATUSES, REQUEST_TYPES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassBadge, Spinner, EmptyState } from '../../components/glass';
import { fmtDate, fmtDateTime, statusTone } from '../../lib/format';
import { readLastYear, writeLastYear, clearLastYear } from '../../lib/lastYear';
import { useAuth, can } from '../../store/auth';

type StatusFilter = 'all' | 'open' | 'closed' | string;
const PAGE_SIZE = 15;
const FILTERS_KEY = 'privacyflow.requests.filters.v1';

function readFilters(): { q: string; status: StatusFilter; type: string; page: number } {
  try {
    return { q: '', status: 'all', type: 'all', page: 0, ...JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') };
  } catch {
    return { q: '', status: 'all', type: 'all', page: 0 };
  }
}

export function CasesPage() {
  const { year: yearParam } = useParams();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [cases, setCases] = React.useState<DsrCase[] | null>(null);
  const savedFilters = React.useMemo(readFilters, []);
  const [q, setQ] = React.useState(savedFilters.q);
  const [status, setStatus] = React.useState<StatusFilter>(savedFilters.status);
  const [type, setType] = React.useState<string>(savedFilters.type);
  const [page, setPage] = React.useState(savedFilters.page);
  const didInitFilters = React.useRef(false);
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

  React.useEffect(() => {
    if (!didInitFilters.current) {
      didInitFilters.current = true;
      return;
    }
    setPage(0);
  }, [year, q, status, type]);

  React.useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ q, status, type, page }));
  }, [q, status, type, page]);

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
  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  function showAllYears() {
    clearLastYear('cases');
    navigate('/cases');
  }

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const header = [
      'Request ID', 'Status', 'DSRREQ #', 'Request Types', 'Intake Channel',
      'Team', 'Business Unit', 'Description',
      'Requester Last Name', 'Requester Emails',
      'Relationship', 'Minor', 'Authorized Agent',
      'Client Center Status', 'Emailed FA',
      'Date Received',
      "Date Client Svcs. Rec'd Email", "Date DPP Rec'd Email from Client Svcs.",
      'Standard Response Sent', 'Forwarded Email to Ron K.', 'Follow-up Email Sent',
      'Created At', 'Updated At', 'Last Activity',
    ];

    const lines = rows.map((c) => [
      c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? '',
      c.status,
      c.caseNumber,
      c.requestTypes.join('; '),
      c.intakeChannel,
      c.team,
      c.businessUnit,
      c.description,
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

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <GlassInput className="pl-9" placeholder="Search request number, name, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <GlassSelect value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="open">Open requests</option>
            <option value="closed">Closed requests</option>
            {CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </GlassSelect>
          <GlassSelect value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </GlassSelect>
        </div>
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
                <th className="px-4 py-3">Request ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">DSRREQ #</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Types</th>
                <th className="px-4 py-3">Date Received</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => {
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
                    <td className="px-4 py-3 font-medium text-accent">{requestId}</td>
                    <td className="px-4 py-3"><GlassBadge tone={statusTone(c.status)}>{c.status}</GlassBadge></td>
                    <td className="px-4 py-3 text-ink/90">{c.caseNumber}</td>
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
      {rows.length > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            Showing {pageStart + 1}-{Math.min(pageStart + pageRows.length, rows.length)} of {rows.length} requests
          </span>
          <div className="flex items-center gap-2">
            <GlassButton
              className="px-3 py-1.5"
              disabled={currentPage === 0}
              onClick={() => setPage(0)}
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </GlassButton>
            <GlassButton
              className="px-3 py-1.5"
              disabled={currentPage === 0}
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </GlassButton>
            <span className="rounded-capsule border border-line bg-[var(--pf-surface)] px-3 py-1.5 text-xs text-ink">
              Page {currentPage + 1} of {pageCount}
            </span>
            <GlassButton
              className="px-3 py-1.5"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </GlassButton>
            <GlassButton
              className="px-3 py-1.5"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </GlassButton>
          </div>
        </div>
      )}
    </div>
  );
}
