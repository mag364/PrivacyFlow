import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, KeyRound, Info, PackageCheck, ExternalLink } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { APP_CONFIG } from '@shared/config';
import { PASSWORD_MIN_LENGTH } from '@shared/password';
import { GlassButton, GlassInput, GlassPanel, Field } from '../../components/glass';
import privacyFlowIcon from '../../assets/privacyflow-icon.png';

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

async function fetchLatestPublishedRelease(): Promise<GitHubRelease | null> {
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
    if (latest.tag_name && !latest.draft) return latest;
  }

  const releasesRes = await fetch(`${APP_CONFIG.updates.releasesApiUrl}?per_page=10&t=${Date.now()}`, {
    cache: 'no-store',
    headers,
  });
  if (!releasesRes.ok) return null;
  const releases = await releasesRes.json() as GitHubRelease[];
  return releases.find((release) => release.tag_name && !release.draft && !release.prerelease) ?? null;
}

export function LoginPage() {
  const {
    login, loading, error, user,
    pendingPasswordChange, completePasswordChange, cancelPasswordChange,
  } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = React.useState('admin');
  const [password, setPassword] = React.useState('');
  const [availableRelease, setAvailableRelease] = React.useState<GitHubRelease | null>(null);

  // First-login password change form
  const [currentPw, setCurrentPw] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [confirmPw, setConfirmPw] = React.useState('');
  const [formError, setFormError] = React.useState('');

  React.useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await fetchLatestPublishedRelease();
        if (
          !cancelled &&
          latest?.tag_name &&
          isNewerVersion(latest.tag_name, APP_CONFIG.version)
        ) {
          setAvailableRelease(latest);
        }
      } catch {
        // Sign-in must keep working if GitHub is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await login(username, password);
    if (ok) navigate('/', { replace: true });
    // If a password change is pending, the page switches to that form;
    // pre-fill the temporary password field with what they just typed.
    setCurrentPw(password);
  }

  async function submitPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (newPw.length < PASSWORD_MIN_LENGTH) {
      setFormError(`New password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPw !== confirmPw) {
      setFormError('New passwords do not match.');
      return;
    }
    const ok = await completePasswordChange(currentPw, newPw);
    if (ok) navigate('/', { replace: true });
  }

  // ------------------------- First-login password gate -------------------------
  if (pendingPasswordChange) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <GlassPanel className="w-full max-w-md p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-accent-ink">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">Set your password</h1>
              <p className="text-sm text-muted">
                Welcome, {pendingPasswordChange.name}. Your temporary password must be replaced before you can continue.
              </p>
            </div>
          </div>

          <form onSubmit={submitPasswordChange} className="flex flex-col gap-4">
            <Field label="Temporary password">
              <GlassInput type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoFocus />
            </Field>
            <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
              <GlassInput type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <GlassInput type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </Field>

            {(formError || error) && (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4" /> {formError || error}
              </div>
            )}

            <GlassButton type="submit" variant="primary" loading={loading} className="w-full">
              Set password & sign in
            </GlassButton>
            <GlassButton type="button" variant="ghost" className="w-full" onClick={cancelPasswordChange}>
              Back to sign in
            </GlassButton>
          </form>
        </GlassPanel>
      </div>
    );
  }

  // ------------------------------- Normal login -------------------------------
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-2">
        <div className="hidden flex-col justify-between rounded-glass border border-line bg-[var(--pf-surface)] p-8 backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-3">
            <img src={privacyFlowIcon} alt="" className="h-11 w-11 rounded-2xl object-cover shadow-glass" />
            <div>
              <p className="text-lg font-bold text-ink">{APP_CONFIG.productName}</p>
              <p className="text-xs text-muted">{APP_CONFIG.tagline}</p>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-ink">Manage data subject requests with confidence.</h2>
            <p className="mt-2 text-sm text-muted">
              Request tracking, role-based workflows, and a tamper-evident audit trail - all stored locally.
            </p>
          </div>
          <p className="text-[11px] text-muted">{APP_CONFIG.disclaimer}</p>
        </div>

        <div className="flex flex-col gap-3">
          {availableRelease && (
            <button
              type="button"
              onClick={() => window.open(availableRelease.html_url, '_blank', 'noopener,noreferrer')}
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-left transition-colors hover:bg-amber-400/15 focus-ring"
            >
              <span className="flex min-w-0 items-center gap-2">
                <PackageCheck className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-amber-100">Update available</span>
                  <span className="block text-xs text-amber-100/80">
                    {availableRelease.tag_name} is available. Current version {APP_CONFIG.version}.
                  </span>
                </span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-amber-200" />
            </button>
          )}

          <GlassPanel className="p-8">
            <h1 className="text-xl font-bold text-ink">Sign in</h1>
            <p className="mt-1 text-sm text-muted">
              Sign in with the workspace administrator account, or an account created under
              Settings → Users.
            </p>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <Field label="Username">
                <GlassInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </Field>
              <Field label="Password">
                <GlassInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>

              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}

              <GlassButton type="submit" variant="primary" loading={loading} className="w-full">
                Sign in
              </GlassButton>
            </form>

            <div className="mt-6 border-t border-line pt-4">
              <div className="flex items-start gap-2 rounded-xl bg-[var(--pf-highlight)] px-3 py-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <p className="text-[11px] text-muted">
                  The initial administrator account is <span className="font-medium text-ink">admin</span>.
                  Accounts created by an administrator sign in with their generated temporary password
                  and set their own password on first sign-in.
                </p>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
