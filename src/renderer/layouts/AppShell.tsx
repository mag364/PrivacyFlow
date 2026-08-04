import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, FolderKanban, ListChecks, BarChart3, Workflow,
  ShieldCheck, Settings, LogOut, Plus, Lock, RefreshCw, KeyRound, X,
  ChevronDown, CalendarDays, PlusCircle, PackageCheck, ExternalLink,
  Minus, Maximize2, Minimize2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { can, useAuth } from '../store/auth';
import { platform } from '../platform';
import { ROLE_LABELS } from '@shared/constants';
import type { Permission } from '@shared/constants';
import { APP_CONFIG } from '@shared/config';
import { GlassButton, GlassInput } from '../components/glass';
import { initials, fmtDateTime } from '../lib/format';
import privacyFlowIcon from '../assets/privacyflow-icon.png';
import {
  currentLockState, refreshLockState, recheckLock, claimStaleLock, workspaceBridge,
  windowControlsBridge, workspaceInfo,
  type WorkspaceInfo, type WorkspaceLockState,
} from '../platform/workspace';
import type { AvailableRelease } from '../features/auth/LoginPage';

const NAV: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  anyOf?: Permission[];
}[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, anyOf: ['reports.view'] },
  { to: '/automation', label: 'Automation', icon: Workflow },
  { to: '/audit', label: 'Audit', icon: ShieldCheck, anyOf: ['audit.view'] },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function hasAnyPermission(role: Parameters<typeof can>[0], anyOf?: Permission[]): boolean {
  return !anyOf || anyOf.some((permission) => can(role, permission));
}

// Years the user has explicitly added even though they hold no records yet
// (e.g. an archive year they intend to import into). Requests and projects
// keep separate lists.
const EXTRA_REQUEST_YEARS_KEY = 'privacyflow.requestYears.extra.v1';
const EXTRA_PROJECT_YEARS_KEY = 'privacyflow.projectYears.extra.v1';

function readExtraYears(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((y) => Number.isInteger(y)) : [];
  } catch {
    return [];
  }
}

function writeExtraYears(key: string, years: number[]) {
  localStorage.setItem(key, JSON.stringify(years));
}

// Single polling hook shared by the banner and the sidebar indicator so both
// always agree on the current lock state.
function useLockState(): WorkspaceLockState {
  const [state, setState] = React.useState<WorkspaceLockState>(currentLockState());
  React.useEffect(() => {
    if (!workspaceBridge()) return;
    refreshLockState().then(setState);
    const t = setInterval(() => refreshLockState().then(setState), 30_000);
    return () => clearInterval(t);
  }, []);
  return state;
}

function useWorkspaceTitleInfo(): WorkspaceInfo | null {
  const [info, setInfo] = React.useState<WorkspaceInfo | null>(null);
  React.useEffect(() => {
    if (!workspaceBridge()) return;
    let cancelled = false;
    const load = () => {
      workspaceInfo().then((next) => {
        if (!cancelled) setInfo(next);
      }).catch(() => {
        if (!cancelled) setInfo(null);
      });
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return info;
}

function TitleStatusChip({
  tone,
  children,
  title,
}: {
  tone: 'neutral' | 'success' | 'warn' | 'danger';
  children: React.ReactNode;
  title?: string;
}) {
  const toneClass = {
    neutral: 'border-line bg-[var(--pf-highlight)] text-muted',
    success: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
    danger: 'border-red-400/40 bg-red-500/10 text-red-100',
  }[tone];
  return (
    <span
      title={title}
      className={clsx(
        'flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-capsule border px-2.5 text-[11px] font-medium leading-none',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function WindowTitleBar({
  lockState,
  availableRelease,
}: {
  lockState: WorkspaceLockState;
  availableRelease: AvailableRelease | null;
}) {
  const controls = windowControlsBridge();
  const info = useWorkspaceTitleInfo();
  const [maximized, setMaximized] = React.useState(false);
  if (!controls) return null;

  async function toggleMaximize() {
    setMaximized(await controls!.toggleMaximize());
  }

  return (
    <div className="app-drag-region sticky top-0 z-50 flex h-10 shrink-0 items-center border-b border-line bg-[var(--pf-surface)]/78 px-3 backdrop-blur-xl">
      <div className="flex min-w-0 shrink items-center gap-2">
        <img src={privacyFlowIcon} alt="" className="h-5 w-5 rounded-md object-cover" />
        <span className="truncate text-xs font-semibold text-ink">{APP_CONFIG.productName}</span>
        <span className="hidden text-[11px] text-muted sm:inline">{APP_CONFIG.tagline}</span>
      </div>
      <div className="app-no-drag app-title-status ml-auto mr-2 flex min-w-0 max-w-[calc(100vw-24rem)] items-center justify-end gap-1.5 overflow-x-auto whitespace-nowrap">
        {availableRelease && (
          <TitleStatusChip tone="warn" title={`Update available: ${availableRelease.tag_name}`}>
            <PackageCheck className="h-3.5 w-3.5 shrink-0" /> Update available {availableRelease.tag_name}
          </TitleStatusChip>
        )}
        {lockState.mode === 'read-only' ? (
          <TitleStatusChip
            tone={lockState.stale ? 'warn' : 'warn'}
            title={`Read-only — ${lockState.holder.user} on ${lockState.holder.machine} is currently editing`}
          >
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {lockState.stale ? 'Stale lock available' : `Read-only: ${lockState.holder.user}`}
          </TitleStatusChip>
        ) : (
          <TitleStatusChip tone="success" title={`Edit lock held by this PrivacyFlow window`}>
            <Lock className="h-3.5 w-3.5 shrink-0" /> Editable
          </TitleStatusChip>
        )}
        {info?.sync && (
          <>
            {info.sync.status === 'failed' && (
              <TitleStatusChip tone="danger" title={info.sync.lastError ?? 'Shared workspace sync failed.'}>
                <RefreshCw className="h-3.5 w-3.5 shrink-0" /> Sync failed
              </TitleStatusChip>
            )}
            {info.sync.status === 'syncing' && (
              <TitleStatusChip tone="warn" title="PrivacyFlow is syncing local changes to the shared workspace.">
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" /> Syncing
              </TitleStatusChip>
            )}
            {info.sync.status === 'pending' && (
              <TitleStatusChip tone="warn" title="PrivacyFlow has pending local changes or is checking the shared workspace.">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" /> {info.sync.lastSyncedAt ? 'Saving changes' : 'Checking sync'}
              </TitleStatusChip>
            )}
            {info.sync.status === 'local-only' && (
              <TitleStatusChip tone="warn" title="The local cache exists, but the shared workspace has not synced yet.">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" /> Local only
              </TitleStatusChip>
            )}
            {info.sync.status === 'synced' && (
              <TitleStatusChip tone="success" title={info.sync.lastSyncedAt ? `Last synced ${fmtDateTime(info.sync.lastSyncedAt)}` : 'Workspace is synced.'}>
                <RefreshCw className="h-3.5 w-3.5 shrink-0" /> Synced
              </TitleStatusChip>
            )}
          </>
        )}
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void controls.minimize()}
          className="grid h-7 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--pf-highlight)] hover:text-ink focus-ring"
          title="Minimize"
          aria-label="Minimize window"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void toggleMaximize()}
          className="grid h-7 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--pf-highlight)] hover:text-ink focus-ring"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
        >
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => void controls.close()}
          className="grid h-7 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-red-500/80 hover:text-white focus-ring"
          title="Close"
          aria-label="Close window"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Year accordion: clicking the section label navigates straight to the full
// list ("All requests"/"All projects") AND expands the year list beneath it.
// The chevron toggles the accordion without navigating.
// -----------------------------------------------------------------------------
function YearAccordion({
  label,
  icon: Icon,
  basePath,
  extraYearsKey,
  loadYears,
}: {
  label: string;
  icon: LucideIcon;
  basePath: string; // e.g. '/cases' — year pages live at `${basePath}/year/:year`
  extraYearsKey: string;
  loadYears: () => Promise<{ year: number; count: number }[]>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [years, setYears] = React.useState<{ year: number; count: number }[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [newYear, setNewYear] = React.useState('');

  const yearMatch = location.pathname.match(new RegExp(`^${basePath}/year/(\\d{4})`));
  const activeYear = yearMatch ? Number(yearMatch[1]) : null;
  const onSection = location.pathname.startsWith(basePath);
  // Auto-expand while anywhere inside the section, then collapse when another
  // nav section is selected.
  const [open, setOpen] = React.useState(onSection);
  React.useEffect(() => {
    setOpen(onSection);
  }, [onSection]);

  React.useEffect(() => {
    loadYears().then((fromData) => {
      const counts = new Map(fromData.map(({ year, count }) => [year, count]));
      for (const y of readExtraYears(extraYearsKey)) {
        if (!counts.has(y)) counts.set(y, 0);
      }
      setYears(
        Array.from(counts, ([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year),
      );
    });
  }, [location.pathname, extraYearsKey, loadYears]); // refresh on navigation (e.g. after creating a record)

  // Section label click: go to the full list and make sure the accordion is
  // open so the years are visible without a second click.
  function goToAll() {
    setOpen(true);
    navigate(basePath);
  }

  function addYear() {
    const y = Number(newYear.trim());
    if (!Number.isInteger(y) || y < 1990 || y > 2100) return;
    if (!years.some((v) => v.year === y)) {
      const extra = readExtraYears(extraYearsKey);
      if (!extra.includes(y)) writeExtraYears(extraYearsKey, [...extra, y]);
      setYears((prev) => [...prev, { year: y, count: 0 }].sort((a, b) => b.year - a.year));
    }
    setAdding(false);
    setNewYear('');
    navigate(`${basePath}/year/${y}`);
  }

  return (
    <div>
      <div
        className={clsx(
          'flex w-full items-center gap-1 rounded-xl text-sm font-medium transition-all',
          onSection
            ? 'bg-accent/15 text-ink shadow-glass'
            : 'text-muted hover:bg-[var(--pf-highlight)] hover:text-ink',
        )}
      >
        <button
          onClick={goToAll}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl px-3 py-2.5 text-left focus-ring"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{label}</span>
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-r-xl px-2 py-2.5 focus-ring"
          aria-expanded={open}
          title={open ? 'Collapse years' : 'Expand years'}
        >
          <ChevronDown
            className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      <div
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-line pl-3">
          <NavLink
            to={basePath}
            end
            className={({ isActive }) =>
              clsx(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all focus-ring',
                isActive && !activeYear
                  ? 'bg-accent/15 text-ink'
                  : 'text-muted hover:text-ink',
              )
            }
          >
            All {label.toLowerCase()}
          </NavLink>

          {years.map(({ year, count }) => (
            <NavLink
              key={year}
              to={`${basePath}/year/${year}`}
              className={() =>
                clsx(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all focus-ring',
                  activeYear === year
                    ? 'bg-accent/15 text-ink'
                    : 'text-muted hover:text-ink',
                )
              }
            >
              <CalendarDays className="h-3 w-3" />
              <span className="flex-1 text-left">{year}</span>
              <span className="text-[10px] text-muted">{count}</span>
            </NavLink>
          ))}

          {adding ? (
            <div className="flex items-center gap-1.5 px-1 py-1">
              <GlassInput
                className="h-7 w-20 px-2 py-0 text-xs"
                placeholder="e.g. 2024"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addYear(); }
                  if (e.key === 'Escape') { setAdding(false); setNewYear(''); }
                }}
                autoFocus
              />
              <button onClick={addYear} className="rounded-lg p-1 text-accent hover:bg-[var(--pf-highlight)] focus-ring" title="Add year">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => { setAdding(false); setNewYear(''); }} className="rounded-lg p-1 text-muted hover:text-ink focus-ring" title="Cancel">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-all hover:text-ink focus-ring"
            >
              <PlusCircle className="h-3 w-3" /> Add year
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Years for each section, derived from record dates.
function saneYear(value?: string): number | null {
  const date = value ? new Date(value) : null;
  const year = date ? date.getFullYear() : NaN;
  return Number.isFinite(year) && year >= 2000 && year <= 2200 ? year : null;
}

const loadRequestYears = async () => {
  const cases = await platform().cases.list();
  const counts = new Map<number, number>();
  for (const c of cases) {
    const y = saneYear(c.sla.receivedDate);
    if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return Array.from(counts, ([year, count]) => ({ year, count }));
};

const loadProjectYears = async () => {
  const projects = await platform().projects.list();
  const counts = new Map<number, number>();
  for (const p of projects) {
    // Group by notification date when present; cancelled/undated projects
    // fall back to the year they were logged.
    const y = saneYear(p.dateNotificationReceived) ?? saneYear(p.createdAt);
    if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return Array.from(counts, ([year, count]) => ({ year, count }));
};

// -----------------------------------------------------------------------------
// Shared-workspace banner. Only rendered in the packaged desktop app when the
// lock file is held by another user: the workspace is read-only until the lock
// frees up. Dismissible — a subtle sidebar indicator remains (see AppShell).
// -----------------------------------------------------------------------------
const DISMISS_KEY = 'privacyflow.banner.dismissed.holder';

function WorkspaceBanner({ state }: { state: WorkspaceLockState }) {
  const [busy, setBusy] = React.useState(false);
  const [dismissedHolder, setDismissedHolder] = React.useState<string | null>(
    () => sessionStorage.getItem(DISMISS_KEY),
  );

  if (!workspaceBridge() || state.mode !== 'read-only') return null;
  const { holder, stale } = state;

  // Dismissal is per lock-holder: if a different person takes the lock, the
  // banner reappears.
  const holderKey = `${holder.user}@${holder.machine}:${holder.since}`;
  if (dismissedHolder === holderKey) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, holderKey);
    setDismissedHolder(holderKey);
  }

  async function retry() {
    setBusy(true);
    const next = await recheckLock();
    setBusy(false);
    if (next.mode === 'write') window.location.reload();
  }

  async function claim() {
    setBusy(true);
    const next = await claimStaleLock();
    setBusy(false);
    if (next.mode === 'write') window.location.reload();
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-glass border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <Lock className="h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          Read-only mode — {holder.user} on {holder.machine} is currently editing
        </p>
        <p className="text-xs text-muted">
          Lock held since {fmtDateTime(holder.since)}.
          {stale
            ? ' The lock looks stale (the other app may have crashed) — you can take it over.'
            : ' You can view everything; changes are disabled until they close the app.'}
        </p>
      </div>
      {stale && (
        <GlassButton variant="primary" className="px-3 py-1.5 text-xs" loading={busy} onClick={claim}>
          <KeyRound className="h-3.5 w-3.5" /> Take over editing
        </GlassButton>
      )}
      <GlassButton className="px-3 py-1.5 text-xs" loading={busy} onClick={retry}>
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </GlassButton>
      <button
        onClick={dismiss}
        className="rounded-lg p-1.5 text-muted hover:text-ink focus-ring"
        title="Dismiss — a read-only indicator stays in the sidebar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AppShell({
  children,
  availableRelease,
}: {
  children: React.ReactNode;
  availableRelease: AvailableRelease | null;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const lockState = useLockState();
  const readOnly = lockState.mode === 'read-only';
  const holder = readOnly ? lockState.holder : null;
  const role = user?.role;
  const hasWindowTitleBar = !!windowControlsBridge();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <WindowTitleBar lockState={lockState} availableRelease={availableRelease} />
      <div className="flex min-h-0 flex-1">
      <aside
        className={clsx(
          'sticky hidden w-64 flex-col gap-2 border-r border-line bg-[var(--pf-surface)] px-4 py-6 backdrop-blur-xl md:flex',
          hasWindowTitleBar ? 'top-10 h-[calc(100vh-2.5rem)]' : 'top-0 h-screen',
        )}
      >
        <div className="mb-6 flex items-center gap-3 px-2">
          <img src={privacyFlowIcon} alt="" className="h-10 w-10 rounded-2xl object-cover shadow-glass" />
          <div>
            <p className="text-sm font-bold text-ink">{APP_CONFIG.productName}</p>
            <p className="text-[11px] text-muted">{APP_CONFIG.tagline}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.slice(0, 1).filter(({ anyOf }) => hasAnyPermission(role, anyOf)).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all focus-ring',
                  isActive
                    ? 'bg-accent/15 text-ink shadow-glass'
                    : 'text-muted hover:bg-[var(--pf-highlight)] hover:text-ink',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}

          {can(role, 'requests.view') && (
            <YearAccordion
              label="DSR Requests"
              icon={FolderKanban}
              basePath="/cases"
              extraYearsKey={EXTRA_REQUEST_YEARS_KEY}
              loadYears={loadRequestYears}
            />
          )}

          {can(role, 'projects.view') && (
            <YearAccordion
              label="Data Notifications"
              icon={ListChecks}
              basePath="/tasks"
              extraYearsKey={EXTRA_PROJECT_YEARS_KEY}
              loadYears={loadProjectYears}
            />
          )}

          {NAV.slice(1).filter(({ anyOf }) => hasAnyPermission(role, anyOf)).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all focus-ring',
                  isActive
                    ? 'bg-accent/15 text-ink shadow-glass'
                    : 'text-muted hover:bg-[var(--pf-highlight)] hover:text-ink',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {readOnly && holder && (
          <div
            className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2"
            title={`Read-only — ${holder.user} on ${holder.machine} is currently editing`}
          >
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-amber-300">Read-only</p>
              <p className="truncate text-[10px] text-muted">{holder.user} is editing</p>
            </div>
          </div>
        )}

        {availableRelease && (
          <button
            type="button"
            onClick={() => window.open(availableRelease.html_url, '_blank', 'noopener,noreferrer')}
            className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left transition-colors hover:bg-amber-400/15 focus-ring"
          >
            <span className="flex min-w-0 items-center gap-2">
              <PackageCheck className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-amber-100">Update available</span>
                <span className="block truncate text-[10px] text-amber-100/80">{availableRelease.tag_name}</span>
              </span>
            </span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-amber-200" />
          </button>
        )}

        <div className="mt-2 flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--pf-highlight)] text-xs font-semibold text-ink">
            {user ? initials(user.name.split(' ')[0] ?? user.name, user.name.split(' ')[1] ?? '') : '—'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
            <p className="truncate text-[11px] text-muted">{user ? ROLE_LABELS[user.role] : ''}</p>
          </div>
          <button onClick={handleLogout} className="text-muted hover:text-ink focus-ring rounded-lg p-1.5" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={clsx(
            'sticky z-10 flex items-center gap-3 border-b border-line bg-[var(--pf-surface)] px-6 py-3 backdrop-blur-xl md:hidden',
            hasWindowTitleBar ? 'top-10' : 'top-0',
          )}
        >
          <img src={privacyFlowIcon} alt="" className="h-8 w-8 rounded-xl object-cover shadow-glass" />
          <span className="text-sm font-bold text-ink">{APP_CONFIG.productName}</span>
          {readOnly && (
            <span className="flex items-center gap-1 rounded-capsule border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              <Lock className="h-3 w-3" /> Read-only
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <GlassButton variant="primary" onClick={() => navigate('/cases/new')}>
              <Plus className="h-4 w-4" />
            </GlassButton>
            <button onClick={handleLogout} className="text-muted focus-ring rounded-lg p-2">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main key={location.pathname} className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          <WorkspaceBanner state={lockState} />
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}
