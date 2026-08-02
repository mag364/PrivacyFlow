import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search, Plus, Download, FolderKanban, CalendarDays, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Layers,
} from 'lucide-react';
import { platform } from '../../platform';
import type { CaseLink, DsrCase } from '@shared/types';
import { CASE_STATUSES, OPEN_STATUSES, REQUEST_TYPES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassBadge, Spinner, EmptyState } from '../../components/glass';
import { fmtDate, fmtDateTime, statusTone } from '../../lib/format';
import { requestIdForCase } from '@shared/placeholders';
import { readLastYear, writeLastYear, clearLastYear } from '../../lib/lastYear';
import { useAuth, can } from '../../store/auth';

type StatusFilter = 'all' | 'open' | 'closed' | string;
const PAGE_SIZE = 15;
const FILTERS_KEY = 'privacyflow.requests.filters.v1';
const COLLAPSED_DEFAULT = true;

interface RequestGroup {
  key: string;
  children: DsrCase[];
}

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
  const [caseLinks, setCaseLinks] = React.useState<CaseLink[]>([]);
  const savedFilters = React.useMemo(readFilters, []);
  const [q, setQ] = React.useState(savedFilters.q);
  const [status, setStatus] = React.useState<StatusFilter>(savedFilters.status);
  const [type, setType] = React.useState<string>(savedFilters.type);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
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
    Promise.all([platform().cases.list(), platform().cases.links()])
      .then(([caseRows, links]) => {
        setCases(caseRows);
        setCaseLinks(links);
      });
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

  const rowById = new Map(rows.map((caseItem) => [caseItem.id, caseItem]));
  const adjacency = new Map<string, Set<string>>();
  for (const caseItem of rows) adjacency.set(caseItem.id, new Set());
  for (const link of caseLinks) {
    if (!rowById.has(link.caseId) || !rowById.has(link.relatedCaseId)) continue;
    adjacency.get(link.caseId)?.add(link.relatedCaseId);
    adjacency.get(link.relatedCaseId)?.add(link.caseId);
  }

  const visited = new Set<string>();
  const groups: RequestGroup[] = [];
  for (const caseItem of rows) {
    if (visited.has(caseItem.id)) continue;
    const stack = [caseItem.id];
    const children: DsrCase[] = [];
    visited.add(caseItem.id);
    while (stack.length) {
      const currentId = stack.pop()!;
      const current = rowById.get(currentId);
      if (current) children.push(current);
      for (const nextId of adjacency.get(currentId) ?? []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        stack.push(nextId);
      }
    }
    children.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    groups.push({ key: children.map((child) => child.id).sort().join(':'), children });
  }
  groups.sort((a, b) => b.children[0].lastActivityAt.localeCompare(a.children[0].lastActivityAt));

  const groupedCount = groups.filter((g) => g.children.length > 1).length;
  const pageCount = Math.max(Math.ceil(groups.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageGroups = groups.slice(pageStart, pageStart + PAGE_SIZE);

  function requestId(c: DsrCase): string {
    return requestIdForCase(c) || '—';
  }

  function receivedDate(c: DsrCase): string {
    return c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate;
  }

  function isGroupCollapsed(key: string): boolean {
    return collapsed[key] ?? COLLAPSED_DEFAULT;
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? COLLAPSED_DEFAULT) }));
  }

  function parentStatuses(g: RequestGroup): string {
    const distinct = Array.from(new Set(g.children.map((c) => c.status)));
    return distinct.length === 1 ? distinct[0] : 'Grouped';
  }

  function parentRequestIds(g: RequestGroup): string {
    return `${g.children.length} linked`;
  }

  function parentTypes(g: RequestGroup): string {
    return Array.from(new Set(g.children.flatMap((c) => c.requestTypes.map(String)))).join(', ');
  }

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
        subtitle={`${rows.length} request${rows.length === 1 ? '' : 's'} shown${year ? ` received in ${year}` : ''}${groupedCount ? ` · ${groupedCount} related group${groupedCount === 1 ? '' : 's'}` : ''}.`}
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
              {pageGroups.map((g) => {
                if (g.children.length === 1) {
                  const c = g.children[0];
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/cases/${c.id}`)}
                      className="cursor-pointer border-b border-line/60 hover:bg-[var(--pf-highlight)]"
                    >
                      <td className="px-4 py-3 font-medium text-accent">{requestId(c)}</td>
                      <td className="px-4 py-3"><GlassBadge tone={statusTone(c.status)}>{c.status}</GlassBadge></td>
                      <td className="px-4 py-3 text-ink/90">{c.caseNumber}</td>
                      <td className="px-4 py-3 text-ink">{c.subject.lastName}</td>
                      <td className="px-4 py-3 text-muted">{c.requestTypes.join(', ')}</td>
                      <td className="px-4 py-3 text-ink/90">{fmtDate(receivedDate(c))}</td>
                    </tr>
                  );
                }

                const parent = g.children[0];
                const isCollapsed = isGroupCollapsed(g.key);
                const statusLabel = parentStatuses(g);
                return (
                  <React.Fragment key={g.key}>
                    <tr
                      onClick={() => toggleGroup(g.key)}
                      className="cursor-pointer border-b border-line/60 bg-[var(--pf-highlight)]/50 hover:bg-[var(--pf-highlight)]"
                      aria-expanded={!isCollapsed}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-medium text-accent">
                          <ChevronRight className={`h-3.5 w-3.5 text-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                          <Layers className="h-3.5 w-3.5" />
                          {parentRequestIds(g)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {statusLabel === 'Grouped'
                          ? <span className="text-muted">Grouped</span>
                          : <GlassBadge tone={statusTone(statusLabel)}>{statusLabel}</GlassBadge>}
                      </td>
                      <td className="px-4 py-3 text-muted">{g.children.length} PH records</td>
                      <td className="px-4 py-3 text-ink">
                        <span className="flex items-center gap-2">
                          {parent.subject.lastName}
                          <GlassBadge tone="info">{g.children.length} linked</GlassBadge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{parentTypes(g)}</td>
                      <td className="px-4 py-3 text-muted">{fmtDate(receivedDate(parent))}</td>
                    </tr>
                    {!isCollapsed &&
                      g.children.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => navigate(`/cases/${c.id}`)}
                          className="cursor-pointer border-b border-line/60 hover:bg-[var(--pf-highlight)]"
                        >
                          <td className="py-3 pl-10 pr-4 font-medium text-accent">{requestId(c)}</td>
                          <td className="px-4 py-3"><GlassBadge tone={statusTone(c.status)}>{c.status}</GlassBadge></td>
                          <td className="px-4 py-3 text-ink/90">{c.caseNumber}</td>
                          <td className="px-4 py-3 text-ink">{c.subject.lastName}</td>
                          <td className="px-4 py-3 text-muted">{c.requestTypes.join(', ')}</td>
                          <td className="px-4 py-3 text-ink/90">{fmtDate(receivedDate(c))}</td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {groups.length > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            Showing {pageStart + 1}-{Math.min(pageStart + pageGroups.length, groups.length)} of {groups.length} request rows/groups
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
