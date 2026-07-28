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

export interface DownloadUpdateInput {
  assetApiUrl: string;
  token?: string;
  fileName: string;
}

export interface DownloadUpdateResult {
  filePath: string;
  opened: boolean;
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

export interface UpdaterBridge {
  downloadReleaseAsset: (input: DownloadUpdateInput) => Promise<DownloadUpdateResult>;
}

export interface MailDraftInput {
  to: string;
  subject: string;
  body: string;
}

export interface MailBridge {
  openDraft: (input: MailDraftInput) => Promise<boolean>;
}

export interface M365DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export interface M365TokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface M365Profile {
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

export interface M365SendMailInput {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  saveToSentItems?: boolean;
}

export interface OutlookAccount {
  email: string;
  displayName?: string;
}

export interface OutlookBridge {
  accounts: () => Promise<OutlookAccount[]>;
  openDraft: (input: MailDraftInput & { accountEmail?: string }) => Promise<boolean>;
}

const WRITE_STATE: WorkspaceLockState = {
  mode: 'write',
  info: { user: '', machine: '', pid: 0, since: '', heartbeat: '' },
};

interface Injected {
  isElectron?: boolean;
  workspace?: WorkspaceBridge;
  updater?: UpdaterBridge;
  mail?: MailBridge;
  outlook?: OutlookBridge;
}

function injected(): Injected {
  return (globalThis as unknown as { privacyflow?: Injected }).privacyflow ?? {};
}

export function workspaceBridge(): WorkspaceBridge | null {
  return injected().workspace ?? null;
}

export function updaterBridge(): UpdaterBridge | null {
  return injected().updater ?? null;
}

export function mailBridge(): MailBridge | null {
  return injected().mail ?? null;
}

export function outlookBridge(): OutlookBridge | null {
  return injected().outlook ?? null;
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
