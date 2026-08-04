import React from 'react';
import clsx from 'clsx';
import {
  Save, RotateCcw, Check, Mail, Link2, Unlink, ShieldCheck, Info, UserCog, UserPlus,
  KeyRound, Copy, HardDrive, FolderOpen, Lock, Pencil, Palette, Building2, Plug,
  Database, Trash2, RefreshCw, Download, ExternalLink, AlertTriangle, PackageCheck,
  Upload, FileJson, DatabaseBackup, ArchiveRestore,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { platform } from '../../platform';
import type { OrgSettings, User } from '@shared/types';
import { ROLE_LABELS, ROLES } from '@shared/constants';
import type { Role } from '@shared/constants';
import { PageHeader } from '../../layouts/AppShell';
import { GlassPanel, GlassButton, GlassInput, GlassSelect, GlassBadge, Field, Spinner } from '../../components/glass';
import { useTheme } from '../../store/theme';
import { useAuth, can } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import {
  workspaceBridge, updaterBridge, workspaceInfo, chooseWorkspacePath, syncWorkspaceNow, type WorkspaceInfo,
  outlookBridge, mailBridge, graphBridge, backupBridge, type BackupEntry, type ApplicationFolderInfo,
} from '../../platform/workspace';
import { APP_CONFIG } from '@shared/config';
import type { ImportSummary } from '../../platform/types';
import {
  caseInputFromRow, privacyFlowPayloadFromJson, projectInputFromRow, rowsFromFile,
} from '../../lib/importers';

type TabKey = 'workspace' | 'appearance' | 'organization' | 'integrations' | 'import_export' | 'backup_restore' | 'users';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'workspace', label: 'Workspace', icon: HardDrive },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'organization', label: 'Organization', icon: Building2 },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'import_export', label: 'Import & Export', icon: Upload },
  { key: 'backup_restore', label: 'Backup / Restore', icon: DatabaseBackup },
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

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; release: GitHubRelease; asset: GitHubReleaseAsset }
  | { status: 'downloaded'; release: GitHubRelease; fileName: string; mode?: 'automatic' | 'download-only' }
  | { status: 'no_release' }
  | { status: 'current'; release: GitHubRelease }
  | { status: 'available'; release: GitHubRelease; asset: GitHubReleaseAsset }
  | { status: 'error'; message: string };

interface GitHubReleaseAsset {
  name: string;
  url: string;
  browser_download_url: string;
  size?: number;
}

interface GitHubRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubReleaseAsset[];
}

const UPDATE_TOKEN_KEY = 'privacyflow.github.updateToken';

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
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

function preferredReleaseAsset(release: GitHubRelease): GitHubReleaseAsset | null {
  const assets = release.assets ?? [];
  const preferred =
    assets.find((asset) => /PrivacyFlow-.*-x64-folder\.zip$/i.test(asset.name)) ??
    assets.find((asset) => /PrivacyFlow-.*-x64-portable\.exe$/i.test(asset.name)) ??
    assets.find((asset) => /\.(exe|msi|dmg|pkg|appimage|deb|rpm|zip)$/i.test(asset.name));
  return preferred ?? assets[0] ?? null;
}

function readStoredUpdateToken(): string {
  try {
    return localStorage.getItem(UPDATE_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredUpdateToken(token: string): void {
  try {
    if (token.trim()) localStorage.setItem(UPDATE_TOKEN_KEY, token.trim());
    else localStorage.removeItem(UPDATE_TOKEN_KEY);
  } catch {
    // Ignore storage errors; the token can still be used for the current check.
  }
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

function UpdateSection() {
  const [state, setState] = React.useState<UpdateState>({ status: 'idle' });
  const [token, setToken] = React.useState(() => readStoredUpdateToken());
  const [rememberToken, setRememberToken] = React.useState(() => !!readStoredUpdateToken());
  const [appFolder, setAppFolder] = React.useState<ApplicationFolderInfo | null>(null);
  const [folderBusy, setFolderBusy] = React.useState(false);

  const currentVersion = APP_CONFIG.version;
  const release =
    state.status === 'current' ||
    state.status === 'available' ||
    state.status === 'downloading' ||
    state.status === 'downloaded'
      ? state.release
      : null;
  const needsTokenHelp = state.status === 'error' && /private repository|access|token/i.test(state.message);

  React.useEffect(() => {
    let cancelled = false;
    const desktopUpdater = updaterBridge();
    if (!desktopUpdater?.getApplicationFolder) return;
    desktopUpdater.getApplicationFolder()
      .then((info) => {
        if (!cancelled) setAppFolder(info);
      })
      .catch(() => {
        if (!cancelled) setAppFolder(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseApplicationFolder() {
    const desktopUpdater = updaterBridge();
    if (!desktopUpdater?.chooseApplicationFolder) return;
    setFolderBusy(true);
    try {
      const selected = await desktopUpdater.chooseApplicationFolder();
      if (selected) setAppFolder(selected);
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Unable to choose the application folder.' });
    } finally {
      setFolderBusy(false);
    }
  }

  async function checkForUpdates() {
    setState({ status: 'checking' });
    try {
      const trimmedToken = token.trim();
      const res = await fetch(APP_CONFIG.updates.latestReleaseUrl, {
        headers: githubHeaders(trimmedToken),
      });

      if (res.status === 404) {
        const releasesRes = await fetch(APP_CONFIG.updates.releasesApiUrl, {
          headers: githubHeaders(trimmedToken),
        });
        if (releasesRes.ok) {
          const releases = await releasesRes.json() as GitHubRelease[];
          if (Array.isArray(releases) && releases.length === 0) {
            if (rememberToken) writeStoredUpdateToken(trimmedToken);
            else writeStoredUpdateToken('');
            setState({ status: 'no_release' });
            return;
          }
        }
      }

      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new Error(
          'Unable to read GitHub releases. If the repository is private again, provide a fine-grained GitHub token with repository Contents read access.',
        );
      }
      if (!res.ok) throw new Error(`GitHub release check failed with HTTP ${res.status}.`);

      const latest = await res.json() as GitHubRelease;
      if (!latest.tag_name || latest.draft) throw new Error('No published release was found.');
      if (rememberToken) writeStoredUpdateToken(trimmedToken);
      else writeStoredUpdateToken('');

      if (isNewerVersion(latest.tag_name, currentVersion)) {
        const asset = preferredReleaseAsset(latest);
        if (!asset) throw new Error('The latest release has no downloadable asset attached.');
        setState({ status: 'available', release: latest, asset });
      } else {
        setState({ status: 'current', release: latest });
      }
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Unable to check for updates.' });
    }
  }

  async function downloadUpdate() {
    if (state.status !== 'available') {
      window.open(release?.html_url ?? APP_CONFIG.updates.releasesUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const trimmedToken = token.trim();

    const { release: availableRelease, asset } = state;
    if (updaterBridge() && /\.zip$/i.test(asset.name)) {
      const confirmed = window.confirm(
        'Before updating, close PrivacyFlow on every other PC using this shared application folder. Continue with the update?',
      );
      if (!confirmed) return;
    }
    setState({ status: 'downloading', release: availableRelease, asset });
    try {
      const desktopUpdater = updaterBridge();
      if (desktopUpdater) {
        const result = desktopUpdater.applyReleaseAsset
          ? await desktopUpdater.applyReleaseAsset({
            assetApiUrl: asset.url,
            token: trimmedToken || undefined,
            fileName: asset.name,
            appFolder: appFolder?.folderPath,
          })
          : await desktopUpdater.downloadReleaseAsset({
          assetApiUrl: asset.url,
          token: trimmedToken || undefined,
          fileName: asset.name,
        });
        setState({
          status: 'downloaded',
          release: availableRelease,
          fileName: asset.name,
          mode: 'mode' in result ? result.mode : 'download-only',
        });
        return;
      }

      const res = await fetch(trimmedToken ? asset.url : asset.browser_download_url, {
        headers: {
          Accept: trimmedToken ? 'application/octet-stream' : 'application/octet-stream',
          ...(trimmedToken ? { Authorization: `Bearer ${trimmedToken}` } : {}),
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) throw new Error(`Update download failed with HTTP ${res.status}.`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = asset.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState({ status: 'downloaded', release: availableRelease, fileName: asset.name });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Unable to download the update.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-accent" />
          <div>
            <h4 className="text-sm font-semibold text-ink">Update</h4>
            <p className="text-xs text-muted">Current version {currentVersion}</p>
          </div>
        </div>
        {state.status === 'available' && <GlassBadge tone="warn">Update available</GlassBadge>}
        {state.status === 'downloading' && <GlassBadge tone="info">Downloading</GlassBadge>}
        {state.status === 'downloaded' && <GlassBadge tone="success">Downloaded</GlassBadge>}
        {state.status === 'current' && <GlassBadge tone="success">Up to date</GlassBadge>}
        {state.status === 'no_release' && <GlassBadge tone="neutral">No releases</GlassBadge>}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Field
          label="GitHub token"
          hint="Optional for public releases. Use only if the repository is private again. Stored only in this browser when Remember is enabled."
        >
          <GlassInput
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
          />
        </Field>
        <label className="flex items-center gap-2 self-end rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 focus-ring"
            checked={rememberToken}
            onChange={(e) => {
              setRememberToken(e.target.checked);
              if (!e.target.checked) writeStoredUpdateToken('');
            }}
          />
          Remember
        </label>
      </div>

      {updaterBridge() && (
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <Field
            label="Application folder"
            hint="Choose the extracted PrivacyFlow folder that contains PrivacyFlow.exe. Automatic ZIP updates replace this folder after the app closes."
          >
            <GlassInput
              value={appFolder?.folderPath ?? ''}
              readOnly
              placeholder="Choose the extracted PrivacyFlow folder"
            />
            {appFolder && !appFolder.valid && (
              <p className="mt-1 text-[11px] text-red-200">{appFolder.message}</p>
            )}
          </Field>
          <GlassButton variant="subtle" loading={folderBusy} onClick={chooseApplicationFolder} className="self-end">
            <FolderOpen className="h-4 w-4" /> Choose folder
          </GlassButton>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <GlassButton loading={state.status === 'checking'} onClick={checkForUpdates}>
          <RefreshCw className="h-4 w-4" /> Check for updates
        </GlassButton>
        <GlassButton
          variant={state.status === 'available' ? 'primary' : 'subtle'}
          loading={state.status === 'downloading'}
          onClick={downloadUpdate}
          disabled={state.status === 'checking'}
        >
          {state.status === 'available' ? <Download className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
          {state.status === 'available' || state.status === 'downloading' ? 'Update application' : 'Open releases'}
        </GlassButton>
      </div>

      {release && (
        <div className="rounded-xl bg-[var(--pf-highlight)] px-3 py-2 text-xs text-muted">
          Latest release: <span className="font-semibold text-ink">{release.tag_name}</span>
          {release.name ? ` · ${release.name}` : ''}
          {release.published_at ? ` · Published ${fmtDateTime(release.published_at)}` : ''}
        </div>
      )}

      {state.status === 'no_release' && (
        <div className="rounded-xl bg-[var(--pf-highlight)] px-3 py-2 text-xs text-muted">
          No published GitHub releases exist for {APP_CONFIG.updates.owner}/{APP_CONFIG.updates.repo} yet.
          Publish a release with a version tag such as v{currentVersion}, then this checker can compare future releases.
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <p className="text-xs text-red-200">
            {state.message}
            {needsTokenHelp ? ' A token is only needed for private releases and should be scoped to this repository with Contents: Read-only.' : ''}
          </p>
        </div>
      )}

      {state.status === 'available' && (
        <p className="text-[11px] text-muted">
          Close PrivacyFlow on every other PC before updating a shared application folder. The updater downloads the Windows ZIP,
          waits for application files to be released, applies the update, and reopens PrivacyFlow automatically.
        </p>
      )}
      {state.status === 'downloaded' && (
        <p className="text-[11px] text-muted">
          {state.mode === 'automatic'
            ? `Downloaded ${state.fileName}. PrivacyFlow will close and the updater will apply it to the selected folder.`
            : `Downloaded ${state.fileName}. If Windows did not open it automatically, open it from your Downloads folder. Close PrivacyFlow, extract the ZIP if needed, and run PrivacyFlow.exe from the updated folder.`}
        </p>
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
  const [syncBusy, setSyncBusy] = React.useState(false);

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

  async function syncNow() {
    setSyncBusy(true);
    try {
      const next = await syncWorkspaceNow();
      if (next) setInfo(next);
    } catch {
      const next = await workspaceInfo();
      if (next) setInfo(next);
    } finally {
      setSyncBusy(false);
    }
  }

  const lockState = info?.lockState;
  const holder = lockState?.mode === 'read-only' ? lockState.holder : null;
  const sync = info?.sync;
  const syncLabel = sync?.status === 'synced'
    ? 'Synced'
    : sync?.status === 'pending'
      ? 'Sync pending'
      : sync?.status === 'syncing'
        ? 'Syncing'
        : sync?.status === 'failed'
          ? 'Shared sync failed'
          : sync?.status === 'local-only'
            ? 'Local cache only'
            : sync?.status === 'read-only'
              ? 'Read-only'
              : 'Direct shared file';

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
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted">
                  This instance holds the edit lock, so your team sees the workspace as read-only
                  while you have the app open. Close the app to let a colleague edit. To share the
                  workspace, point every install at the same folder on your network share.
                </p>
                {sync && (
                  <div className="rounded-xl border border-line bg-[var(--pf-highlight)] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {sync.mode === 'local-cache' ? 'Local cache with shared sync' : 'Shared workspace sync'} · {syncLabel}
                        </p>
                        <p className="text-xs text-muted">
                          {sync.mode === 'local-cache'
                            ? 'PrivacyFlow works from a local cache for speed and syncs changes back to the shared drive while the edit lock is held.'
                            : 'PrivacyFlow is writing directly to the local workspace file.'}
                          {sync.lastSyncedAt ? ` Last synced ${fmtDateTime(sync.lastSyncedAt)}.` : ''}
                        </p>
                        {sync.localCachePath && (
                          <p className="mt-1 break-all font-mono text-[11px] text-muted">Cache: {sync.localCachePath}</p>
                        )}
                        {sync.lastError && <p className="mt-1 text-xs text-red-300">{sync.lastError}</p>}
                      </div>
                      {sync.mode === 'local-cache' && (
                        <GlassButton className="px-3 py-1.5 text-xs" loading={syncBusy} onClick={syncNow}>
                          <RefreshCw className="h-3.5 w-3.5" /> Sync now
                        </GlassButton>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <StorageSection info={info} />
      </GlassPanel>

      <GlassPanel>
        <UpdateSection />
      </GlassPanel>
    </div>
  );
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportExportTab() {
  const [busy, setBusy] = React.useState('');
  const [result, setResult] = React.useState('');
  const [error, setError] = React.useState('');
  const requestRef = React.useRef<HTMLInputElement>(null);
  const projectRef = React.useRef<HTMLInputElement>(null);
  const privacyRef = React.useRef<HTMLInputElement>(null);
  const editable = can(useAuth.getState().user?.role, 'settings.manage');

  function summaryText(summary: ImportSummary): string {
    const bits = [
      summary.cases ? `${summary.cases} request${summary.cases === 1 ? '' : 's'}` : '',
      summary.projects ? `${summary.projects} project${summary.projects === 1 ? '' : 's'}` : '',
      summary.skipped ? `${summary.skipped} duplicate${summary.skipped === 1 ? '' : 's'} skipped` : '',
    ].filter(Boolean);
    const base = bits.length ? bits.join(' · ') : 'No records imported.';
    return summary.errors.length ? `${base} · ${summary.errors.length} error${summary.errors.length === 1 ? '' : 's'}` : base;
  }

  async function exportTracking() {
    setBusy('export');
    setError('');
    try {
      const data = await platform().system.exportTracking();
      downloadJson(`privacyflow-tracking-${new Date().toISOString().slice(0, 10)}.json`, data);
      setResult(`Exported ${data.cases.length} request${data.cases.length === 1 ? '' : 's'} and ${data.projects.length} project${data.projects.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to export tracking data.');
    } finally {
      setBusy('');
    }
  }

  async function importRequests(file: File) {
    setBusy('requests');
    setError('');
    setResult('');
    try {
      const settings = await platform().system.settings();
      const rows = await rowsFromFile(file);
      const inputs = rows.map((row) => caseInputFromRow(row, { jurisdiction: 'US' }));
      const summary = await platform().system.importCases(inputs);
      setResult(`Request import complete: ${summaryText(summary)}.`);
      if (summary.errors.length) setError(summary.errors.slice(0, 5).join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to import requests.');
    } finally {
      setBusy('');
      if (requestRef.current) requestRef.current.value = '';
    }
  }

  async function importProjects(file: File) {
    setBusy('projects');
    setError('');
    setResult('');
    try {
      const rows = await rowsFromFile(file);
      const inputs = rows.map(projectInputFromRow);
      const summary = await platform().system.importProjects(inputs);
      setResult(`Project import complete: ${summaryText(summary)}.`);
      if (summary.errors.length) setError(summary.errors.slice(0, 5).join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to import projects.');
    } finally {
      setBusy('');
      if (projectRef.current) projectRef.current.value = '';
    }
  }

  async function importPrivacyFlow(file: File) {
    setBusy('privacyflow');
    setError('');
    setResult('');
    try {
      const payload = privacyFlowPayloadFromJson(await file.text());
      const summary = await platform().system.importTracking(payload);
      setResult(`PrivacyFlow import complete: ${summaryText(summary)}.`);
      if (summary.errors.length) setError(summary.errors.slice(0, 5).join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to import PrivacyFlow data.');
    } finally {
      setBusy('');
      if (privacyRef.current) privacyRef.current.value = '';
    }
  }

  return (
    <GlassPanel>
      <div className="mb-4 flex items-center gap-2">
        <Upload className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Import &amp; Export</h3>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-[var(--pf-surface)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-ink">Requests</p>
          </div>
          <p className="mb-3 text-xs text-muted">
            Import Smartsheet or Excel exports as CSV, TSV, or .xlsx. Recognized columns include Request, Request ID, Subject, Email, Types, Status, Date Received, and Description.
          </p>
          <input
            ref={requestRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void importRequests(file); }}
          />
          <GlassButton disabled={!editable || !!busy} loading={busy === 'requests'} onClick={() => requestRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import requests
          </GlassButton>
        </div>

        <div className="rounded-xl border border-line bg-[var(--pf-surface)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-ink">Projects</p>
          </div>
          <p className="mb-3 text-xs text-muted">
            Import project trackers from CSV, TSV, or .xlsx. Recognized columns include Project Number, Project Name, Status, Source, RITM Number, Investment Class, Fiscal Year, PIA Number, and Description.
          </p>
          <input
            ref={projectRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void importProjects(file); }}
          />
          <GlassButton disabled={!editable || !!busy} loading={busy === 'projects'} onClick={() => projectRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import projects
          </GlassButton>
        </div>

        <div className="rounded-xl border border-line bg-[var(--pf-surface)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileJson className="h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-ink">PrivacyFlow transfer</p>
          </div>
          <p className="mb-3 text-xs text-muted">
            Export requests and projects to a PrivacyFlow JSON transfer file, or import a transfer/privacyflow.db.json file from another PrivacyFlow workspace.
          </p>
          <input
            ref={privacyRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void importPrivacyFlow(file); }}
          />
          <div className="flex flex-wrap gap-2">
            <GlassButton disabled={!!busy} loading={busy === 'export'} onClick={exportTracking}>
              <Download className="h-4 w-4" /> Export JSON
            </GlassButton>
            <GlassButton disabled={!editable || !!busy} loading={busy === 'privacyflow'} onClick={() => privacyRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import JSON
            </GlassButton>
          </div>
        </div>
      </div>

      {!editable && <p className="mt-3 text-xs text-muted">Only administrators and privacy managers can import records.</p>}
      {result && <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{result}</p>}
      {error && <p className="mt-4 whitespace-pre-line rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
    </GlassPanel>
  );
}

function BackupRestoreTab() {
  const PAGE_SIZE = 10;
  const [backups, setBackups] = React.useState<BackupEntry[]>([]);
  const [selected, setSelected] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const bridge = backupBridge();
  const editable = can(useAuth.getState().user?.role, 'settings.manage');

  async function refreshBackups(nextSelected?: string) {
    if (!bridge) return;
    const list = await bridge.list();
    setBackups(list);
    const nextFileName = nextSelected ?? list[0]?.fileName ?? '';
    const nextIndex = Math.max(0, list.findIndex((backup) => backup.fileName === nextFileName));
    setSelected(nextFileName);
    setPage(nextFileName ? Math.floor(nextIndex / PAGE_SIZE) + 1 : 1);
  }

  React.useEffect(() => {
    void refreshBackups();
  }, []);

  async function createManualBackup() {
    if (!bridge) return;
    setBusy('create');
    setMessage('');
    setError('');
    try {
      const backup = await bridge.create();
      await refreshBackups(backup.fileName);
      setMessage(`Created local backup ${backup.fileName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create backup.');
    } finally {
      setBusy('');
    }
  }

  async function restoreSelectedBackup() {
    if (!bridge || !selected) return;
    const backup = backups.find((item) => item.fileName === selected);
    if (!window.confirm(
      `Restore ${backup?.fileName ?? selected}? This replaces the current workspace database and reloads PrivacyFlow.`,
    )) return;

    setBusy('restore');
    setMessage('');
    setError('');
    try {
      const result = await bridge.restore({ fileName: selected });
      setMessage(
        result.safetyBackup
          ? `Restored ${result.restored.fileName}. Safety backup created as ${result.safetyBackup.fileName}.`
          : `Restored ${result.restored.fileName}.`,
      );
      window.alert('Backup restored. PrivacyFlow will reload from the restored workspace.');
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to restore backup.');
    } finally {
      setBusy('');
    }
  }

  async function deleteSelectedBackup(fileName: string) {
    if (!bridge) return;
    if (!window.confirm(`Delete backup ${fileName}? This only removes the local backup file.`)) return;
    setBusy(`delete:${fileName}`);
    setMessage('');
    setError('');
    try {
      await bridge.delete({ fileName });
      const list = await bridge.list();
      setBackups(list);
      const nextSelected = selected === fileName
        ? list[Math.min(list.length - 1, Math.max(0, backups.findIndex((backup) => backup.fileName === fileName)))]?.fileName ?? ''
        : selected;
      setSelected(nextSelected);
      const nextIndex = Math.max(0, list.findIndex((backup) => backup.fileName === nextSelected));
      setPage(nextSelected ? Math.floor(nextIndex / PAGE_SIZE) + 1 : 1);
      setMessage(`Deleted local backup ${fileName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete backup.');
    } finally {
      setBusy('');
    }
  }

  if (!bridge) {
    return (
      <GlassPanel>
        <div className="mb-4 flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Backup / Restore</h3>
        </div>
        <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <p className="text-xs text-muted">
            Local automatic backups are available in the packaged Windows desktop app. The browser preview
            stores data in local storage, so use Import &amp; Export for preview data transfers.
          </p>
        </div>
      </GlassPanel>
    );
  }

  const selectedBackup = backups.find((item) => item.fileName === selected);
  const pageCount = Math.max(1, Math.ceil(backups.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleBackups = backups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <GlassPanel>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 text-accent" />
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Backup / Restore</h3>
            <p className="text-xs text-muted">
              PrivacyFlow automatically keeps local copies of valid workspace saves on this PC.
            </p>
          </div>
        </div>
        <GlassBadge tone="info">{backups.length} local backup{backups.length === 1 ? '' : 's'}</GlassBadge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="content-surface overflow-hidden">
          {backups.length ? (
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--pf-surface-2)]">
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Backup</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleBackups.map((backup) => (
                  <tr
                    key={backup.id}
                    className={clsx(
                      'cursor-pointer border-b border-line/60 transition-colors hover:bg-[var(--pf-highlight)]',
                      selected === backup.fileName && 'bg-accent/10',
                    )}
                    onClick={() => setSelected(backup.fileName)}
                  >
                    <td className="px-4 py-3">
                      <p className="break-all font-mono text-xs text-ink">{backup.fileName}</p>
                      <p className="text-[11px] text-muted">{fmtDateTime(backup.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <GlassBadge tone={backup.reason === 'manual' ? 'success' : 'neutral'}>
                        {backup.reason.replace(/-/g, ' ')}
                      </GlassBadge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{fmtBytes(backup.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <GlassButton
                        variant="ghost"
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        title={`Delete ${backup.fileName}`}
                        disabled={!!busy}
                        loading={busy === `delete:${backup.fileName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteSelectedBackup(backup.fileName);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </GlassButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-sm text-muted">
              No local backups yet. Create one manually, or make a normal workspace edit in the desktop app.
            </div>
          )}

          {backups.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted">
              <span>
                Showing {((safePage - 1) * PAGE_SIZE) + 1}-{Math.min(safePage * PAGE_SIZE, backups.length)} of {backups.length}
              </span>
              <div className="flex items-center gap-2">
                <GlassButton className="px-3 py-1.5 text-xs" disabled={safePage <= 1 || !!busy} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Previous
                </GlassButton>
                <span>Page {safePage} of {pageCount}</span>
                <GlassButton className="px-3 py-1.5 text-xs" disabled={safePage >= pageCount || !!busy} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                  Next
                </GlassButton>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-line bg-[var(--pf-surface)] p-4">
          <p className="text-sm font-semibold text-ink">Actions</p>
          {selectedBackup ? (
            <div className="min-w-0 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
              <p className="break-all font-mono text-[11px] text-ink">{selectedBackup.filePath}</p>
              <p className="mt-1 text-[11px] text-muted">
                {fmtDateTime(selectedBackup.createdAt)} · {fmtBytes(selectedBackup.sizeBytes)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">Choose a backup from the list to restore it.</p>
          )}

          <GlassButton disabled={!!busy} loading={busy === 'create'} onClick={createManualBackup}>
            <DatabaseBackup className="h-4 w-4" /> Create backup now
          </GlassButton>
          <GlassButton
            variant="primary"
            disabled={!editable || !selected || !!busy}
            loading={busy === 'restore'}
            onClick={restoreSelectedBackup}
          >
            <ArchiveRestore className="h-4 w-4" /> Restore selected
          </GlassButton>
          {!editable && <p className="text-[11px] text-muted">Only administrators and privacy managers can restore backups.</p>}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Automatic backups are stored locally on this PC, not on the shared drive. The newest 10 valid
        workspace backups are kept.
      </p>
      {message && <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{message}</p>}
      {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
    </GlassPanel>
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
  const [retentionBusy, setRetentionBusy] = React.useState(false);
  const [retentionResult, setRetentionResult] = React.useState('');
  const [retentionError, setRetentionError] = React.useState('');

  // M365 connect form state
  const [connecting, setConnecting] = React.useState(false);
  const [m365ConnectBusy, setM365ConnectBusy] = React.useState(false);
  const [m365Email, setM365Email] = React.useState('');
  const [m365Error, setM365Error] = React.useState('');
  const [m365TestBusy, setM365TestBusy] = React.useState(false);
  const [m365TestResult, setM365TestResult] = React.useState('');

  // Add-user form state
  const [addingUser, setAddingUser] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newUsername, setNewUsername] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('privacy_analyst');
  const [addError, setAddError] = React.useState('');
  const [addBusy, setAddBusy] = React.useState(false);
  const [issuedCredentials, setIssuedCredentials] = React.useState<{ username: string; email?: string; tempPassword: string; inviteOpened?: boolean; inviteError?: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [editingUserId, setEditingUserId] = React.useState('');
  const [editName, setEditName] = React.useState('');
  const [editRole, setEditRole] = React.useState<Role>('privacy_analyst');
  const [resetBusyUserId, setResetBusyUserId] = React.useState('');

  React.useEffect(() => {
    platform().system.settings().then(setSettings);
    if (can(user?.role, 'users.manage')) platform().auth.listUsers().then(setUsers);
  }, [user?.role]);

  if (!settings) return <Spinner label="Loading settings…" />;

  const editable = can(user?.role, 'settings.manage');
  const localEditable = !!user;
  const canManageUsers = can(user?.role, 'users.manage');
  const m365 = settings.m365;
  const visibleTabs = TABS.filter(({ key }) => {
    if (key === 'users') return canManageUsers;
    if (key === 'organization' || key === 'import_export' || key === 'backup_restore') return editable;
    return true;
  });

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

  async function applyRetentionCleanup() {
    const years = Math.max(1, Math.floor(Number(settings!.retentionYears) || APP_CONFIG.defaults.retentionYears));
    if (!window.confirm(
      `Delete request and project records older than ${years} year${years === 1 ? '' : 's'}? ` +
      'This also removes attached notes, communications, documents, and history rows. Create a backup first if you need a recovery point.',
    )) return;
    setRetentionBusy(true);
    setRetentionResult('');
    setRetentionError('');
    try {
      const savedSettings = await platform().system.updateSettings({ ...settings!, retentionYears: years });
      setSettings(savedSettings);
      const summary = await platform().system.applyRetentionCleanup();
      setRetentionResult(
        `Cleanup complete: deleted ${summary.casesDeleted} request${summary.casesDeleted === 1 ? '' : 's'} ` +
        `and ${summary.projectsDeleted} project${summary.projectsDeleted === 1 ? '' : 's'} older than ${fmtDateTime(summary.cutoffDate)}.`,
      );
    } catch (e) {
      setRetentionError(e instanceof Error ? e.message : 'Unable to apply retention cleanup.');
    } finally {
      setRetentionBusy(false);
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

  function startUserEdit(target: User) {
    setUserError('');
    setEditingUserId(target.id);
    setEditName(target.name);
    setEditRole(target.role);
  }

  function cancelUserEdit() {
    setEditingUserId('');
    setEditName('');
    setEditRole('privacy_analyst');
  }

  async function saveUserEdit(target: User) {
    const name = editName.trim();
    if (!name) {
      setUserError('Name is required.');
      return;
    }
    setUserError('');
    try {
      const patch = target.id === user?.id ? { name } : { name, role: editRole };
      const updated = await platform().auth.updateUser(target.id, patch);
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      if (updated.id === user?.id) await init();
      cancelUserEdit();
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Unable to update user.');
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

  async function resetUserPassword(target: User) {
    const isSelfReset = target.id === user?.id;
    if (!window.confirm(
      `Generate a new temporary password for ${target.name} (@${target.username})? ` +
      (isSelfReset
        ? 'You will be required to set a new password the next time you sign in.'
        : 'They will be required to set a new password the next time they sign in.'),
    )) return;
    setUserError('');
    setResetBusyUserId(target.id);
    try {
      const { user: updated, tempPassword } = await platform().auth.resetUserPassword(target.id);
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setIssuedCredentials({
        username: updated.username,
        email: updated.email,
        tempPassword,
      });
      setCopied(false);
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Unable to reset password.');
    } finally {
      setResetBusyUserId('');
    }
  }

  async function deleteUser(target: User) {
    if (!window.confirm(
      `Delete ${target.name} (@${target.username})? Their account is removed permanently. ` +
      'Their account is removed permanently; past activity stays in the audit trail.',
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
        email: newEmail || undefined,
        role: newRole,
      });
      let inviteOpened = false;
      let inviteError = '';
      const inviteDraftError = 'PrivacyFlow could not confirm that the invite draft opened. If no draft appeared, copy the temporary password and send the invite manually.';
      if (created.email) {
        const subject = `${APP_CONFIG.productName} access`;
        const body = [
          `Hello ${created.name},`,
          '',
          `Your ${APP_CONFIG.productName} account has been created.`,
          '',
          `Download the latest Windows portable application here:`,
          APP_CONFIG.updates.latestReleasePageUrl,
          '',
          `Repository: https://github.com/${APP_CONFIG.updates.owner}/${APP_CONFIG.updates.repo}`,
          '',
          `Username: ${created.username}`,
          `Temporary password: ${tempPassword}`,
          '',
          'You will be prompted to set your own password the first time you sign in.',
          '',
          'No GitHub account is required to download the public release.',
        ].join('\n');
        const openFallbackDraft = async () => {
          const mail = mailBridge();
          if (!mail) return false;
          await mail.openDraft({ to: created.email!, subject, body });
          return true;
        };
        const outlook = outlookBridge();
        if (outlook && settings.m365.connected && settings.m365.mode === 'outlook') {
          try {
            await outlook.openDraft({
              accountEmail: settings.m365.accountEmail,
              to: created.email,
              subject,
              body,
            });
            inviteOpened = true;
          } catch {
            try {
              inviteOpened = await openFallbackDraft();
            } catch {
              inviteError = inviteDraftError;
            }
          }
        } else {
          try {
            inviteOpened = await openFallbackDraft();
          } catch {
            inviteError = inviteDraftError;
          }
        }
        if (!inviteOpened && !inviteError) {
          inviteError = 'No local email draft tool was available.';
        }
      }
      setUsers((list) => [...list, created]);
      setAddingUser(false);
      setNewName('');
      setNewUsername('');
      setNewEmail('');
      setNewRole('privacy_analyst');
      // Show the generated temporary password ONCE for the admin to share.
      setIssuedCredentials({ username: created.username, email: created.email, tempPassword, inviteOpened, inviteError });
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

  function graphTokenExpiry(expiresIn: number): string {
    return new Date(Date.now() + Math.max(60, expiresIn - 120) * 1000).toISOString();
  }

  async function currentGraphAccessToken(): Promise<string> {
    const graph = graphBridge();
    if (!graph || !settings?.m365.clientId) throw new Error('Microsoft Graph is unavailable.');
    const m365 = settings.m365;
    if (m365.accessToken && m365.expiresAt && new Date(m365.expiresAt).getTime() > Date.now() + 60_000) {
      return m365.accessToken;
    }
    if (!m365.refreshToken) throw new Error('Microsoft Graph refresh token is unavailable. Disconnect and reconnect.');
    const token = await graph.refreshToken({ clientId: m365.clientId, refreshToken: m365.refreshToken });
    const updated = await platform().system.updateSettings({
      m365: {
        ...m365,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? m365.refreshToken,
        expiresAt: graphTokenExpiry(token.expires_in),
      },
    });
    setSettings(updated);
    return token.access_token;
  }

  async function connectM365() {
    if (!/.+@.+\..+/.test(m365Email)) {
      setM365Error('Enter a valid Microsoft 365 mailbox address (e.g. privacy@contoso.com).');
      return;
    }
    setM365Error('');
    setM365TestResult('');
    setM365ConnectBusy(true);

    const email = m365Email.trim();
    const isDesktop = !!workspaceBridge();

    try {
      if (isDesktop) {
        const s = await platform().system.updateSettings({
          m365: {
            connected: true,
            accountEmail: email,
            connectedAt: new Date().toISOString(),
            connectedBy: user?.name,
            mode: 'outlook',
            fallback: 'mailto',
          },
        });
        setSettings(s);
        setConnecting(false);
        setM365Email('');
        setM365TestResult(`Connected local Outlook desktop automation for ${email}. Use Test connection to confirm PowerShell can open a draft.`);
        return;
      }

      const s = await platform().system.updateSettings({
        m365: {
          connected: true,
          accountEmail: email,
          connectedAt: new Date().toISOString(),
          connectedBy: user?.name,
          mode: 'simulated',
        },
      });
      setSettings(s);
      setConnecting(false);
      setM365Email('');
      setM365TestResult('Browser preview is in simulated mode.');
    } catch (e) {
      setM365Error(e instanceof Error ? e.message : 'Unable to connect Microsoft 365.');
    } finally {
      setM365ConnectBusy(false);
    }
  }

  async function disconnectM365() {
    if (!window.confirm('Disconnect Microsoft 365? Automated emails will be logged locally instead of sent.')) return;
    const s = await platform().system.updateSettings({ m365: { connected: false, mode: 'simulated' } });
    setSettings(s);
  }

  async function testM365Connection() {
    if (!m365.connected || !m365.accountEmail) return;
    setM365TestBusy(true);
    setM365TestResult('');
    setM365Error('');
    try {
      if (m365.mode === 'outlook') {
        const outlook = outlookBridge();
        if (outlook) {
          await outlook.openDraft({
            accountEmail: m365.accountEmail,
            to: m365.accountEmail,
            subject: `PrivacyFlow Outlook test (${new Date().toLocaleString()})`,
            body: 'This is a PrivacyFlow local Outlook connection test.',
          });
        } else {
          const bridge = mailBridge();
          if (!bridge) throw new Error('Outlook draft bridge is unavailable.');
          await bridge.openDraft({
            to: m365.accountEmail,
            subject: `PrivacyFlow Outlook draft test (${new Date().toLocaleString()})`,
            body: 'This is a PrivacyFlow Outlook draft connection test.',
          });
        }
        setM365TestResult(`Opened a test draft to ${m365.accountEmail}.`);
      } else if (m365.mode === 'graph') {
        const graph = graphBridge();
        if (!graph) throw new Error('Microsoft Graph bridge is unavailable.');
        const accessToken = await currentGraphAccessToken();
        await graph.sendMail({
          accessToken,
          to: m365.accountEmail,
          subject: `PrivacyFlow Microsoft Graph test (${new Date().toLocaleString()})`,
          body: 'This is a PrivacyFlow Microsoft Graph connection test.',
          saveToSentItems: true,
        });
        setM365TestResult(`Sent a Microsoft Graph test email to ${m365.accountEmail}.`);
      } else if (m365.mode === 'mailto') {
        const bridge = mailBridge();
        if (!bridge) throw new Error('Mailto draft fallback is unavailable.');
        await bridge.openDraft({
          to: m365.accountEmail,
          subject: `PrivacyFlow mailto draft test (${new Date().toLocaleString()})`,
          body: 'This is a PrivacyFlow mailto draft fallback test.',
        });
        setM365TestResult(`Opened a mailto draft to ${m365.accountEmail}.`);
      } else {
        setM365TestResult('Browser preview is in simulated mode. No email was sent.');
      }
    } catch (e) {
      setM365Error(e instanceof Error ? e.message : 'Microsoft 365 test failed.');
    } finally {
      setM365TestBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace, appearance, organization, integrations, and user management." />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
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
        <div className="max-w-5xl">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
            <GlassPanel>
              <div className="flex flex-col gap-3">
                <Field label="Organization name">
                  <GlassInput disabled={!editable} value={settings.organizationName} onChange={(e) => setSettings({ ...settings, organizationName: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Request ID prefix">
                    <GlassInput disabled={!editable} value={settings.caseNumberPrefix} onChange={(e) => setSettings({ ...settings, caseNumberPrefix: e.target.value })} />
                  </Field>
                  <Field label="Auto-lock (minutes)">
                    <GlassInput disabled={!editable} type="number" value={settings.autoLockMinutes} onChange={(e) => setSettings({ ...settings, autoLockMinutes: Number(e.target.value) })} />
                  </Field>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel>
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-ink">Retention</h4>
                <p className="text-xs text-muted">
                  Choose how many years PrivacyFlow should keep request and project records before they are eligible for deletion.
                </p>
              </div>
              <div className="grid gap-3">
                <Field label="Retention period">
                  <GlassInput
                    disabled={!editable}
                    type="number"
                    min={1}
                    step={1}
                    value={settings.retentionYears}
                    onChange={(e) => setSettings({
                      ...settings,
                      retentionYears: Math.max(1, Math.floor(Number(e.target.value) || APP_CONFIG.defaults.retentionYears)),
                    })}
                  />
                </Field>
                <p className="text-xs text-muted">
                  Records older than this many years can be deleted using the cleanup action below. Default is 5 years.
                </p>
              </div>
              <label className="mt-3 flex items-start gap-3 rounded-xl border border-line bg-[var(--pf-highlight)] px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 focus-ring"
                  checked={settings.autoRetentionCleanup}
                  disabled={!editable}
                  onChange={(e) => setSettings({ ...settings, autoRetentionCleanup: e.target.checked })}
                />
                <span>
                  <span className="block font-medium">Automatically apply retention cleanup on startup</span>
                  <span className="block text-[11px] text-muted">
                    When enabled, PrivacyFlow checks on startup and deletes records older than the retention period. No audit row is created when nothing is deleted.
                  </span>
                </span>
              </label>
              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <GlassButton variant="danger" loading={retentionBusy} onClick={applyRetentionCleanup}>
                    <Trash2 className="h-4 w-4" /> Delete records older than retention period
                  </GlassButton>
                  <p className="text-[11px] text-muted">Audit events remain so the audit chain stays verifiable.</p>
                </div>
              )}
              {retentionResult && <p className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{retentionResult}</p>}
              {retentionError && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{retentionError}</p>}
            </GlassPanel>
          </div>
          <div className="mt-3 flex flex-col gap-2">
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
        </div>
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
                    {m365.mode === 'graph' ? ' · Microsoft Graph delegated send' : ''}
                    {m365.mode === 'outlook' ? ' · Local Outlook desktop drafts' : ''}
                    {m365.mode === 'mailto' ? ' · Mailto draft fallback' : ''}
                    {m365.mode === 'simulated' ? ' · Simulated delivery (browser preview)' : ''}
                  </p>
                </div>
                {localEditable && (
                  <div className="flex flex-wrap gap-2">
                    <GlassButton variant="subtle" loading={m365TestBusy} onClick={testM365Connection}>
                      <Mail className="h-4 w-4" /> Test connection
                    </GlassButton>
                    <GlassButton variant="ghost" onClick={disconnectM365}>
                      <Unlink className="h-4 w-4" /> Disconnect
                    </GlassButton>
                  </div>
                )}
              </div>
              {m365TestResult && <p className="text-xs text-emerald-300">{m365TestResult}</p>}
              {m365Error && <p className="text-xs text-red-400">{m365Error}</p>}
              <p className="text-xs text-muted">
                {m365.mode === 'graph'
                  ? 'Automation sends email through Microsoft Graph using delegated user consent. If sending fails, PrivacyFlow falls back to opening a mailto draft.'
                  : m365.mode === 'mailto'
                    ? 'Automation opens mailto drafts with the default email app. Users review and send manually; PrivacyFlow logs the draft activity.'
                    : 'Automated requester emails open as Outlook drafts from this desktop app and are logged on the request Communications tab and audit trail.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Connect a Microsoft 365 mailbox so automated template emails open as Outlook desktop
                drafts using local PowerShell automation. If Outlook automation is unavailable,
                PrivacyFlow uses mailto draft fallback.
              </p>

              {!connecting ? (
                <div>
                  <GlassButton variant="primary" disabled={!localEditable} onClick={() => setConnecting(true)}>
                    <Link2 className="h-4 w-4" /> Connect Microsoft 365
                  </GlassButton>
                  {!localEditable && <p className="mt-2 text-xs text-muted">Sign in to connect your Outlook mailbox.</p>}
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
                  {m365TestResult && <p className="text-xs text-emerald-300 whitespace-pre-wrap">{m365TestResult}</p>}
                  {m365Error && <p className="text-xs text-red-400">{m365Error}</p>}
                  <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <p className="text-[11px] text-muted">
                      In the packaged Windows app, Connect saves this mailbox for local Outlook desktop automation. Use Test connection after connecting to confirm PowerShell can open Outlook drafts. If automation is unavailable, PrivacyFlow falls back to mailto drafts.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <GlassButton onClick={() => { setConnecting(false); setM365Error(''); setM365TestResult(''); }}>Cancel</GlassButton>
                    <GlassButton variant="primary" loading={m365ConnectBusy} onClick={connectM365}>
                      <Link2 className="h-4 w-4" /> Connect
                    </GlassButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </GlassPanel>
      )}

      {tab === 'import_export' && <ImportExportTab />}

      {tab === 'backup_restore' && <BackupRestoreTab />}

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
            <div className="mb-4 flex max-w-2xl min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div className="flex min-w-0 items-center gap-2">
                <KeyRound className="h-4 w-4 text-emerald-400" />
                <p className="min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                  Temporary password for <span className="text-accent">@{issuedCredentials.username}</span>
                </p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 break-words rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-2 font-mono text-sm text-ink [overflow-wrap:anywhere]">
                  {issuedCredentials.tempPassword}
                </code>
                <GlassButton variant="subtle" className="px-3 py-2 text-xs" onClick={copyTempPassword}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </GlassButton>
              </div>
              <p className="text-[11px] text-muted">
                Shown once — only the salted hash is stored. Share this with the user through a secure
                channel; they'll be required to set their own password at next sign-in.
              </p>
              {issuedCredentials.email && issuedCredentials.inviteOpened && (
                <p className="min-w-0 break-words text-[11px] text-emerald-300 [overflow-wrap:anywhere]">
                  Invite email draft opened for {issuedCredentials.email}.
                </p>
              )}
              {issuedCredentials.email && issuedCredentials.inviteError && (
                <p className="min-w-0 break-words text-[11px] text-red-400 [overflow-wrap:anywhere]">
                  Invite email draft could not be opened for {issuedCredentials.email}: {issuedCredentials.inviteError}
                </p>
              )}
              {!issuedCredentials.email && (
                <p className="text-[11px] text-muted">
                  No email address was entered, so no invite draft was opened.
                </p>
              )}
              <div className="flex justify-end">
                <GlassButton variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setIssuedCredentials(null)}>
                  Dismiss
                </GlassButton>
              </div>
            </div>
          )}

          {addingUser && canManageUsers && (
            <form onSubmit={createUser} className="mb-4 flex w-full flex-col gap-3 rounded-xl border border-accent/40 bg-[var(--pf-surface)] p-4">
              <p className="text-sm font-semibold text-ink">Add a new user</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Full name">
                  <GlassInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Jordan Reyes" autoFocus />
                </Field>
                <Field label="Username" hint="Lowercase letters, numbers, dots, dashes, underscores.">
                  <GlassInput value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. jreyes" />
                </Field>
                <Field label="Email" hint="Used for the install invite.">
                  <GlassInput type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="jreyes@example.com" />
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
                  user signs in with it and is required to set their own password before gaining access. If an
                  email address is entered, PrivacyFlow opens an invite draft with the public GitHub release link.
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
                  const isEditing = editingUserId === u.id;
                  return (
                    <tr key={u.id} className="border-b border-line/60">
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <GlassInput
                            className="max-w-xs px-2 py-1.5 text-xs"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <p className="font-medium text-ink">{u.name}{isSelf && <span className="ml-2 text-[10px] text-muted">(you)</span>}</p>
                        )}
                        <p className="text-[11px] text-muted">@{u.username}{u.email ? ` · ${u.email}` : ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing && !isSelf ? (
                          <GlassSelect
                            className="w-44 px-2 py-1.5 text-xs"
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as Role)}
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
                          <div className="flex items-center gap-1.5">
                            {isEditing ? (
                              <>
                                <GlassButton
                                  variant="primary"
                                  className="px-2 py-1 text-xs"
                                  title={`Save ${u.name}`}
                                  onClick={() => saveUserEdit(u)}
                                >
                                  <Save className="h-3.5 w-3.5" />
                                </GlassButton>
                                <GlassButton
                                  variant="ghost"
                                  className="px-2 py-1 text-xs"
                                  title="Cancel edit"
                                  onClick={cancelUserEdit}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </GlassButton>
                              </>
                            ) : (
                              <GlassButton
                                variant="ghost"
                                className="px-2 py-1 text-xs"
                                title={`Edit ${u.name}`}
                                onClick={() => startUserEdit(u)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </GlassButton>
                            )}
                            {!isSelf && !isEditing && (
                              <>
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
                              </>
                            )}
                            {!isEditing && (
                              <GlassButton
                                variant="ghost"
                                className="px-2 py-1 text-xs"
                                title={`Generate temporary password for ${u.name}`}
                                loading={resetBusyUserId === u.id}
                                onClick={() => resetUserPassword(u)}
                                disabled={!u.active}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </GlassButton>
                            )}
                          </div>
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
