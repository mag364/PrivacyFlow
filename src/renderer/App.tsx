import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { platform } from './platform';
import { refreshLockState } from './platform/workspace';
import { can, useAuth } from './store/auth';
import { AppShell, PageHeader } from './layouts/AppShell';
import { GlassPanel, Spinner } from './components/glass';
import type { Permission } from '@shared/constants';
import { LoginPage, type AvailableRelease } from './features/auth/LoginPage';
import { SetupPage } from './features/setup/SetupPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { CasesPage } from './features/cases/CasesPage';
import { NewCasePage } from './features/cases/NewCasePage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { TasksPage } from './features/tasks/TasksPage';
import { NewProjectPage } from './features/projects/NewProjectPage';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { AutomationPage } from './features/automation/AutomationPage';
import { AuditPage } from './features/audit/AuditPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { APP_CONFIG } from '@shared/config';

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid h-screen w-screen place-items-center">{children}</div>;
}

function AccessDenied() {
  return (
    <div>
      <PageHeader title="Access denied" subtitle="Your role does not include permission to open this area." />
      <GlassPanel>
        <p className="text-sm text-muted">Contact an administrator if you need access.</p>
      </GlassPanel>
    </div>
  );
}

function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: Permission[];
  children: React.ReactElement;
}) {
  const { user } = useAuth();
  if (!anyOf.some((permission) => can(user?.role, permission))) return <AccessDenied />;
  return children;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
}

function normalizeVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => {
      const parsed = Number.parseInt(part.replace(/\D+.*/, ''), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = normalizeVersion(candidate);
  const base = normalizeVersion(current);
  for (let i = 0; i < Math.max(next.length, base.length); i += 1) {
    const a = next[i] ?? 0;
    const b = base[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function fetchLatestPublishedRelease(): Promise<AvailableRelease | null> {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  const latestRes = await fetch(`${APP_CONFIG.updates.latestReleaseUrl}?t=${Date.now()}`, {
    cache: 'no-store',
    headers,
  });
  if (latestRes.ok) {
    const latest = await latestRes.json() as GitHubRelease;
    if (latest.tag_name && !latest.draft && isNewerVersion(latest.tag_name, APP_CONFIG.version)) {
      return { tag_name: latest.tag_name, html_url: latest.html_url };
    }
  }

  const releasesRes = await fetch(`${APP_CONFIG.updates.releasesApiUrl}?per_page=10&t=${Date.now()}`, {
    cache: 'no-store',
    headers,
  });
  if (!releasesRes.ok) return null;
  const releases = await releasesRes.json() as GitHubRelease[];
  const latest = releases.find((release) => (
    release.tag_name &&
    !release.draft &&
    !release.prerelease &&
    isNewerVersion(release.tag_name, APP_CONFIG.version)
  ));
  return latest ? { tag_name: latest.tag_name, html_url: latest.html_url } : null;
}

function Protected({ availableRelease }: { availableRelease: AvailableRelease | null }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppShell availableRelease={availableRelease}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cases" element={<RequirePermission anyOf={['requests.view']}><CasesPage /></RequirePermission>} />
        <Route path="/cases/year/:year" element={<RequirePermission anyOf={['requests.view']}><CasesPage /></RequirePermission>} />
        <Route path="/cases/new" element={<RequirePermission anyOf={['requests.create']}><NewCasePage /></RequirePermission>} />
        <Route path="/cases/:id" element={<RequirePermission anyOf={['requests.view']}><CaseDetailPage /></RequirePermission>} />
        <Route path="/tasks" element={<RequirePermission anyOf={['projects.view']}><TasksPage /></RequirePermission>} />
        <Route path="/tasks/year/:year" element={<RequirePermission anyOf={['projects.view']}><TasksPage /></RequirePermission>} />
        <Route path="/projects/new" element={<RequirePermission anyOf={['projects.create']}><NewProjectPage /></RequirePermission>} />
        <Route path="/projects/:id" element={<RequirePermission anyOf={['projects.view']}><ProjectDetailPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission anyOf={['reports.view']}><ReportsPage /></RequirePermission>} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/audit" element={<RequirePermission anyOf={['audit.view']}><AuditPage /></RequirePermission>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const { init, user, logout } = useAuth();
  const [booted, setBooted] = React.useState(false);
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = React.useState<number>(APP_CONFIG.defaults.autoLockMinutes);
  const [availableRelease, setAvailableRelease] = React.useState<AvailableRelease | null>(null);

  React.useEffect(() => {
    (async () => {
      // Resolve the shared-workspace lock state first so the platform layer
      // knows whether this instance may write before any data is touched.
      await refreshLockState();
      const settings = await platform().system.settings();
      setNeedsSetup(!settings.setupComplete);
      setAutoLockMinutes(settings.autoLockMinutes);
      await init();
      setBooted(true);
      if (settings.setupComplete && settings.autoRetentionCleanup) {
        window.setTimeout(() => {
          void platform().system.applyRetentionCleanup({ automatic: true, auditWhenEmpty: false }).catch(() => {
            // Startup should not fail because this instance is read-only or cleanup is unavailable.
          });
        }, 5000);
      }
      fetchLatestPublishedRelease().then(setAvailableRelease).catch(() => {
        // Startup and sign-in must keep working if GitHub is unavailable.
      });
    })();
  }, [init]);

  React.useEffect(() => {
    if (!user || autoLockMinutes <= 0) return undefined;

    const timeoutMs = autoLockMinutes * 60_000;
    let timer = 0;
    let lastTouch = 0;
    let lastActivity = Date.now();

    const lock = () => {
      void logout();
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, timeoutMs);
    };
    const activity = () => {
      const now = Date.now();
      if (now - lastActivity >= timeoutMs) {
        lock();
        return;
      }
      lastActivity = now;
      arm();
      if (now - lastTouch >= 30_000) {
        lastTouch = now;
        void platform().auth.touchSession();
      }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') activity();
    };

    activity();
    window.addEventListener('pointerdown', activity);
    window.addEventListener('pointermove', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('focus', activity);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('pointermove', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('focus', activity);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [autoLockMinutes, logout, user]);

  if (!booted) {
    return (
      <FullScreen>
        <Spinner label="Starting PrivacyFlow…" />
      </FullScreen>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage onDone={() => setNeedsSetup(false)} />} />
      <Route path="/login" element={<LoginPage availableRelease={availableRelease} />} />
      <Route path="/*" element={needsSetup ? <Navigate to="/setup" replace /> : <Protected availableRelease={availableRelease} />} />
    </Routes>
  );
}
