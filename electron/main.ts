// -----------------------------------------------------------------------------
// Electron main process (desktop build).
//
// Owns the shared workspace: a JSON database file on the firm network share,
// guarded by the single-writer lock-file protocol (electron/lockfile.ts).
// The renderer keeps all of its business logic; the main process only handles
// file I/O + locking, exposed over a small IPC surface:
//
//   workspace:read        (sync)  -> raw JSON string of the db file (or null)
//   workspace:write       (async) -> persist raw JSON — REFUSED in read-only
//   workspace:lockStatus  (async) -> who holds the lock / is it stale?
//   workspace:recheckLock (async) -> retry acquiring (e.g. after holder exits)
//   workspace:claimStale  (async) -> take over a crashed holder's lock
//   workspace:info        (async) -> current db path + lock state (Settings UI)
//   workspace:choosePath  (async) -> folder picker; repoints the workspace
//
// The database location resolves from the PRIVACYFLOW_WORKSPACE environment
// variable (point it at the shared path, e.g. \\FIRM\PrivacyTeam\privacyflow.db.json)
// and falls back to a per-user file for solo installs. It can also be changed
// at runtime from Settings → Workspace.
// -----------------------------------------------------------------------------

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { WorkspaceLock, type LockState } from './lockfile';

const isDev = !app.isPackaged;

function safeFileName(value: string): string {
  const cleaned = String(value || 'PrivacyFlow-update.exe').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-').trim();
  return cleaned || 'PrivacyFlow-update.exe';
}

function uniqueDownloadPath(fileName: string): string {
  const parsed = path.parse(safeFileName(fileName));
  let candidate = path.join(app.getPath('downloads'), `${parsed.name}${parsed.ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(app.getPath('downloads'), `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function applicationFolderPreferencePath(): string {
  return path.join(app.getPath('userData'), 'application-folder.json');
}

function currentApplicationFolder(): string {
  return path.dirname(process.execPath);
}

function readApplicationFolderPreference(): string {
  try {
    const raw = fs.readFileSync(applicationFolderPreferencePath(), 'utf8');
    const parsed = JSON.parse(raw) as { folderPath?: string };
    const saved = String(parsed.folderPath || '').trim();
    return saved || currentApplicationFolder();
  } catch {
    return currentApplicationFolder();
  }
}

function writeApplicationFolderPreference(folderPath: string): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(applicationFolderPreferencePath(), JSON.stringify({ folderPath }, null, 2), 'utf8');
}

function applicationFolderInfo(folderPath: string): { folderPath: string; valid: boolean; message?: string } {
  const resolved = path.resolve(String(folderPath || '').trim() || currentApplicationFolder());
  const exePath = path.join(resolved, 'PrivacyFlow.exe');
  if (!fs.existsSync(resolved)) {
    return { folderPath: resolved, valid: false, message: 'Folder does not exist.' };
  }
  if (!fs.existsSync(exePath)) {
    return { folderPath: resolved, valid: false, message: 'PrivacyFlow.exe was not found in this folder.' };
  }
  return { folderPath: resolved, valid: true };
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function cmdLiteral(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function downloadReleaseAsset(input: { assetApiUrl?: string; token?: string; fileName?: string }): Promise<string> {
  const assetApiUrl = String(input?.assetApiUrl || '').trim();
  const token = String(input?.token || '').trim();
  if (!assetApiUrl || !assetApiUrl.startsWith('https://api.github.com/')) {
    throw new Error('A valid GitHub release asset URL is required.');
  }

  const res = await fetch(assetApiUrl, {
    headers: {
      Accept: 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`Update download failed with HTTP ${res.status}.`);

  const filePath = uniqueDownloadPath(input?.fileName || 'PrivacyFlow-update.exe');
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function writeUpdaterScript(input: { zipPath: string; appFolder: string; lockPath: string }): { scriptPath: string; cmdPath: string; logPath: string } {
  const scriptDir = path.join(app.getPath('temp'), 'PrivacyFlow-updater');
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, `Apply-PrivacyFlow-Update-${Date.now()}.ps1`);
  const cmdPath = path.join(scriptDir, `Start-PrivacyFlow-Update-${Date.now()}.cmd`);
  const backupRoot = path.join(app.getPath('downloads'), 'PrivacyFlow backups');
  const logPath = path.join(app.getPath('downloads'), 'PrivacyFlow-update.log');
  fs.writeFileSync(
    logPath,
    `${new Date().toISOString()} PrivacyFlow prepared updater handoff.\r\n` +
    `${new Date().toISOString()} Script: ${scriptPath}\r\n` +
    `${new Date().toISOString()} App folder: ${input.appFolder}\r\n`,
    'utf8',
  );
  const lines = [
    '$ErrorActionPreference = "Stop"',
    `$ZipPath = ${psLiteral(input.zipPath)}`,
    `$AppFolder = ${psLiteral(input.appFolder)}`,
    `$BackupRoot = ${psLiteral(backupRoot)}`,
    `$LogPath = ${psLiteral(logPath)}`,
    `$LockPath = ${psLiteral(input.lockPath)}`,
    `$TargetPid = ${process.pid}`,
    'function Write-Log([string]$Message) {',
    '  $line = ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)',
    '  Add-Content -LiteralPath $LogPath -Value $line',
    '}',
    'try {',
    '  Set-Location -LiteralPath $env:TEMP',
    '  Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue',
    '  Write-Log "PrivacyFlow update started."',
    '  Write-Log "Waiting for PrivacyFlow process $TargetPid to exit."',
    '  while (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }',
    '  Write-Log "Waiting for the workspace lock to release."',
    '  for ($i = 0; $i -lt 60; $i++) {',
    '    if (-not (Test-Path -LiteralPath $LockPath)) { break }',
    '    try {',
    '      $holder = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json',
    '      if ($holder.pid -eq $TargetPid) {',
    '        Write-Log "Removing leftover lock from the updated PrivacyFlow process."',
    '        Remove-Item -LiteralPath $LockPath -Force -ErrorAction Stop',
    '        break',
    '      }',
    '    } catch { }',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '  $TempRoot = Join-Path $env:TEMP ("PrivacyFlow-update-" + [guid]::NewGuid().ToString("N"))',
    '  $ExtractRoot = Join-Path $TempRoot "extract"',
    '  New-Item -ItemType Directory -Path $ExtractRoot -Force | Out-Null',
    '  Write-Log "Extracting $ZipPath."',
    '  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractRoot -Force',
    '  $SourceFolder = Get-ChildItem -LiteralPath $ExtractRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName "PrivacyFlow.exe") } | Select-Object -First 1',
    '  if (-not $SourceFolder -and (Test-Path (Join-Path $ExtractRoot "PrivacyFlow.exe"))) { $SourcePath = $ExtractRoot }',
    '  elseif ($SourceFolder) { $SourcePath = $SourceFolder.FullName }',
    '  else { throw "The update ZIP does not contain PrivacyFlow.exe." }',
    '  if (-not (Test-Path (Join-Path $AppFolder "PrivacyFlow.exe"))) { throw "The selected app folder does not contain PrivacyFlow.exe: $AppFolder" }',
    '  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null',
    '  $BackupFolder = Join-Path $BackupRoot ("PrivacyFlow-app-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))',
    '  Write-Log "Backing up current app folder to $BackupFolder."',
    '  New-Item -ItemType Directory -Path $BackupFolder -Force | Out-Null',
    '  Get-ChildItem -LiteralPath $AppFolder -Force | Copy-Item -Destination $BackupFolder -Recurse -Force',
    '  Write-Log "Replacing files in $AppFolder."',
    '  Get-ChildItem -LiteralPath $AppFolder -Force | Remove-Item -Recurse -Force',
    '  Get-ChildItem -LiteralPath $SourcePath -Force | Copy-Item -Destination $AppFolder -Recurse -Force',
    '  Write-Log "Cleaning up updater files."',
    '  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction Stop',
    '  Remove-Item -LiteralPath $ZipPath -Force -ErrorAction Stop',
    '  Write-Log "Starting updated PrivacyFlow."',
    '  Start-Process -FilePath (Join-Path $AppFolder "PrivacyFlow.exe") -WorkingDirectory $AppFolder',
    '  Write-Log "PrivacyFlow update completed; deleting update log."',
    '  Remove-Item -LiteralPath $LogPath -Force -ErrorAction Stop',
    '} catch {',
    '  Write-Log ("ERROR: " + $_.Exception.Message)',
    '  Start-Process notepad.exe $LogPath',
    '  exit 1',
    '}',
  ];
  fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
  const cmdLines = [
    '@echo off',
    'setlocal',
    `echo %date% %time% Starting PrivacyFlow updater command.>> ${cmdLiteral(logPath)}`,
    `start "PrivacyFlow Updater" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdLiteral(scriptPath)}`,
    'if errorlevel 1 (',
    `  echo %date% %time% ERROR: Could not start PowerShell updater.>> ${cmdLiteral(logPath)}`,
    `  start notepad.exe ${cmdLiteral(logPath)}`,
    '  exit /b 1',
    ')',
    'exit /b 0',
  ];
  fs.writeFileSync(cmdPath, cmdLines.join('\r\n'), 'utf8');
  return { scriptPath, cmdPath, logPath };
}

function workspacePreferencePath(): string {
  return path.join(app.getPath('userData'), 'workspace-path.json');
}

interface StoredAuthSession {
  userId: string;
  lastActiveAt: string;
}

type StoredAuthSessions = Record<string, StoredAuthSession>;

function authSessionsPath(): string {
  return path.join(app.getPath('userData'), 'auth-sessions.json');
}

function authSessionKey(): string {
  return crypto.createHash('sha256').update(path.resolve(dbPath).toLowerCase()).digest('hex');
}

function readAuthSessions(): StoredAuthSessions {
  try {
    const parsed = JSON.parse(fs.readFileSync(authSessionsPath(), 'utf8')) as StoredAuthSessions;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAuthSessions(sessions: StoredAuthSessions): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  writeAtomic(authSessionsPath(), JSON.stringify(sessions, null, 2));
}

function readCurrentAuthSession(): StoredAuthSession | null {
  const session = readAuthSessions()[authSessionKey()];
  if (!session || !session.userId || !session.lastActiveAt) return null;
  return session;
}

function readWorkspacePreference(): string | null {
  try {
    const raw = fs.readFileSync(workspacePreferencePath(), 'utf8');
    const parsed = JSON.parse(raw) as { dbPath?: string };
    const saved = String(parsed.dbPath || '').trim();
    return saved || null;
  } catch {
    return null;
  }
}

function writeWorkspacePreference(nextDbPath: string): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(workspacePreferencePath(), JSON.stringify({ dbPath: nextDbPath }, null, 2), 'utf8');
}

function resolveDbPath(): string {
  const shared = process.env.PRIVACYFLOW_WORKSPACE;
  if (shared) return shared;
  const saved = readWorkspacePreference();
  if (saved) return saved;
  return path.join(app.getPath('userData'), 'privacyflow.db.json');
}

let dbPath = resolveDbPath();
if (isUserDataWorkspacePath(dbPath)) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const BACKUP_LIMIT = 10;
const SYNC_DEBOUNCE_MS = 1500;

interface WorkspaceSyncState {
  mode: 'local-cache' | 'direct-shared' | 'read-only';
  status: 'synced' | 'local-only' | 'pending' | 'syncing' | 'failed' | 'read-only';
  localCachePath?: string;
  lastSyncedAt?: string;
  lastError?: string;
}

let syncState: WorkspaceSyncState = { mode: 'direct-shared', status: 'synced' };
let syncTimer: NodeJS.Timeout | null = null;
let lastLocalJson: string | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function localWorkspaceCachePath(sharedPath = dbPath): string {
  const digest = crypto.createHash('sha1').update(path.resolve(sharedPath).toLowerCase()).digest('hex').slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'workspace-cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `privacyflow-${digest}.db.json`);
}

function writeAtomic(filePath: string, raw: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, raw, 'utf8');
  fs.renameSync(tmp, filePath);
}

function isUserDataWorkspace(): boolean {
  return isUserDataWorkspacePath(dbPath);
}

function isUserDataWorkspacePath(value: string): boolean {
  return path.resolve(value) === path.resolve(path.join(app.getPath('userData'), 'privacyflow.db.json'));
}

function sharedRaw(): string | null {
  return fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
}

function localRaw(): string | null {
  const cachePath = syncState.localCachePath;
  return cachePath && fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
}

function workspaceReadRaw(): string | null {
  return syncState.mode === 'local-cache' ? localRaw() : sharedRaw();
}

function initializeWorkspaceCache(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  lastLocalJson = null;
  if (lockState.mode !== 'write') {
    syncState = { mode: 'read-only', status: 'read-only' };
    return;
  }
  if (isUserDataWorkspace()) {
    syncState = { mode: 'direct-shared', status: 'synced' };
    return;
  }
  const cachePath = localWorkspaceCachePath();
  const cached = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
  if (cached) {
    lastLocalJson = cached;
    syncState = {
      mode: 'local-cache',
      status: 'pending',
      localCachePath: cachePath,
    };
    refreshLocalCacheFromSharedLater(250);
    return;
  }
  const raw = sharedRaw();
  if (raw) {
    writeAtomic(cachePath, raw);
    lastLocalJson = raw;
    syncState = {
      mode: 'local-cache',
      status: 'synced',
      localCachePath: cachePath,
      lastSyncedAt: new Date().toISOString(),
    };
  } else {
    syncState = {
      mode: 'local-cache',
      status: 'local-only',
      localCachePath: cachePath,
    };
  }
}

function refreshLocalCacheFromSharedLater(delayMs: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshLocalCacheFromShared();
  }, delayMs);
  refreshTimer.unref?.();
}

function refreshLocalCacheFromShared(): void {
  if (syncState.mode !== 'local-cache' || lockState.mode !== 'write' || !syncState.localCachePath) return;
  try {
    const cacheBefore = localRaw();
    const shared = sharedRaw();
    if (!shared) {
      syncState = { ...syncState, status: cacheBefore ? 'synced' : 'local-only', lastError: undefined };
      return;
    }
    if (cacheBefore !== lastLocalJson) {
      syncState = { ...syncState, status: 'pending', lastError: undefined };
      scheduleSyncLocalCache();
      return;
    }
    if (shared !== cacheBefore) {
      writeAtomic(syncState.localCachePath, shared);
      lastLocalJson = shared;
    }
    syncState = {
      ...syncState,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastError: undefined,
    };
  } catch (e) {
    syncState = {
      ...syncState,
      status: 'failed',
      lastError: e instanceof Error ? e.message : 'Unable to refresh the local cache from the shared workspace.',
    };
  }
}

function syncLocalCacheNow(): void {
  if (syncState.mode !== 'local-cache' || lockState.mode !== 'write' || !syncState.localCachePath) return;
  if (!fs.existsSync(syncState.localCachePath)) return;
  const raw = fs.readFileSync(syncState.localCachePath, 'utf8');
  JSON.parse(raw);
  if (lastLocalJson === raw && syncState.status === 'synced') return;
  syncState = { ...syncState, status: 'syncing', lastError: undefined };
  try {
    writeAtomic(dbPath, raw);
    lastLocalJson = raw;
    syncState = {
      ...syncState,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      lastError: undefined,
    };
  } catch (e) {
    syncState = {
      ...syncState,
      status: 'failed',
      lastError: e instanceof Error ? e.message : 'Unable to sync local cache to the shared workspace.',
    };
    throw e;
  }
}

function scheduleSyncLocalCache(): void {
  if (syncState.mode !== 'local-cache' || lockState.mode !== 'write') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncState = { ...syncState, status: 'pending', lastError: undefined };
  syncTimer = setTimeout(() => {
    syncTimer = null;
    try {
      syncLocalCacheNow();
    } catch {
      // The sync state records the error; the next write or close retries.
    }
  }, SYNC_DEBOUNCE_MS);
  syncTimer.unref?.();
}

interface BackupEntry {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
  reason: string;
}

function backupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupReason(value: string): string {
  const cleaned = value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return cleaned || 'auto';
}

function backupEntry(fileName: string): BackupEntry {
  const filePath = path.join(backupDir(), fileName);
  const stats = fs.statSync(filePath);
  const match = /^privacyflow-(.+)-\d{8}-?\d{6}-\d{3}\.db\.json$/.exec(fileName);
  return {
    id: fileName,
    fileName,
    filePath,
    createdAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    reason: match?.[1] ?? 'backup',
  };
}

function listBackups(): BackupEntry[] {
  return fs.readdirSync(backupDir())
    .filter((fileName) => /^privacyflow-.+-\d{8}-?\d{6}-\d{3}\.db\.json$/.test(fileName))
    .map(backupEntry)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupFilePath(fileName: string): string {
  if (!/^[\w.-]+\.db\.json$/.test(fileName)) throw new Error('Invalid backup file.');
  const dir = backupDir();
  const filePath = path.resolve(dir, fileName);
  if (!filePath.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new Error('Invalid backup file.');
  return filePath;
}

function pruneBackups(): void {
  const backups = listBackups();
  backups.slice(BACKUP_LIMIT).forEach((entry) => {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {
      // Best-effort cleanup; never fail a data write because pruning failed.
    }
  });
}

function hashContent(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function latestBackupMatches(raw: string): BackupEntry | null {
  const latest = listBackups()[0];
  if (!latest) return null;
  try {
    const latestRaw = fs.readFileSync(latest.filePath, 'utf8');
    return hashContent(latestRaw) === hashContent(raw) ? latest : null;
  } catch {
    return null;
  }
}

function createBackup(reason: string, content?: string): BackupEntry | null {
  const raw = content ?? workspaceReadRaw();
  if (!raw) return null;
  JSON.parse(raw);
  const normalizedReason = backupReason(reason);
  if (normalizedReason === 'startup' || normalizedReason === 'auto') {
    const duplicate = latestBackupMatches(raw);
    if (duplicate) return duplicate;
  }
  const now = new Date();
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${iso.slice(20, 23)}`;
  const fileName = `privacyflow-${normalizedReason}-${stamp}.db.json`;
  const filePath = path.join(backupDir(), fileName);
  fs.writeFileSync(filePath, raw, 'utf8');
  pruneBackups();
  return backupEntry(fileName);
}

function restoreBackup(fileName: string): { restored: BackupEntry; safetyBackup: BackupEntry | null } {
  if (lockState.mode !== 'write') {
    const holder = lockState.mode === 'read-only' ? lockState.holder : null;
    throw new Error(
      holder
        ? `Workspace is read-only — ${holder.user} on ${holder.machine} is currently editing.`
        : 'Workspace is read-only.',
    );
  }

  const backupPath = backupFilePath(fileName);
  if (!fs.existsSync(backupPath)) throw new Error('Backup file was not found.');

  const raw = fs.readFileSync(backupPath, 'utf8');
  JSON.parse(raw);
  const safetyBackup = createBackup('restore-safety');
  if (syncState.mode === 'local-cache' && syncState.localCachePath) {
    writeAtomic(syncState.localCachePath, raw);
    lastLocalJson = null;
    syncLocalCacheNow();
  } else {
    writeAtomic(dbPath, raw);
  }
  return { restored: backupEntry(fileName), safetyBackup };
}

function deleteBackup(fileName: string): boolean {
  const backupPath = backupFilePath(fileName);
  if (!fs.existsSync(backupPath)) throw new Error('Backup file was not found.');
  fs.unlinkSync(backupPath);
  return true;
}

let lock = new WorkspaceLock(dbPath, os.userInfo().username);
let lockState: LockState = {
  mode: 'read-only',
  holder: { user: 'PrivacyFlow', machine: os.hostname(), pid: process.pid, since: '', heartbeat: '' },
  stale: false,
};
let workspaceReady = false;

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function ensureWorkspaceReady(): void {
  if (workspaceReady) return;
  lockState = lock.acquire();
  initializeWorkspaceCache();
  workspaceReady = true;
}

function splashHtml(): string {
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      background: radial-gradient(900px 600px at 20% 0%, rgba(41, 121, 255, .22), transparent 60%), #0b1020;
      color: #f8fafc;
      font-family: Inter, Segoe UI, system-ui, sans-serif;
    }
    .panel { text-align: center; }
    .mark {
      width: 54px; height: 54px; margin: 0 auto 18px; border-radius: 16px;
      background: rgba(255,255,255,.12); display: grid; place-items: center;
      box-shadow: 0 18px 60px rgba(0,0,0,.35);
    }
    .spinner {
      width: 22px; height: 22px; border: 3px solid rgba(255,255,255,.25);
      border-top-color: #8bd5ff; border-radius: 50%; animation: spin .9s linear infinite;
    }
    h1 { margin: 0; font-size: 18px; }
    p { margin: 8px 0 0; color: rgba(248,250,252,.7); font-size: 13px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="panel">
    <div class="mark"><div class="spinner"></div></div>
    <h1>Starting PrivacyFlow</h1>
    <p>Loading and syncing the shared workspace...</p>
  </div>
</body>
</html>`;
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: true,
    frame: false,
    show: false,
    backgroundColor: '#0b1020',
    icon: path.join(__dirname, '../../assets/privacyflow-icon.png'),
  });
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
}

async function loadAppWindow(): Promise<void> {
  ensureWorkspaceReady();
  if (!mainWindow) return;
  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    frame: false,
    show: false,
    icon: path.join(__dirname, '../../assets/privacyflow-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.once('did-finish-load', () => {
    splashWindow?.close();
    splashWindow = null;
    mainWindow?.show();
  });
  void loadAppWindow();
}

ipcMain.handle('window:minimize', () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  BrowserWindow.getFocusedWindow()?.close();
});

// Read synchronously at boot so the renderer's platform layer stays simple.
ipcMain.on('workspace:read', (event) => {
  try {
    ensureWorkspaceReady();
    event.returnValue = workspaceReadRaw();
  } catch {
    event.returnValue = null;
  }
});

ipcMain.handle('workspace:write', async (_e, json: string) => {
  ensureWorkspaceReady();
  if (lockState.mode !== 'write') {
    const holder = lockState.mode === 'read-only' ? lockState.holder : null;
    throw new Error(
      holder
        ? `Workspace is read-only — ${holder.user} on ${holder.machine} is currently editing.`
        : 'Workspace is read-only.',
    );
  }
  // Write-then-rename so a crash mid-write can't corrupt the local cache or shared file.
  if (syncState.mode === 'local-cache' && syncState.localCachePath) {
    writeAtomic(syncState.localCachePath, json);
    scheduleSyncLocalCache();
  } else {
    writeAtomic(dbPath, json);
  }
  try {
    createBackup('auto', json);
  } catch {
    // Do not block the primary shared-workspace save if the local backup fails.
  }
  return true;
});

ipcMain.handle('authSession:get', () => readCurrentAuthSession());

ipcMain.handle('authSession:set', (_e, userId: string) => {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) throw new Error('A user ID is required.');
  const sessions = readAuthSessions();
  const session = { userId: cleanUserId, lastActiveAt: new Date().toISOString() };
  sessions[authSessionKey()] = session;
  writeAuthSessions(sessions);
  return session;
});

ipcMain.handle('authSession:touch', () => {
  const sessions = readAuthSessions();
  const key = authSessionKey();
  const session = sessions[key];
  if (!session) return null;
  session.lastActiveAt = new Date().toISOString();
  writeAuthSessions(sessions);
  return session;
});

ipcMain.handle('authSession:clear', () => {
  const sessions = readAuthSessions();
  const key = authSessionKey();
  if (!(key in sessions)) return true;
  delete sessions[key];
  writeAuthSessions(sessions);
  return true;
});

ipcMain.handle('workspace:lockStatus', async () => {
  ensureWorkspaceReady();
  return lockState;
});

ipcMain.handle('workspace:recheckLock', async () => {
  ensureWorkspaceReady();
  lockState = lock.recheck();
  initializeWorkspaceCache();
  return lockState;
});

ipcMain.handle('workspace:claimStale', async () => {
  ensureWorkspaceReady();
  lockState = lock.claimStale();
  initializeWorkspaceCache();
  return lockState;
});

ipcMain.handle('workspace:info', async () => {
  ensureWorkspaceReady();
  return {
    dbPath,
    lockState,
    persisted: readWorkspacePreference() === dbPath || !!process.env.PRIVACYFLOW_WORKSPACE,
    sync: syncState,
  };
});

ipcMain.handle('workspace:syncNow', async () => {
  ensureWorkspaceReady();
  syncLocalCacheNow();
  return {
    dbPath,
    lockState,
    persisted: readWorkspacePreference() === dbPath || !!process.env.PRIVACYFLOW_WORKSPACE,
    sync: syncState,
  };
});

// Let the user repoint the workspace at a different (e.g. shared) folder from
// Settings. Releases the current lock, switches path, and re-acquires. The
// renderer reloads afterwards so all data is re-read from the new location.
ipcMain.handle('workspace:choosePath', async () => {
  ensureWorkspaceReady();
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the shared workspace folder',
    defaultPath: path.dirname(dbPath),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const nextPath = path.join(result.filePaths[0], 'privacyflow.db.json');
  if (nextPath === dbPath) return { dbPath, lockState, changed: false };

  try {
    syncLocalCacheNow();
  } catch {
    // Keep moving; the previous workspace local cache is retained for recovery.
  }
  lock.release();
  dbPath = nextPath;
  writeWorkspacePreference(dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  lock = new WorkspaceLock(dbPath, os.userInfo().username);
  lockState = lock.acquire();
  initializeWorkspaceCache();
  try {
    createBackup('auto');
  } catch {
    // Ignore invalid/missing workspace files; the next valid save will back up.
  }
  return { dbPath, lockState, changed: true };
});

ipcMain.handle('backup:list', async () => listBackups());

ipcMain.handle('backup:create', async () => {
  const backup = createBackup('manual');
  if (!backup) throw new Error('No workspace database file exists yet.');
  return backup;
});

ipcMain.handle('backup:restore', async (_e, input: { fileName?: string }) => {
  const fileName = String(input?.fileName || '').trim();
  if (!fileName) throw new Error('Choose a backup to restore.');
  return restoreBackup(fileName);
});

ipcMain.handle('backup:delete', async (_e, input: { fileName?: string }) => {
  const fileName = String(input?.fileName || '').trim();
  if (!fileName) throw new Error('Choose a backup to delete.');
  return deleteBackup(fileName);
});

ipcMain.handle('updater:getApplicationFolder', async () => {
  const info = applicationFolderInfo(readApplicationFolderPreference());
  if (!info.valid) return applicationFolderInfo(currentApplicationFolder());
  return info;
});

ipcMain.handle('updater:chooseApplicationFolder', async () => {
  const current = readApplicationFolderPreference();
  const result = await dialog.showOpenDialog({
    title: 'Choose the extracted PrivacyFlow application folder',
    defaultPath: fs.existsSync(current) ? current : currentApplicationFolder(),
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const info = applicationFolderInfo(result.filePaths[0]);
  if (!info.valid) throw new Error(info.message || 'Choose the folder that contains PrivacyFlow.exe.');
  writeApplicationFolderPreference(info.folderPath);
  return info;
});

ipcMain.handle('updater:downloadReleaseAsset', async (_e, input: { assetApiUrl?: string; token?: string; fileName?: string }) => {
  const filePath = await downloadReleaseAsset(input);
  shell.showItemInFolder(filePath);
  const openError = await shell.openPath(filePath);
  return { filePath, opened: !openError };
});

ipcMain.handle('updater:applyReleaseAsset', async (_e, input: { assetApiUrl?: string; token?: string; fileName?: string; appFolder?: string }) => {
  const fileName = safeFileName(input?.fileName || 'PrivacyFlow-update.zip');
  if (!/\.zip$/i.test(fileName)) {
    const filePath = await downloadReleaseAsset(input);
    shell.showItemInFolder(filePath);
    const openError = await shell.openPath(filePath);
    return {
      filePath,
      appFolder: readApplicationFolderPreference(),
      mode: 'download-only' as const,
      message: openError || 'Downloaded the update package. Close PrivacyFlow before running it.',
    };
  }

  const selectedFolder = String(input?.appFolder || readApplicationFolderPreference()).trim();
  const info = applicationFolderInfo(selectedFolder);
  if (!info.valid) throw new Error(info.message || 'Choose the folder that contains PrivacyFlow.exe before updating.');

  const filePath = await downloadReleaseAsset(input);
  if (process.platform !== 'win32') {
    shell.showItemInFolder(filePath);
    const openError = await shell.openPath(filePath);
    return {
      filePath,
      appFolder: info.folderPath,
      mode: 'download-only' as const,
      message: openError || 'Automatic ZIP updates are only available on Windows.',
    };
  }

  const updater = writeUpdaterScript({ zipPath: filePath, appFolder: info.folderPath, lockPath: lock.lockPath });
  const openError = await shell.openPath(updater.cmdPath);
  if (openError) {
    shell.showItemInFolder(updater.cmdPath);
    throw new Error(`Unable to start the updater handoff: ${openError}. Log: ${updater.logPath}`);
  }
  writeApplicationFolderPreference(info.folderPath);
  flushAndReleaseLock();
  setTimeout(() => app.quit(), 1200);
  return { filePath, appFolder: info.folderPath, updaterScriptPath: updater.scriptPath, mode: 'automatic' as const, message: `Updater log: ${updater.logPath}` };
});

ipcMain.handle('mail:openDraft', async (_e, input: { to?: string; subject?: string; body?: string }) => {
  const to = String(input?.to || '').trim();
  if (!/.+@.+\..+/.test(to)) throw new Error('A valid recipient email address is required.');
  const subject = encodeURIComponent(String(input?.subject || ''));
  const body = encodeURIComponent(String(input?.body || ''));
  const url = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
  return shell.openExternal(url);
});

const GRAPH_SCOPES = ['openid', 'profile', 'User.Read', 'Mail.Send', 'offline_access'];

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => body.set(key, value));
  return body;
}

async function graphTokenRequest(values: Record<string, string>) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(values),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(json.error_description || json.error || `Microsoft sign-in failed with HTTP ${res.status}`);
    throw new Error(message.replace(/\s+/g, ' ').trim());
  }
  return json;
}

ipcMain.handle('graph:startDeviceLogin', async (_e, input: { clientId?: string; scopes?: string[] }) => {
  const clientId = String(input?.clientId || '').trim();
  if (!clientId) throw new Error('Application (client) ID is required for Microsoft Graph sign-in.');
  const scopes = (input?.scopes?.length ? input.scopes : GRAPH_SCOPES).join(' ');
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: clientId, scope: scopes }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(json.error_description || json.error || `Microsoft device sign-in failed with HTTP ${res.status}`);
    throw new Error(message.replace(/\s+/g, ' ').trim());
  }
  const uri = String(json.verification_uri || json.verification_url || '');
  if (uri) shell.openExternal(uri);
  return json;
});

ipcMain.handle('graph:pollDeviceLogin', async (_e, input: { clientId?: string; deviceCode?: string; interval?: number; expiresIn?: number }) => {
  const clientId = String(input?.clientId || '').trim();
  const deviceCode = String(input?.deviceCode || '').trim();
  if (!clientId || !deviceCode) throw new Error('Microsoft device sign-in was not started.');
  const started = Date.now();
  const expiresMs = Math.max(60, Number(input?.expiresIn) || 900) * 1000;
  let intervalMs = Math.max(5, Number(input?.interval) || 5) * 1000;
  while (Date.now() - started < expiresMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: deviceCode,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    const message = String(json.error_description || json.error || `Microsoft sign-in failed with HTTP ${res.status}`);
    throw new Error(message.replace(/\s+/g, ' ').trim());
  }
  throw new Error('Microsoft sign-in expired before it was completed.');
});

ipcMain.handle('graph:refreshToken', async (_e, input: { clientId?: string; refreshToken?: string; scopes?: string[] }) => {
  const clientId = String(input?.clientId || '').trim();
  const refreshToken = String(input?.refreshToken || '').trim();
  if (!clientId || !refreshToken) throw new Error('Microsoft Graph refresh token is unavailable.');
  const scopes = (input?.scopes?.length ? input.scopes : GRAPH_SCOPES).join(' ');
  return graphTokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: scopes,
  });
});

ipcMain.handle('graph:profile', async (_e, input: { accessToken?: string }) => {
  const accessToken = String(input?.accessToken || '').trim();
  if (!accessToken) throw new Error('Microsoft Graph access token is unavailable.');
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(json.error?.message || `Microsoft Graph profile failed with HTTP ${res.status}`);
    throw new Error(message.replace(/\s+/g, ' ').trim());
  }
  return json;
});

ipcMain.handle('graph:sendMail', async (_e, input: { accessToken?: string; to?: string; subject?: string; body?: string; saveToSentItems?: boolean }) => {
  const accessToken = String(input?.accessToken || '').trim();
  const to = String(input?.to || '').trim();
  if (!accessToken) throw new Error('Microsoft Graph access token is unavailable.');
  if (!/.+@.+\..+/.test(to)) throw new Error('A valid recipient email address is required.');
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: String(input?.subject || ''),
        body: {
          contentType: 'Text',
          content: String(input?.body || ''),
        },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: input?.saveToSentItems ?? true,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const message = String(json.error?.message || `Microsoft Graph send failed with HTTP ${res.status}`);
    throw new Error(message.replace(/\s+/g, ' ').trim());
  }
  return true;
});

function runOutlookScript(script: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Local Outlook integration is only available in the Windows desktop app.'));
  }
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || 'Outlook automation failed.').trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

ipcMain.handle('outlook:accounts', async () => {
  const script = `
$ErrorActionPreference = 'Stop'
$outlook = New-Object -ComObject Outlook.Application
$session = $outlook.Session
$accounts = @()
foreach ($account in $session.Accounts) {
  $smtp = [string]$account.SmtpAddress
  if ($smtp) {
    $accounts += [pscustomobject]@{ email = $smtp; displayName = [string]$account.DisplayName }
  }
}
$accounts | ConvertTo-Json -Compress
`;
  const stdout = await runOutlookScript(script);
  if (!stdout) return [];
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
});

ipcMain.handle('outlook:openDraft', async (_e, input: { accountEmail?: string; to?: string; subject?: string; body?: string }) => {
  const accountEmail = String(input?.accountEmail || '').trim();
  const to = String(input?.to || '').trim();
  if (!/.+@.+\..+/.test(to)) throw new Error('A valid recipient email address is required.');
  const payload = Buffer.from(JSON.stringify({
    accountEmail,
    to,
    subject: String(input?.subject || ''),
    body: String(input?.body || ''),
  }), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$input = $json | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$session = $outlook.Session
$mail = $outlook.CreateItem(0)
if ($input.accountEmail) {
  $matchedAccount = $false
  foreach ($account in $session.Accounts) {
    if ([string]::Compare([string]$account.SmtpAddress, [string]$input.accountEmail, $true) -eq 0) {
      $mail.SendUsingAccount = $account
      $matchedAccount = $true
      break
    }
  }
  if (-not $matchedAccount) {
    $mail.SentOnBehalfOfName = [string]$input.accountEmail
  }
}
$mail.To = [string]$input.to
$mail.Subject = [string]$input.subject
$mail.Body = [string]$input.body
$mail.Display($false)
@{ ok = $true } | ConvertTo-Json -Compress
`;
  await runOutlookScript(script);
  return true;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createSplashWindow();
  setTimeout(() => {
    createWindow();
  }, 100);
  setTimeout(() => {
    try {
      createBackup('startup');
    } catch {
      // A missing or invalid workspace should not prevent the app from opening.
    }
  }, 5000).unref?.();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      setTimeout(() => {
        createWindow();
      }, 100);
    }
  });
});

function flushAndReleaseLock(): void {
  if (!workspaceReady) return;
  try {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    syncLocalCacheNow();
  } catch {
    // Local cache remains on disk; do not prevent app shutdown.
  } finally {
    lock.release();
  }
}

app.on('window-all-closed', () => {
  flushAndReleaseLock();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => flushAndReleaseLock());
