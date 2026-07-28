// -----------------------------------------------------------------------------
// Workspace bridge: when running packaged (Electron), persistence goes through
// the shared file on the firm network share guarded by the lock-file protocol.
// In the browser preview there is no bridge and localStorage is used instead.
// -----------------------------------------------------------------------------

export interface LockHolder {
  user: string;
  machine: string;
  pid: number;
  since: string;
  heartbeat: string;
}

export type WorkspaceLockState =
  | { mode: 'write'; info: LockHolder }
  | { mode: 'read-only'; holder: LockHolder; stale: boolean };

export interface WorkspaceInfo {
  dbPath: string;
  lockState: WorkspaceLockState;
}

export interface ChoosePathResult {
  dbPath: string;
  lockState: WorkspaceLockState;
  changed: boolean;
}

export interface WorkspaceBridge {
  read: () => string | null;
  write: (json: string) => Promise<boolean>;
  lockStatus: () => Promise<WorkspaceLockState>;
  recheckLock: () => Promise<WorkspaceLockState>;
  claimStale: () => Promise<WorkspaceLockState>;
  info?: () => Promise<WorkspaceInfo>;
  choosePath?: () => Promise<ChoosePathResult | null>;
}

const WRITE_STATE: WorkspaceLockState = {
  mode: 'write',
  info: { user: '', machine: '', pid: 0, since: '', heartbeat: '' },
};

interface Injected {
  isElectron?: boolean;
  workspace?: WorkspaceBridge;
}

function injected(): Injected {
  return (globalThis as unknown as { privacyflow?: Injected }).privacyflow ?? {};
}

export function workspaceBridge(): WorkspaceBridge | null {
  return injected().workspace ?? null;
}

// Cached lock state, refreshed at startup and on demand by the UI.
let cachedLock: WorkspaceLockState = WRITE_STATE;

export function currentLockState(): WorkspaceLockState {
  return cachedLock;
}

export async function refreshLockState(): Promise<WorkspaceLockState> {
  const bridge = workspaceBridge();
  if (!bridge) {
    cachedLock = WRITE_STATE;
    return cachedLock;
  }
  cachedLock = await bridge.lockStatus();
  return cachedLock;
}

export async function recheckLock(): Promise<WorkspaceLockState> {
  const bridge = workspaceBridge();
  if (!bridge) return refreshLockState();
  cachedLock = await bridge.recheckLock();
  return cachedLock;
}

export async function claimStaleLock(): Promise<WorkspaceLockState> {
  const bridge = workspaceBridge();
  if (!bridge) return refreshLockState();
  cachedLock = await bridge.claimStale();
  return cachedLock;
}

export function isReadOnly(): boolean {
  return cachedLock.mode === 'read-only';
}

// ---- Settings helpers ---------------------------------------------------------

export async function workspaceInfo(): Promise<WorkspaceInfo | null> {
  const bridge = workspaceBridge();
  if (!bridge?.info) return null;
  const info = await bridge.info();
  cachedLock = info.lockState;
  return info;
}

// Opens the native folder picker and repoints the workspace. Returns the new
// state, or null when the user cancelled / the bridge is unavailable. When the
// path changed, the caller should reload the app so data is re-read.
export async function chooseWorkspacePath(): Promise<ChoosePathResult | null> {
  const bridge = workspaceBridge();
  if (!bridge?.choosePath) return null;
  const result = await bridge.choosePath();
  if (result) cachedLock = result.lockState;
  return result;
}