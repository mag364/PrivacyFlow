import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { platform } from './platform';
import { refreshLockState } from './platform/workspace';
import { can, useAuth } from './store/auth';
import { AppShell, PageHeader } from './layouts/AppShell';
import { GlassPanel, Spinner } from './components/glass';
import type { Permission } from '@shared/constants';
import { LoginPage } from './features/auth/LoginPage';
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

function Protected() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppShell>
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
        <Route path="/automation" element={<RequirePermission anyOf={['settings.manage']}><AutomationPage /></RequirePermission>} />
        <Route path="/audit" element={<RequirePermission anyOf={['audit.view']}><AuditPage /></RequirePermission>} />
        <Route path="/settings" element={<RequirePermission anyOf={['settings.manage', 'users.manage']}><SettingsPage /></RequirePermission>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const { init } = useAuth();
  const [booted, setBooted] = React.useState(false);
  const [needsSetup, setNeedsSetup] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      // Resolve the shared-workspace lock state first so the platform layer
      // knows whether this instance may write before any data is touched.
      await refreshLockState();
      const settings = await platform().system.settings();
      setNeedsSetup(!settings.setupComplete);
      await init();
      setBooted(true);
    })();
  }, [init]);

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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={needsSetup ? <Navigate to="/setup" replace /> : <Protected />} />
    </Routes>
  );
}
