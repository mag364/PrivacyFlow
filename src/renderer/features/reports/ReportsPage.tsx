import React from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Download, FolderKanban, FolderOpen } from 'lucide-react';
import { platform } from '../../platform';
import type { DsrCase, Project } from '@shared/types';
import type { DashboardMetrics } from '../../platform/types';
import { PageHeader } from '../../layouts/AppShell';
import { GlassCard, GlassPanel, GlassButton, GlassBadge, Spinner } from '../../components/glass';
import { fmtDate } from '../../lib/format';
import { downloadXlsx, type XlsxRow, type XlsxCell } from '../../lib/xlsx';

const COLORS = ['#6ea8ff', '#8b7dff', '#54d6a1', '#ffb454', '#ff7a90', '#54c5d6', '#c58bff', '#9aa6c4'];

function tally(values: string[]): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// Group key for parent/child grouping: same project name (case-insensitive,
// whitespace-normalized) collapses into one Excel outline group.
function groupKey(p: Project): string {
  return p.projectName.trim().toLowerCase();
}

const tooltipStyle = {
  background: 'var(--pf-surface-solid)',
  border: '1px solid var(--pf-border)',
  borderRadius: 12,
  color: 'var(--pf-text)',
} as const;

export function ReportsPage() {
  const [m, setM] = React.useState<DashboardMetrics | null>(null);
  const [cases, setCases] = React.useState<DsrCase[] | null>(null);
  const [projects, setProjects] = React.useState<Project[] | null>(null);

  React.useEffect(() => {
    platform().dashboard.metrics().then(setM);
    platform().cases.list().then(setCases);
    platform().projects.list().then(setProjects);
  }, []);

  if (!m || !cases || !projects) return <Spinner label="Compiling reports…" />;

  const projectsBySource = tally(projects.map((p) => p.source));
  const projectsByClass = tally(projects.map((p) => p.investmentClass || 'Not Listed'));
  const cancelledProjects = projects.filter((p) => p.notificationCancelled).length;

  const requestKpis = [
    ['Open requests', m.openCases],
    ['Deletion', m.deletionCount],
    ['Unsubscribe', m.unsubscribeCount],
    ['Do Not Sell', m.doNotSaleCount],
  ] as const;

  const projectKpis = [
    ['Total projects', projects.length],
    ['Cancelled', cancelledProjects],
    ['DD source', projects.filter((p) => p.source === 'DD').length],
    ['SSDS source', projects.filter((p) => p.source === 'SSDS').length],
    ['Lighthouse source', projects.filter((p) => p.source === 'Lighthouse').length],
  ] as const;

  function projectCells(p: Project, parentName: string): XlsxCell[] {
    return [
      parentName,
      p.projectNumber,
      p.projectName,
      p.source,
      p.notificationCancelled ? 'Cancelled' : fmtDate(p.dateNotificationReceived),
      p.notificationCancelled ? 'Cancelled' : 'Active',
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
    ];
  }

  // Build the Projects Detail sheet with native Excel outline grouping:
  // same-name projects collapse under a parent summary row.
  function projectsDetailRows(): XlsxRow[] {
    const rows: XlsxRow[] = [[
      'Parent Project',
      'Project Number', 'Project Name', 'Source', "Date Notification Rec'd", 'Project Status',
      'RITM Number', 'Investment Class', 'Request Description/Explanation',
      'Fiscal Year', 'PIA Number', 'SSDS Task', 'SSDS Type', 'Project UID',
      'Business Unit', 'Business Sponsors', 'Demand Number', 'Assets Mentioned', 'Comments',
    ]];

    const sorted = [...projects].sort((a, b) => a.projectName.localeCompare(b.projectName));
    const byKey = new Map<string, Project[]>();
    for (const p of sorted) {
      const key = groupKey(p);
      const arr = byKey.get(key) ?? [];
      arr.push(p);
      byKey.set(key, arr);
    }

    for (const children of byKey.values()) {
      if (children.length === 1) {
        rows.push(projectCells(children[0], ''));
        continue;
      }
      const name = children[0].projectName.trim();
      const numbers = Array.from(new Set(children.map((c) => c.projectNumber)));
      const sources = Array.from(new Set(children.map((c) => c.source)));
      const dates = children
        .filter((c) => !c.notificationCancelled && c.dateNotificationReceived)
        .map((c) => c.dateNotificationReceived!)
        .sort();
      // Parent summary row — Excel collapses the group onto this row.
      rows.push({
        cells: [
          '',
          numbers.length === 1 ? numbers[0] : `${numbers.length} numbers`,
          `${name} (${children.length} entries)`,
          sources.join(', '),
          dates.length ? fmtDate(dates[dates.length - 1]) : (children.every((c) => c.notificationCancelled) ? 'Cancelled' : '—'),
          '',
          '', '', '', '', '', '', '', '', '', '', '', '', '',
        ],
        outlineLevel: 0,
      });
      for (const p of children) {
        rows.push({ cells: projectCells(p, name), outlineLevel: 1 });
      }
    }
    return rows;
  }

  function exportReport() {
    downloadXlsx('privacyflow-report.xlsx', [
      {
        name: 'Requests Summary',
        rows: [
          ['Metric', 'Value'],
          ...requestKpis.map(([k, v]) => [k, v] as (string | number)[]),
        ],
      },
      {
        name: 'Requests Detail',
        rows: [
          ['Request', 'Request ID', 'Subject', 'Types', 'Status', 'Date Received'],
          ...cases.map((c) => [
            c.caseNumber,
            c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? '—',
            c.subject.lastName,
            c.requestTypes.join('; '),
            c.status,
            fmtDate(c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate),
          ]),
        ],
      },
      {
        name: 'Projects Summary',
        rows: [
          ['Metric', 'Value'],
          ...projectKpis.map(([k, v]) => [k, v] as (string | number)[]),
        ],
      },
      {
        name: 'Projects Detail',
        rows: projectsDetailRows(),
      },
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Compliance and operational reporting across Requests and Projects."
        actions={
          <GlassButton variant="primary" onClick={exportReport}>
            <Download className="h-4 w-4" /> Export summary
          </GlassButton>
        }
      />

      {/* ------------------------------ Requests ------------------------------ */}
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold text-ink">Requests</h2>
        <GlassBadge tone="info">{cases.length} total</GlassBadge>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {requestKpis.map(([k, v]) => (
          <GlassCard key={k}>
            <p className="text-2xl font-bold text-ink">{v}</p>
            <p className="text-xs text-muted">{k}</p>
          </GlassCard>
        ))}
      </div>

      {/* ------------------------------ Projects ------------------------------ */}
      <div className="mb-3 flex items-center gap-2">
        <FolderKanban className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold text-ink">Projects</h2>
        <GlassBadge tone="info">{projects.length} total</GlassBadge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        {projectKpis.map(([k, v]) => (
          <GlassCard key={k}>
            <p className="text-2xl font-bold text-ink">{v}</p>
            <p className="text-xs text-muted">{k}</p>
          </GlassCard>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h3 className="mb-3 text-sm font-semibold text-ink">Projects by source</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={projectsBySource}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--pf-border)" />
              <XAxis dataKey="name" stroke="var(--pf-text-muted)" fontSize={11} />
              <YAxis allowDecimals={false} stroke="var(--pf-text-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#54d6a1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard>
          <h3 className="mb-3 text-sm font-semibold text-ink">Projects by investment class</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={projectsByClass}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={{ fill: '#ffffff', stroke: '#0b1020', strokeWidth: 3, paintOrder: 'stroke', fontSize: 12 }}
              >
                {projectsByClass.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      <GlassPanel className="mt-4">
        <p className="text-xs text-muted">
          Exporting downloads a single Excel workbook (.xlsx) with four sheets: Requests Summary,
          Requests Detail (every request row from the Requests tab), Projects Summary, and
          Projects Detail. Projects sharing the same name are grouped with native collapsible
          Excel row groups, just like the Projects tab export. It opens directly in Excel,
          Numbers, or Google Sheets with no warnings.
        </p>
      </GlassPanel>
    </div>
  );
}
