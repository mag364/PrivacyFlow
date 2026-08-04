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

function monthBucket(value: string): { key: string; name: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { key: '9999-99', name: 'Unknown' };
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { key, name: date.toLocaleString(undefined, { month: 'short', year: 'numeric' }) };
}

function requestReceivedDate(c: DsrCase): string {
  return c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate;
}

// Group key for parent/child grouping: same project name (case-insensitive,
// whitespace-normalized) collapses into one Excel outline group.
function groupKey(p: Project): string {
  return p.projectName.trim().toLowerCase();
}

const tooltipStyle = {
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 12,
  color: '#ffffff',
} as const;

const tooltipTextStyle = { color: '#ffffff' } as const;

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
  const requestsByChannel = tally(cases.map((c) => String(c.intakeChannel || 'Unknown')));
  const requestMonthlyVolume = Array.from(
    cases.reduce((map, c) => {
      const bucket = monthBucket(requestReceivedDate(c));
      const current = map.get(bucket.key) ?? { key: bucket.key, name: bucket.name, value: 0 };
      map.set(bucket.key, { ...current, value: current.value + 1 });
      return map;
    }, new Map<string, { key: string; name: string; value: number }>()),
    ([, value]) => value,
  ).sort((a, b) => a.key.localeCompare(b.key));
  const cancelledProjects = projects.filter((p) => p.notificationCancelled).length;

  const requestKpis = [
    ['Open requests', m.openCases],
    ['Deletion', m.deletionCount],
    ['Unsubscribe', m.unsubscribeCount],
    ['Do Not Sell', m.doNotSaleCount],
  ] as const;

  const projectKpis = [
    ['Total data notifications', projects.length],
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
    ];
  }

  // Build the Projects Detail sheet with native Excel outline grouping:
  // same-name projects collapse under a parent summary row.
  function projectsDetailRows(): XlsxRow[] {
    const rows: XlsxRow[] = [[
      'Parent Project',
      'Project Number', 'Project Name', 'Source Information', "Date Notification Rec'd", 'Data Notification Status',
      'RITM Number', 'Investment Class', 'Request Description/Explanation',
      'Fiscal Year', 'PIA Number', 'OneTrust Project ID', 'OneTrust Link', 'SSDS Task', 'SSDS Type', 'Project UID',
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
          '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
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
        name: 'DSR Requests Summary',
        rows: [
          ['Metric', 'Value'],
          ...requestKpis.map(([k, v]) => [k, v] as (string | number)[]),
        ],
      },
      {
        name: 'DSR Requests Detail',
        rows: [
          ['DSRREQ #', 'ServiceNow Link', 'Request ID', 'Subject', 'Types', 'Status', 'Date Received'],
          ...cases.map((c) => [
            c.caseNumber,
            c.serviceNowUrl ?? '',
            c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? '—',
            c.subject.lastName,
            c.requestTypes.join('; '),
            c.status,
            fmtDate(c.intakeDates?.dateDppReceivedEmail ?? c.sla.receivedDate),
          ]),
        ],
      },
      {
        name: 'Data Notifications Summary',
        rows: [
          ['Metric', 'Value'],
          ...projectKpis.map(([k, v]) => [k, v] as (string | number)[]),
        ],
      },
      {
        name: 'Data Notifications Detail',
        rows: projectsDetailRows(),
      },
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Compliance and operational reporting across DSR Requests and Data Notifications."
        actions={
          <GlassButton variant="primary" onClick={exportReport}>
            <Download className="h-4 w-4" /> Export summary
          </GlassButton>
        }
      />

      {/* ---------------------------- DSR Requests ---------------------------- */}
      <div className="mb-3 flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold text-ink">DSR Requests</h2>
        <GlassBadge tone="info">{cases.length} total</GlassBadge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {requestKpis.map(([k, v]) => (
          <GlassCard key={k}>
            <p className="text-2xl font-bold text-ink">{v}</p>
            <p className="text-xs text-muted">{k}</p>
          </GlassCard>
        ))}
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h3 className="mb-3 text-sm font-semibold text-ink">Monthly request volume</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={requestMonthlyVolume}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--pf-border)" />
              <XAxis dataKey="name" stroke="var(--pf-text-muted)" fontSize={11} />
              <YAxis allowDecimals={false} stroke="var(--pf-text-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipTextStyle} itemStyle={tooltipTextStyle} />
              <Bar dataKey="value" fill="#6ea8ff" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard>
          <h3 className="mb-3 text-sm font-semibold text-ink">DSR Requests by source/channel</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={requestsByChannel}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--pf-border)" />
              <XAxis dataKey="name" stroke="var(--pf-text-muted)" fontSize={11} />
              <YAxis allowDecimals={false} stroke="var(--pf-text-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipTextStyle} itemStyle={tooltipTextStyle} />
              <Bar dataKey="value" fill="#54d6a1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* ------------------------- Data Notifications ------------------------- */}
      <div className="mb-3 flex items-center gap-2">
        <FolderKanban className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold text-ink">Data Notifications</h2>
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
          <h3 className="mb-3 text-sm font-semibold text-ink">Data Notifications by source</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={projectsBySource}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--pf-border)" />
              <XAxis dataKey="name" stroke="var(--pf-text-muted)" fontSize={11} />
              <YAxis allowDecimals={false} stroke="var(--pf-text-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipTextStyle} itemStyle={tooltipTextStyle} />
              <Bar dataKey="value" fill="#54d6a1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard>
          <h3 className="mb-3 text-sm font-semibold text-ink">Data Notifications by investment class</h3>
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
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipTextStyle} itemStyle={tooltipTextStyle} />
            </PieChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      <GlassPanel className="mt-4">
        <p className="text-xs text-muted">
          Exporting downloads a single Excel workbook (.xlsx) with four sheets: DSR Requests Summary,
          DSR Requests Detail, Data Notifications Summary, and Data Notifications Detail. Data notifications
          sharing the same project name are grouped with native collapsible Excel row groups. It opens directly in Excel,
          Numbers, or Google Sheets with no warnings.
        </p>
      </GlassPanel>
    </div>
  );
}
