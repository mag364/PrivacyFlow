import React from 'react';
import { useNavigate } from 'react-router-dom';
import { platform } from '../../platform';
import { JURISDICTIONS } from '@shared/constants';
import { APP_CONFIG } from '@shared/config';
import { GlassButton, GlassInput, GlassSelect, GlassPanel, Field } from '../../components/glass';
import { chooseWorkspacePath, workspaceBridge, workspaceInfo, type WorkspaceInfo } from '../../platform/workspace';
import privacyFlowIcon from '../../assets/privacyflow-icon.png';

export function SetupPage({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const [organizationName, setOrg] = React.useState(APP_CONFIG.defaults.organizationName);
  const [caseNumberPrefix, setPrefix] = React.useState(APP_CONFIG.defaults.caseNumberPrefix);
  const [defaultJurisdiction, setJur] = React.useState<string>(APP_CONFIG.defaults.defaultJurisdiction);
  const [demoDataInstalled, setDemo] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [workspace, setWorkspace] = React.useState<WorkspaceInfo | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = React.useState(false);
  const [workspaceMessage, setWorkspaceMessage] = React.useState('');

  React.useEffect(() => {
    workspaceInfo().then(setWorkspace);
  }, []);

  async function changeWorkspace() {
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const result = await chooseWorkspacePath();
      if (result) {
        setWorkspace({ dbPath: result.dbPath, lockState: result.lockState });
        const raw = workspaceBridge()?.read();
        if (raw) {
          try {
            const existing = JSON.parse(raw) as { settings?: { setupComplete?: boolean } };
            if (existing.settings?.setupComplete) {
              window.alert('Existing PrivacyFlow database selected. The app will reload from that workspace.');
              window.location.reload();
              return;
            }
          } catch {
            // If the file is not readable JSON, leave setup on screen so Finish can initialize it.
          }
        }
        setWorkspaceMessage(
          result.changed
            ? 'Database location selected. Finish setup to initialize this workspace, or restart if you selected an existing PrivacyFlow database.'
            : 'This database location is already selected.',
        );
      }
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    await platform().system.completeSetup({
      organizationName, caseNumberPrefix, defaultJurisdiction, demoDataInstalled,
    });
    setBusy(false);
    onDone?.();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <GlassPanel className="w-full max-w-lg p-7">
        <div className="mb-5 flex items-center gap-3">
          <img src={privacyFlowIcon} alt="" className="h-11 w-11 rounded-2xl object-cover shadow-glass" />
          <div>
            <h1 className="text-xl font-bold text-ink">Welcome to {APP_CONFIG.productName}</h1>
            <p className="text-sm text-muted">A few details to configure your workspace.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {workspaceBridge() && (
            <div className="rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Database file</p>
                  <p className="break-all font-mono text-xs text-ink">{workspace?.dbPath ?? 'Loading workspace location…'}</p>
                </div>
                <GlassButton loading={workspaceBusy} onClick={changeWorkspace}>
                  Change folder…
                </GlassButton>
              </div>
              {workspaceMessage && <p className="mt-2 text-[11px] text-muted">{workspaceMessage}</p>}
            </div>
          )}

          <Field label="Organization name">
            <GlassInput value={organizationName} onChange={(e) => setOrg(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Case number prefix">
              <GlassInput value={caseNumberPrefix} onChange={(e) => setPrefix(e.target.value)} />
            </Field>
            <Field label="Default jurisdiction">
              <GlassSelect value={defaultJurisdiction} onChange={(e) => setJur(e.target.value)}>
                {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
              </GlassSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-2.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 focus-ring" checked={demoDataInstalled} onChange={(e) => setDemo(e.target.checked)} />
            Install fictional demonstration data (recommended for exploring the app)
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <GlassButton variant="primary" loading={busy} onClick={finish}>
            Finish setup
          </GlassButton>
        </div>
        <p className="mt-4 text-xs text-muted">{APP_CONFIG.disclaimer}</p>
      </GlassPanel>
    </div>
  );
}
