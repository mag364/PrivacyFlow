import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { platform } from './platform';
import { refreshLockState } from './platform/workspace';
import { useAuth } from './store/auth';
import { AppShell } from './layouts/AppShell';
import { Spinner } from './components/glass';
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
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { AuditPage } from './features/audit/AuditPage';
import { SettingsPage } from './features/settings/SettingsPage';

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid h-screen w-screen place-items-center">{children}</div>;
}

function Protected() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/year/:year" element={<CasesPage />} />
        <Route path="/cases/new" element={<NewCasePage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/year/:year" element={<TasksPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
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