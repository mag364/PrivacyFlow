import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Download, FolderPlus, ListChecks, CalendarDays, ChevronRight, Layers } from 'lucide-react';
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

function displayDate(p: Project): string {
  if (p.notificationCancelled) return 'Cancelled';
  return fmtDate(p.dateNotificationReceived);
}

// Group key: projects with the same name (case-insensitive) become children of
// one parent row. Names differing only by whitespace/case still group together.
function groupKey(p: Project): string {
  return p.projectName.trim().toLowerCase();
}

interface ProjectGroup {
  key: string;
  name: string;
  children: Project[];
}

const COLLAPSED_DEFAULT = true;

export function TasksPage() {
  const { year: yearParam } = useParams();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [q, setQ] = React.useState('');
  const [source, setSource] = React.useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = React.useState<'all' | string>('all');
  const [sort, setSort] = React.useState<'recent' | 'name' | 'date'>('recent');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
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

  if (!projects) return <Spinner label="Loading projects…" />;

  const yearOf = (p: Project) =>
    new Date(p.dateNotificationReceived ?? p.createdAt).getFullYear();

  const yearProjects = year ? projects.filter((p) => yearOf(p) === year) : projects;

  let visible = yearProjects.filter((p) => {
    if (source !== 'all' && p.source !== source) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (q) {
      const hay = `${p.projectNumber} ${p.projectName} ${p.ritmNumber ?? ''} ${p.businessUnit ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  visible = [...visible].sort((a, b) => {
    if (sort === 'name') return a.projectName.localeCompare(b.projectName);
    if (sort === 'date') return (a.dateNotificationReceived ?? '').localeCompare(b.dateNotificationReceived ?? '');
    return b.createdAt.localeCompare(a.createdAt);
  });

  // ---- Parent/child grouping by project name -------------------------------
  const groups: ProjectGroup[] = [];
  const byKey = new Map<string, ProjectGroup>();
  for (const p of visible) {
    const key = groupKey(p);
    let g = byKey.get(key);
    if (!g) {
      g = { key, name: p.projectName.trim(), children: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.children.push(p);
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
      p.ssdsTask ?? '',
      p.ssdsType,
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
      'Parent Project', 'Project Number', 'Project Name', 'Status', 'Source', "Date Notification Rec'd", 'Notification Cancelled',
      'RITM Number', 'Investment Class', 'Request Description/Explanation',
      'Fiscal Year', 'PIA Number', 'SSDS Task', 'SSDS Type', 'Project UID',
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
          '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
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
      year ? `privacyflow-projects-${year}.xlsx` : 'privacyflow-projects.xlsx',
      [{ name: 'Projects', rows }],
    );
  }

  function showAllYears() {
    clearLastYear('tasks');
    navigate('/tasks');
  }

  const groupedCount = groups.filter((g) => g.children.length > 1).length;

  return (
    <div>
      <PageHeader
        title={year ? `Projects — ${year}` : 'Projects'}
        subtitle={`${visible.length} project${visible.length === 1 ? '' : 's'} shown${year ? ` from ${year}` : ''}${groupedCount ? ` · ${groupedCount} grouped by name` : ''}.`}
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
                <FolderPlus className="h-4 w-4" /> Add Project
              </GlassButton>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <GlassInput className="pl-9" placeholder="Search project number, name, RITM…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <GlassSelect className="w-44" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </GlassSelect>
        <GlassSelect className="w-52" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </GlassSelect>
        <GlassSelect className="w-44" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">Sort: Recent</option>
          <option value="name">Sort: Name</option>
          <option value="date">Sort: Notification date</option>
        </GlassSelect>
      </div>

      <div className="content-surface overflow-x-auto">
        {visible.length === 0 ? (
          <EmptyState
            title={year ? `No projects in ${year}` : 'No matching projects'}
            description={year
              ? 'No projects were notified in this year yet. New projects appear here automatically based on their notification date.'
              : 'Adjust your filters, or add a project with the Add Project button.'}
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
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Date Notification Rec'd</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
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
                      <td className="px-4 py-3 text-ink/90">{p.source}</td>
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
                      <td className="px-4 py-3 text-muted">{parentSources(g).join(', ')}</td>
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
                          <td className="px-4 py-3 text-ink/90">{p.source}</td>
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

      <p className="mt-3 text-xs text-muted">
        Projects sharing the same name are grouped under a collapsed parent row — click it to
        expand its entries. The Excel export preserves this structure with native collapsible
        row groups (and groups you've collapsed here export collapsed too).
      </p>
    </div>
  );
}
