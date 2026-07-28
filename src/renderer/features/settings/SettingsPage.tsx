import React from 'react';
import clsx from 'clsx';
import {
  Save, RotateCcw, Check, Mail, Link2, Unlink, ShieldCheck, Info, UserCog, UserPlus,
  KeyRound, Copy, HardDrive, FolderOpen, Lock, Pencil, Palette, Building2, Plug,
  Database, Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { platform } from '../../platform';
import type { OrgSettings, User } from '@shared/types';
import { JURISDICTIONS, ROLE_LABELS, ROLES } from '@shared/constants';
import type { Role } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassPanel, GlassButton, GlassInput, GlassSelect, GlassBadge, Field, Spinner } from '../../components/glass';
import { useTheme } from '../../store/theme';
import { useAuth, can } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import {
  workspaceBridge, workspaceInfo, chooseWorkspacePath, type WorkspaceInfo,
} from '../../platform/workspace';

type TabKey = 'workspace' | 'appearance' | 'organization' | 'integrations' | 'users';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'workspace', label: 'Workspace', icon: HardDrive },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'organization', label: 'Organization', icon: Building2 },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'users', label: 'Users', icon: UserCog },
];

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-capsule border border-line bg-[var(--pf-surface)] p-1">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={clsx(
            'rounded-capsule px-3 py-1.5 text-sm font-medium transition-all focus-ring',
            value === val ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// -----------------------------------------------------------------------------
// Storage usage indicator: size of the persisted workspace plus record counts
// and (in the browser preview) headroom against the localStorage quota.
// -----------------------------------------------------------------------------
interface StorageStats {
  bytes: number;
  cases: number;
  projects: number;
  audit: number;
  users: number;
}

function StorageSection({ info }: { info: WorkspaceInfo | null }) {
  const [stats, setStats] = React.useState<StorageStats | null>(null);

  React.useEffect(() => {
    (async () => {
      const [cases, projects, audit, users] = await Promise.all([
        platform().cases.list(),
        platform().projects.list(),
        platform().audit.list(),
        platform().auth.listUsers(),
      ]);
      // UTF-16 code units * 2 bytes approximates localStorage quota usage.
      const raw = localStorage.getItem('privacyflow.db.v1') ?? '';
      setStats({
        bytes: raw.length * 2,
        cases: cases.length,
        projects: projects.length,
        audit: audit.length,
        users: users.length,
      });
    })();
  }, []);

  if (!stats) return null;

  const isDesktop = !!workspaceBridge();
  const QUOTA = 10 * 1024 * 1024; // typical localStorage budget in the preview
  const pct = isDesktop ? 0 : Math.min(100, Math.round((stats.bytes / QUOTA) * 100));
  const tone = pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400';

  const counts: [string, number][] = [
    ['Requests', stats.cases],
    ['Projects', stats.projects],
    ['Audit events', stats.audit],
    ['Users', stats.users],
  ];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line px-4 py-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-accent" />
        <h4 className="text-sm font-semibold text-ink">Storage usage</h4>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-[var(--pf-highlight)] px-3 py-2.5">
            <p className="text-lg font-bold text-ink">{value.toLocaleString()}</p>
            <p className="text-[11px] text-muted">{label}</p>
          </div>
        ))}
      </div>

      {isDesktop ? (
        <p className="text-xs text-muted">
          The workspace lives in a single JSON file at{' '}
          <span className="font-mono text-ink">{info?.dbPath ?? '…'}</span>. There's no fixed
          quota on the network share — the file stays fast well past 10,000 records.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              Database size: <span className={`font-semibold ${tone}`}>{fmtBytes(stats.bytes)}</span>
            </span>
            <span className="text-muted">of ~{fmtBytes(QUOTA)} browser quota</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--pf-highlight)]">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500',
              )}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted">
            {pct < 70
              ? 'Plenty of headroom — the preview comfortably holds a few thousand requests with full audit history.'
              : pct < 90
                ? 'Usage is getting high. Export a report, then consider Settings → Organization → Reset application to reclaim space.'
                : 'Nearly full. New changes may stop saving — export your data and reset the application.'}
          </p>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Workspace section: shared database location, lock holder, and storage usage.
// -----------------------------------------------------------------------------
function WorkspaceTab() {
  const [info, setInfo] = React.useState<WorkspaceInfo | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    workspaceInfo().then(setInfo);
  }, []);

  const isDesktop = !!workspaceBridge();

  async function changePath() {
    setBusy(true);
    try {
      const result = await chooseWorkspacePath();
      if (result?.changed) {
        window.alert('Workspace location changed. The app will now reload from the new location.');
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  const lockState = info?.lockState;
  const holder = lockState?.mode === 'read-only' ? lockState.holder : null;

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Location &amp; lock</h3>
          </div>
          {isDesktop && lockState && (
            <GlassBadge tone={lockState.mode === 'write' ? 'success' : 'warn'}>
              {lockState.mode === 'write' ? 'You can edit' : 'Read-only'}
            </GlassBadge>
          )}
        </div>

        {!isDesktop ? (
          <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <p className="text-xs text-muted">
              This browser preview stores data in your browser's local storage. In the packaged
              desktop app this section shows the shared workspace file on your firm network share,
              who currently holds the edit lock, and lets you change the workspace folder.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
              <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">Database file</p>
                <p className="break-all font-mono text-sm text-ink">{info?.dbPath ?? '…'}</p>
              </div>
              <GlassButton className="px-3 py-1.5 text-xs" loading={busy} onClick={changePath}>
                <Pencil className="h-3.5 w-3.5" /> Change folder…
              </GlassButton>
            </div>

            {holder ? (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                <Lock className="h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-ink">
                    {holder.user} on {holder.machine} is currently editing
                  </p>
                  <p className="text-xs text-muted">
                    Lock held since {fmtDateTime(holder.since)} — your changes are disabled until
                    they close the app. Other users who open the app see it read-only.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">
                This instance holds the edit lock, so your team sees the workspace as read-only
                while you have the app open. Close the app to let a colleague edit. To share the
                workspace, point every install at the same folder on your network share.
              </p>
            )}
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <StorageSection info={info} />
      </GlassPanel>
    </div>
  );
}

export function SettingsPage() {
  const theme = useTheme();
  const { user, init } = useAuth();
  const [tab, setTab] = React.useState<TabKey>('workspace');
  const [settings, setSettings] = React.useState<OrgSettings | null>(null);
  const [users, setUsers] = React.useState<User[]>([]);
  const [saved, setSaved] = React.useState(false);
  const [userError, setUserError] = React.useState('');

  // M365 connect form state
  const [connecting, setConnecting] = React.useState(false);
  const [m365Email, setM365Email] = React.useState('');
  const [m365Tenant, setM365Tenant] = React.useState('');
  const [m365Error, setM365Error] = React.useState('');

  // Add-user form state
  const [addingUser, setAddingUser] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newUsername, setNewUsername] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('privacy_analyst');
  const [addError, setAddError] = React.useState('');
  const [addBusy, setAddBusy] = React.useState(false);
  const [issuedCredentials, setIssuedCredentials] = React.useState<{ username: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    platform().system.settings().then(setSettings);
    platform().auth.listUsers().then(setUsers);
  }, []);

  if (!settings) return <Spinner label="Loading settings…" />;

  const editable = can(user?.role, 'settings.manage');
  const canManageUsers = can(user?.role, 'users.manage');
  const m365 = settings.m365;

  async function save() {
    const s = await platform().system.updateSettings(settings!);
    setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  async function reset() {
    if (window.confirm(
      'Reset the application? This permanently deletes ALL requests, projects, users, settings, and the audit trail, then restarts the setup wizard. Export a report first if you need to keep anything.',
    )) {
      await platform().system.resetApplication();
      window.location.reload();
    }
  }

  async function changeRole(target: User, role: Role) {
    if (role === target.role) return;
    setUserError('');
    try {
      const updated = await platform().auth.updateUser(target.id, { role });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Unable to update role.');
    }
  }

  async function toggleActive(target: User) {
    setUserError('');
    try {
      const updated = await platform().auth.updateUser(target.id, { active: !target.active });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      // If the signed-in user was somehow deactivated, refresh the session.
      if (!updated.active && updated.id === user?.id) await init();
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Unable to update account.');
    }
  }

  async function deleteUser(target: User) {
    if (!window.confirm(
      `Delete ${target.name} (@${target.username})? Their account is removed permanently. ` +
      'Requests they owned become unassigned; past activity stays in the audit trail.',
    )) return;
    setUserError('');
    try {
      await platform().auth.deleteUser(target.id);
      setUsers((list) => list.filter((x) => x.id !== target.id));
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Unable to delete user.');
    }
  }

  async function createUser(ev: React.FormEvent) {
    ev.preventDefault();
    setAddError('');
    setAddBusy(true);
    try {
      const { user: created, tempPassword } = await platform().auth.createUser({
        name: newName,
        username: newUsername,
        role: newRole,
      });
      setUsers((list) => [...list, created]);
      setAddingUser(false);
      setNewName('');
      setNewUsername('');
      setNewRole('privacy_analyst');
      // Show the generated temporary password ONCE for the admin to share.
      setIssuedCredentials({ username: created.username, tempPassword });
      setCopied(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Unable to create user.');
    } finally {
      setAddBusy(false);
    }
  }

  async function copyTempPassword() {
    if (!issuedCredentials) return;
    try {
      await navigator.clipboard.writeText(issuedCredentials.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (e.g. insecure context); user can copy manually.
    }
  }

  async function connectM365() {
    if (!/.+@.+\..+/.test(m365Email)) {
      setM365Error('Enter a valid Microsoft 365 mailbox address (e.g. privacy@contoso.com).');
      return;
    }
    setM365Error('');
    const s = await platform().system.updateSettings({
      m365: {
        connected: true,
        accountEmail: m365Email.trim(),
        tenantId: m365Tenant.trim() || undefined,
        connectedAt: new Date().toISOString(),
        connectedBy: user?.name,
        mode: 'simulated',
      },
    });
    setSettings(s);
    setConnecting(false);
    setM365Email('');
    setM365Tenant('');
  }

  async function disconnectM365() {
    if (!window.confirm('Disconnect Microsoft 365? Automated emails will be logged locally instead of sent.')) return;
    const s = await platform().system.updateSettings({ m365: { connected: false, mode: 'simulated' } });
    setSettings(s);
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace, appearance, organization, integrations, and user management." />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-capsule px-3 py-1.5 text-sm font-medium transition-all focus-ring',
              tab === key ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'workspace' && <WorkspaceTab />}

      {tab === 'appearance' && (
        <GlassPanel className="max-w-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Theme</span>
              <Seg value={theme.theme} onChange={theme.setTheme} options={[['dark', 'Dark'], ['light', 'Light']]} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Contrast</span>
              <Seg value={theme.contrast} onChange={theme.setContrast} options={[['normal', 'Normal'], ['high', 'High']]} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Transparency</span>
              <Seg value={theme.transparency} onChange={theme.setTransparency} options={[['on', 'On'], ['off', 'Reduced']]} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Motion</span>
              <Seg value={theme.motion} onChange={theme.setMotion} options={[['on', 'On'], ['off', 'Reduced']]} />
            </div>
          </div>
        </GlassPanel>
      )}

      {tab === 'organization' && (
        <GlassPanel className="max-w-2xl">
          <div className="flex flex-col gap-3">
            <Field label="Organization name">
              <GlassInput disabled={!editable} value={settings.organizationName} onChange={(e) => setSettings({ ...settings, organizationName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Case number prefix">
                <GlassInput disabled={!editable} value={settings.caseNumberPrefix} onChange={(e) => setSettings({ ...settings, caseNumberPrefix: e.target.value })} />
              </Field>
              <Field label="Auto-lock (minutes)">
                <GlassInput disabled={!editable} type="number" value={settings.autoLockMinutes} onChange={(e) => setSettings({ ...settings, autoLockMinutes: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Default jurisdiction">
              <GlassSelect disabled={!editable} value={settings.defaultJurisdiction} onChange={(e) => setSettings({ ...settings, defaultJurisdiction: e.target.value })}>
                {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
              </GlassSelect>
            </Field>
            {editable && (
              <div className="flex items-center gap-2 pt-1">
                <GlassButton variant="primary" onClick={save}>
                  {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />} {saved ? 'Saved' : 'Save changes'}
                </GlassButton>
                <GlassButton variant="danger" onClick={reset}>
                  <RotateCcw className="h-4 w-4" /> Reset application
                </GlassButton>
              </div>
            )}
            {editable && (
              <p className="text-[11px] text-muted">
                Reset application permanently deletes all requests, projects, users, settings, and
                the audit trail, then restarts the first-run setup wizard.
              </p>
            )}
          </div>
        </GlassPanel>
      )}

      {tab === 'integrations' && (
        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Microsoft 365 (Outlook)</h3>
            </div>
            <GlassBadge tone={m365.connected ? 'success' : 'neutral'}>
              {m365.connected ? 'Connected' : 'Not connected'}
            </GlassBadge>
          </div>

          {m365.connected ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    Sending as <span className="text-accent">{m365.accountEmail}</span>
                  </p>
                  <p className="text-xs text-muted">
                    Connected {fmtDateTime(m365.connectedAt)}{m365.connectedBy ? ` by ${m365.connectedBy}` : ''}
                    {m365.tenantId ? ` · Tenant ${m365.tenantId}` : ''}
                    {m365.mode === 'simulated' ? ' · Simulated delivery (browser preview)' : ''}
                  </p>
                </div>
                {editable && (
                  <GlassButton variant="ghost" onClick={disconnectM365}>
                    <Unlink className="h-4 w-4" /> Disconnect
                  </GlassButton>
                )}
              </div>
              <p className="text-xs text-muted">
                Automated template emails (Automation tab) are now sent from this mailbox via Microsoft Graph
                <code className="text-accent"> sendMail</code> — both to data subject requesters and as forwards
                to internal departments. Every send is still logged on the request's Communications tab and in
                the audit trail.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Connect a Microsoft 365 mailbox so automated template emails (request acknowledgements,
                identity-verification requests, department search forwards, fulfilment notices) are actually
                sent and forwarded from Outlook instead of only being logged.
              </p>

              {!connecting ? (
                <div>
                  <GlassButton variant="primary" disabled={!editable} onClick={() => setConnecting(true)}>
                    <Link2 className="h-4 w-4" /> Connect Microsoft 365
                  </GlassButton>
                  {!editable && <p className="mt-2 text-xs text-muted">Only administrators and privacy managers can connect integrations.</p>}
                </div>
              ) : (
                <div className="flex max-w-lg flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
                  <p className="text-sm font-semibold text-ink">Connect a mailbox</p>
                  <Field label="Microsoft 365 mailbox" hint="The shared mailbox automated emails are sent from.">
                    <GlassInput
                      type="email"
                      placeholder="privacy@contoso.com"
                      value={m365Email}
                      onChange={(e) => setM365Email(e.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field label="Tenant ID (optional)" hint="Your Microsoft Entra tenant — needed for single-tenant app registrations.">
                    <GlassInput
                      placeholder="e.g. 72f988bf-86f1-41af-91ab-2d7cd011db47"
                      value={m365Tenant}
                      onChange={(e) => setM365Tenant(e.target.value)}
                    />
                  </Field>
                  {m365Error && <p className="text-xs text-red-400">{m365Error}</p>}
                  <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <p className="text-[11px] text-muted">
                      In the packaged desktop app this opens the Microsoft sign-in consent screen (MSAL) and
                      requests the <code className="text-accent">Mail.Send</code> scope. This browser preview
                      can't reach the internet, so the connection is recorded in simulated mode — sends are
                      logged exactly as they would be delivered.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <GlassButton onClick={() => { setConnecting(false); setM365Error(''); }}>Cancel</GlassButton>
                    <GlassButton variant="primary" onClick={connectM365}>
                      <Link2 className="h-4 w-4" /> Connect
                    </GlassButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </GlassPanel>
      )}

      {tab === 'users' && (
        <GlassPanel>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Users</h3>
            </div>
            {canManageUsers ? (
              !addingUser && (
                <GlassButton variant="primary" className="px-3 py-1.5 text-xs" onClick={() => { setAddingUser(true); setAddError(''); setIssuedCredentials(null); }}>
                  <UserPlus className="h-3.5 w-3.5" /> Add user
                </GlassButton>
              )
            ) : (
              <p className="text-xs text-muted">Only administrators can add users, assign roles, or deactivate accounts.</p>
            )}
          </div>
          {userError && <p className="mb-3 text-xs text-red-400">{userError}</p>}

          {issuedCredentials && (
            <div className="mb-4 flex max-w-2xl flex-col gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-emerald-400" />
                <p className="text-sm font-semibold text-ink">
                  Temporary password for <span className="text-accent">@{issuedCredentials.username}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-2 font-mono text-sm text-ink">
                  {issuedCredentials.tempPassword}
                </code>
                <GlassButton variant="subtle" className="px-3 py-2 text-xs" onClick={copyTempPassword}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </GlassButton>
              </div>
              <p className="text-[11px] text-muted">
                Shown once — only the salted hash is stored. Share this with the new user through a secure
                channel; they'll be required to set their own password at first sign-in.
              </p>
              <div className="flex justify-end">
                <GlassButton variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setIssuedCredentials(null)}>
                  Dismiss
                </GlassButton>
              </div>
            </div>
          )}

          {addingUser && canManageUsers && (
            <form onSubmit={createUser} className="mb-4 flex max-w-2xl flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
              <p className="text-sm font-semibold text-ink">Add a new user</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Full name">
                  <GlassInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Jordan Reyes" autoFocus />
                </Field>
                <Field label="Username" hint="Lowercase letters, numbers, dots, dashes, underscores.">
                  <GlassInput value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. jreyes" />
                </Field>
                <Field label="Role">
                  <GlassSelect value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </GlassSelect>
                </Field>
              </div>
              {addError && <p className="text-xs text-red-400">{addError}</p>}
              <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <p className="text-[11px] text-muted">
                  A temporary password is generated automatically and shown to you once after creation. The new
                  user signs in with it and is required to set their own password before gaining access.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <GlassButton type="button" onClick={() => { setAddingUser(false); setAddError(''); }}>Cancel</GlassButton>
                <GlassButton type="submit" variant="primary" loading={addBusy} disabled={!newName.trim() || !newUsername.trim()}>
                  <UserPlus className="h-4 w-4" /> Create user
                </GlassButton>
              </div>
            </form>
          )}

          <div className="content-surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--pf-surface-2)]">
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  {canManageUsers && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="border-b border-line/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{u.name}{isSelf && <span className="ml-2 text-[10px] text-muted">(you)</span>}</p>
                        <p className="text-[11px] text-muted">@{u.username}</p>
                      </td>
                      <td className="px-4 py-3">
                        {canManageUsers && !isSelf ? (
                          <GlassSelect
                            className="w-44 px-2 py-1.5 text-xs"
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value as Role)}
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </GlassSelect>
                        ) : (
                          <GlassBadge tone="info">{ROLE_LABELS[u.role]}</GlassBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <GlassBadge tone={u.active ? 'success' : 'danger'}>
                          {u.active ? 'Active' : 'Deactivated'}
                        </GlassBadge>
                      </td>
                      {canManageUsers && (
                        <td className="px-4 py-3">
                          {!isSelf && (
                            <div className="flex items-center gap-1.5">
                              <GlassButton
                                variant={u.active ? 'ghost' : 'subtle'}
                                className="px-3 py-1 text-xs"
                                onClick={() => toggleActive(u)}
                              >
                                {u.active ? 'Deactivate' : 'Reactivate'}
                              </GlassButton>
                              <GlassButton
                                variant="ghost"
                                className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                                title={`Delete ${u.name}`}
                                onClick={() => deleteUser(u)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </GlassButton>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            New users, role changes, deactivations, and deletions take effect immediately and are
            recorded in the audit trail. You cannot change your own role, deactivate, or delete your
            own account, and the workspace always keeps at least one administrator.
          </p>
        </GlassPanel>
      )}
    </div>
  );
}