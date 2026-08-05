import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Download, FolderPlus, ListChecks, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Layers } from 'lucide-react';
import { platform } from '../../platform';
import type { Project } from '@shared/types';
import { PROJECT_STATUSES } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassButton, GlassInput, GlassSelect, GlassBadge, Spinner, EmptyState } from '../../components/glass';
import { fmtDate, statusTone } from '../../lib/format';
import { downloadXlsx, type XlsxRow } from '../../lib/xlsx';
import { readLastYear, writeLastYear, clearLastYear } from '../../lib/lastYear';
import { useAuth, can } from '../../store/auth';

const SOURCES = ['DD', 'SSDS', 'Lighthouse'];
const PAGE_SIZE = 15;
const FILTERS_KEY = 'privacyflow.projects.filters.v1';

function readFilters(): { q: string; source: string; statusFilter: string; sort: 'recent' | 'name' | 'date'; page: number } {
  try {
    return {
      q: '',
      source: 'all',
      statusFilter: 'all',
      sort: 'recent',
      page: 0,
      ...JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}'),
    };
  } catch {
    return { q: '', source: 'all', statusFilter: 'all', sort: 'recent', page: 0 };
  }
}

function displayDate(p: Project): string {
  if (p.notificationCancelled) return 'Cancelled';
  return fmtDate(p.dateNotificationReceived);
}

function normalizedGroupValue(value: string): string {
  return value.trim().toLowerCase();
}

interface ProjectGroup {
  key: string;
  name: string;
  children: Project[];
}

const COLLAPSED_DEFAULT = true;

function saneYear(value?: string): number | null {
  const date = value ? new Date(value) : null;
  const year = date ? date.getFullYear() : NaN;
  return Number.isFinite(year) && year >= 2000 && year <= 2200 ? year : null;
}

export function TasksPage() {
  const { year: yearParam } = useParams();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const savedFilters = React.useMemo(readFilters, []);
  const [q, setQ] = React.useState(savedFilters.q);
  const [source, setSource] = React.useState<'all' | string>(savedFilters.source);
  const [statusFilter, setStatusFilter] = React.useState<'all' | string>(savedFilters.statusFilter);
  const [sort, setSort] = React.useState<'recent' | 'name' | 'date'>(savedFilters.sort);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [page, setPage] = React.useState(savedFilters.page);
  const didInitFilters = React.useRef(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  React.useEffect(() => {
    if (year) {
      writeLastYear('tasks', year);
    } else {
      const remembered = readLastYear('tasks');
      if (remembered) navigate(`/tasks/year/${remembered}`, { replace: true });
    }
  }, [year, navigate]);

  React.useEffect(() => {
    platform().projects.list().then(setProjects);
  }, [year]);

  React.useEffect(() => {
    if (!didInitFilters.current) {
      didInitFilters.current = true;
      return;
    }
    setPage(0);
  }, [year, q, source, statusFilter, sort]);

  React.useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ q, source, statusFilter, sort, page }));
  }, [q, source, statusFilter, sort, page]);

  if (!projects) return <Spinner label="Loading data notifications…" />;

  const yearOf = (p: Project) => saneYear(p.dateNotificationReceived) ?? saneYear(p.createdAt);

  const yearProjects = year ? projects.filter((p) => yearOf(p) === year) : projects;

  let visible = yearProjects.filter((p) => {
    if (source !== 'all' && p.source !== source) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (q) {
      const hay = `${p.projectNumber} ${p.projectName} ${p.ritmNumber ?? ''} ${p.oneTrustProjectId ?? ''} ${p.businessUnit ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  visible = [...visible].sort((a, b) => {
    if (sort === 'name') return a.projectName.localeCompare(b.projectName);
    if (sort === 'date') return (a.dateNotificationReceived ?? '').localeCompare(b.dateNotificationReceived ?? '');
    return b.createdAt.localeCompare(a.createdAt);
  });

  // ---- Parent/child grouping by project name or project number -------------
  const groups: ProjectGroup[] = [];
  const byName = new Map<string, ProjectGroup>();
  const byNumber = new Map<string, ProjectGroup>();
  const indexGroup = (g: ProjectGroup) => {
    for (const child of g.children) {
      const nameKey = normalizedGroupValue(child.projectName);
      const numberKey = normalizedGroupValue(child.projectNumber);
      if (nameKey) byName.set(nameKey, g);
      if (numberKey) byNumber.set(numberKey, g);
    }
  };

  for (const p of visible) {
    const nameKey = normalizedGroupValue(p.projectName);
    const numberKey = normalizedGroupValue(p.projectNumber);
    const nameGroup = nameKey ? byName.get(nameKey) : undefined;
    const numberGroup = numberKey ? byNumber.get(numberKey) : undefined;
    let g = nameGroup ?? numberGroup;
    if (!g) {
      g = { key: p.id, name: p.projectName.trim(), children: [] };
      groups.push(g);
    } else if (nameGroup && numberGroup && nameGroup !== numberGroup) {
      nameGroup.children.push(...numberGroup.children);
      const index = groups.indexOf(numberGroup);
      if (index >= 0) groups.splice(index, 1);
      g = nameGroup;
      indexGroup(g);
    }
    g.children.push(p);
    indexGroup(g);
  }
  for (const g of groups) {
    g.children.sort((a, b) => {
      if (sort === 'date') return (a.dateNotificationReceived ?? '').localeCompare(b.dateNotificationReceived ?? '');
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  function parentDate(g: ProjectGroup): string {
    const dates = g.children
      .filter((c) => !c.notificationCancelled && c.dateNotificationReceived)
      .map((c) => c.dateNotificationReceived!)
      .sort();
    if (!dates.length) return g.children.every((c) => c.notificationCancelled) ? 'Cancelled' : '—';
    return fmtDate(dates[dates.length - 1]);
  }

  function parentSources(g: ProjectGroup): string[] {
    return Array.from(new Set(g.children.map((c) => c.source)));
  }

  function parentOneTrustProjectIds(g: ProjectGroup): string[] {
    return Array.from(new Set(
      g.children
        .map((c) => c.oneTrustProjectId?.trim())
        .filter((id): id is string => Boolean(id)),
    ));
  }

  function parentNumber(g: ProjectGroup): string {
    const distinct = Array.from(new Set(g.children.map((c) => c.projectNumber)));
    return distinct.length === 1 ? distinct[0] : `${distinct.length} numbers`;
  }

  function isGroupCollapsed(key: string): boolean {
    return collapsed[key] ?? COLLAPSED_DEFAULT;
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? COLLAPSED_DEFAULT) }));
  }

  function projectCells(p: Project, parentName: string): (string | number)[] {
    return [
      parentName,
      p.projectNumber,
      p.projectName,
      p.status,
      p.source,
      p.notificationCancelled ? 'Cancelled' : fmtDate(p.dateNotificationReceived),
      p.notificationCancelled ? 'Yes' : 'No',
      p.ritmNumber ?? '',
      p.investmentClass,
      p.description,
      p.fiscalYear ?? '',
      p.piaNumber ?? '',
      p.oneTrustProjectId ?? '',
      p.oneTrustUrl ?? '',
      p.ssdsTask ?? '',
      p.ssdsType ?? '',
      p.projectUid ?? '',
      p.businessUnit ?? '',
      p.businessSponsors ?? '',
      p.demandNumber ?? '',
      p.assetsMentioned ?? '',
      p.comments ?? '',
      p.createdBy,
      p.createdAt,
    ];
  }

  function exportXlsx() {
    const header = [
      'Parent Project', 'Project Number', 'Project Name', 'Status', 'Source Information', "Date Notification Rec'd", 'Notification Cancelled',
      'RITM Number', 'Investment Class', 'Request Description/Explanation',
      'Fiscal Year', 'PIA Number', 'OneTrust Project ID', 'OneTrust Link', 'SSDS Task', 'SSDS Type', 'Project UID',
      'Business Unit', 'Business Sponsors', 'Demand Number', 'Assets Mentioned',
      'Comments', 'Created By', 'Created At',
    ];

    const rows: XlsxRow[] = [header];
    for (const g of groups) {
      if (g.children.length === 1) {
        rows.push(projectCells(g.children[0], ''));
        continue;
      }
      const isCollapsed = isGroupCollapsed(g.key);
      rows.push({
        cells: [
          '',
          parentNumber(g),
          `${g.name} (${g.children.length} entries)`,
          '',
          parentSources(g).join(', '),
          parentDate(g),
          '',
          '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        ],
        outlineLevel: 0,
      });
      for (const p of g.children) {
        rows.push({
          cells: projectCells(p, g.name),
          outlineLevel: 1,
          hidden: isCollapsed,
        });
      }
    }

    downloadXlsx(
      year ? `privacyflow-data-notifications-${year}.xlsx` : 'privacyflow-data-notifications.xlsx',
      [{ name: 'Data Notifications', rows }],
    );
  }

  function showAllYears() {
    clearLastYear('tasks');
    navigate('/tasks');
  }

  const groupedCount = groups.filter((g) => g.children.length > 1).length;
  const pageCount = Math.max(Math.ceil(groups.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageGroups = groups.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title={year ? `Data Notifications — ${year}` : 'Data Notifications'}
        subtitle={`${visible.length} data notification${visible.length === 1 ? '' : 's'} shown${year ? ` from ${year}` : ''}${groupedCount ? ` · ${groupedCount} grouped by name` : ''}.`}
        actions={
          <>
            {year && (
              <GlassButton onClick={showAllYears}>
                <CalendarDays className="h-4 w-4" /> Show all years
              </GlassButton>
            )}
            <GlassButton onClick={exportXlsx}><Download className="h-4 w-4" /> Export</GlassButton>
            {can(user?.role, 'projects.create') && (
              <GlassButton variant="primary" onClick={() => navigate('/projects/new')}>
                <FolderPlus className="h-4 w-4" /> Add Data Notification
              </GlassButton>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <GlassInput className="pl-9" placeholder="Search project number, name, RITM, OneTrust ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <GlassSelect value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </GlassSelect>
          <GlassSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </GlassSelect>
          <GlassSelect value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="recent">Sort: Recent</option>
            <option value="name">Sort: Name</option>
            <option value="date">Sort: Notification date</option>
          </GlassSelect>
        </div>
      </div>

      <div className="content-surface overflow-x-auto">
        {visible.length === 0 ? (
          <EmptyState
            title={year ? `No data notifications in ${year}` : 'No matching data notifications'}
            description={year
              ? 'No data notifications were received in this year yet. New entries appear here automatically based on their notification date.'
              : 'Adjust your filters, or add a data notification.'}
            icon={year ? <CalendarDays className="h-6 w-6" /> : <ListChecks className="h-6 w-6" />}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--pf-surface-2)]">
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Project Number</th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">RITM Number</th>
                <th className="px-4 py-3">OneTrust Project ID</th>
                <th className="px-4 py-3">Date Notification Rec'd</th>
              </tr>
            </thead>
            <tbody>
              {pageGroups.map((g) => {
                if (g.children.length === 1) {
                  const p = g.children[0];
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="cursor-pointer border-b border-line/60 hover:bg-[var(--pf-highlight)]"
                    >
                      <td className="px-4 py-3 font-medium text-accent">{p.projectNumber}</td>
                      <td className="px-4 py-3 font-medium text-ink">{p.projectName}</td>
                      <td className="px-4 py-3"><GlassBadge tone={statusTone(p.status)}>{p.status}</GlassBadge></td>
                      <td className="px-4 py-3 text-ink/90">{p.ritmNumber ?? '—'}</td>
                      <td className="px-4 py-3 text-ink/90">{p.oneTrustProjectId ?? '—'}</td>
                      <td className="px-4 py-3 text-ink/90">{displayDate(p)}</td>
                    </tr>
                  );
                }

                const isCollapsed = isGroupCollapsed(g.key);
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
                          {parentNumber(g)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium text-ink">
                          {g.name}
                          <GlassBadge tone="info">{g.children.length} entries</GlassBadge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">Grouped</td>
                      <td className="px-4 py-3 text-muted">—</td>
                      <td className="px-4 py-3 text-muted">{parentOneTrustProjectIds(g).join(', ') || '—'}</td>
                      <td className="px-4 py-3 text-muted">{parentDate(g)}</td>
                    </tr>
                    {!isCollapsed &&
                      g.children.map((p) => (
                        <tr
                          key={p.id}
                          onClick={() => navigate(`/projects/${p.id}`)}
                          className="cursor-pointer border-b border-line/60 hover:bg-[var(--pf-highlight)]"
                        >
                          <td className="py-3 pl-10 pr-4 font-medium text-accent">{p.projectNumber}</td>
                          <td className="px-4 py-3 text-ink/80">{p.projectName}</td>
                          <td className="px-4 py-3"><GlassBadge tone={statusTone(p.status)}>{p.status}</GlassBadge></td>
                          <td className="px-4 py-3 text-ink/90">{p.ritmNumber ?? '—'}</td>
                          <td className="px-4 py-3 text-ink/90">{p.oneTrustProjectId ?? '—'}</td>
                          <td className="px-4 py-3 text-ink/90">{displayDate(p)}</td>
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
            Showing {pageStart + 1}-{Math.min(pageStart + pageGroups.length, groups.length)} of {groups.length} project rows/groups
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

      <p className="mt-3 text-xs text-muted">
        Data notifications sharing the same project name are grouped under a collapsed parent row — click it to
        expand its entries. The Excel export preserves this structure with native collapsible
        row groups (and groups you've collapsed here export collapsed too).
      </p>
    </div>
  );
}
