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

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
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

function resolveDbPath(): string {
  const shared = process.env.PRIVACYFLOW_WORKSPACE;
  if (shared) return shared;
  return path.join(app.getPath('userData'), 'privacyflow.db.json');
}

let dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const BACKUP_LIMIT = 30;

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
  if (!content && !fs.existsSync(dbPath)) return null;
  const raw = content ?? fs.readFileSync(dbPath, 'utf8');
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
  const tmp = `${dbPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, raw, 'utf8');
  fs.renameSync(tmp, dbPath);
  return { restored: backupEntry(fileName), safetyBackup };
}

function deleteBackup(fileName: string): boolean {
  const backupPath = backupFilePath(fileName);
  if (!fs.existsSync(backupPath)) throw new Error('Backup file was not found.');
  fs.unlinkSync(backupPath);
  return true;
}

let lock = new WorkspaceLock(dbPath, os.userInfo().username);
let lockState: LockState = lock.acquire();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    icon: path.join(__dirname, '../../assets/privacyflow-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

// Read synchronously at boot so the renderer's platform layer stays simple.
ipcMain.on('workspace:read', (event) => {
  try {
    event.returnValue = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  } catch {
    event.returnValue = null;
  }
});

ipcMain.handle('workspace:write', async (_e, json: string) => {
  if (lockState.mode !== 'write') {
    const holder = lockState.mode === 'read-only' ? lockState.holder : null;
    throw new Error(
      holder
        ? `Workspace is read-only — ${holder.user} on ${holder.machine} is currently editing.`
        : 'Workspace is read-only.',
    );
  }
  // Write-then-rename so a crash mid-write can't corrupt the shared file.
  const tmp = `${dbPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dbPath);
  try {
    createBackup('auto', json);
  } catch {
    // Do not block the primary shared-workspace save if the local backup fails.
  }
  return true;
});

ipcMain.handle('workspace:lockStatus', async () => lockState);

ipcMain.handle('workspace:recheckLock', async () => {
  lockState = lock.recheck();
  return lockState;
});

ipcMain.handle('workspace:claimStale', async () => {
  lockState = lock.claimStale();
  return lockState;
});

ipcMain.handle('workspace:info', async () => ({ dbPath, lockState }));

// Let the user repoint the workspace at a different (e.g. shared) folder from
// Settings. Releases the current lock, switches path, and re-acquires. The
// renderer reloads afterwards so all data is re-read from the new location.
ipcMain.handle('workspace:choosePath', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the shared workspace folder',
    defaultPath: path.dirname(dbPath),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const nextPath = path.join(result.filePaths[0], 'privacyflow.db.json');
  if (nextPath === dbPath) return { dbPath, lockState, changed: false };

  lock.release();
  dbPath = nextPath;
  lock = new WorkspaceLock(dbPath, os.userInfo().username);
  lockState = lock.acquire();
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

ipcMain.handle('updater:downloadReleaseAsset', async (_e, input: { assetApiUrl?: string; token?: string; fileName?: string }) => {
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
  shell.showItemInFolder(filePath);
  const openError = await shell.openPath(filePath);
  return { filePath, opened: !openError };
});

ipcMain.handle('mail:openDraft', async (_e, input: { to?: string; subject?: string; body?: string }) => {
  const to = String(input?.to || '').trim();
  if (!/.+@.+\..+/.test(to)) throw new Error('A valid recipient email address is required.');
  const subject = encodeURIComponent(String(input?.subject || ''));
  const body = encodeURIComponent(String(input?.body || ''));
  const url = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
  return shell.openExternal(url);
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
  foreach ($account in $session.Accounts) {
    if ([string]::Compare([string]$account.SmtpAddress, [string]$input.accountEmail, $true) -eq 0) {
      $mail.SendUsingAccount = $account
      break
    }
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
  try {
    createBackup('startup');
  } catch {
    // A missing or invalid workspace should not prevent the app from opening.
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  lock.release();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => lock.release());
