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
import { WorkspaceLock, type LockState } from './lockfile';

const isDev = !app.isPackaged;
const M365_SCOPES = ['offline_access', 'User.Read', 'Mail.Send'];

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

function tenantSegment(value?: string): string {
  return String(value || '').trim() || 'common';
}

function formBody(values: Record<string, string | string[]>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    body.set(key, Array.isArray(value) ? value.join(' ') : value);
  }
  return body;
}

async function readJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return { error_description: text };
  }
}

function microsoftError(payload: Record<string, unknown>, fallback: string): Error {
  return new Error(
    String(payload.error_description || payload.error || payload.message || fallback),
  );
}

function resolveDbPath(): string {
  const shared = process.env.PRIVACYFLOW_WORKSPACE;
  if (shared) return shared;
  return path.join(app.getPath('userData'), 'privacyflow.db.json');
}

let dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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
  return { dbPath, lockState, changed: true };
});

ipcMain.handle('updater:downloadReleaseAsset', async (_e, input: { assetApiUrl?: string; token?: string; fileName?: string }) => {
  const assetApiUrl = String(input?.assetApiUrl || '').trim();
  const token = String(input?.token || '').trim();
  if (!assetApiUrl || !assetApiUrl.startsWith('https://api.github.com/')) {
    throw new Error('A valid GitHub release asset URL is required.');
  }
  if (!token) throw new Error('A GitHub token is required to download updates from the private repository.');

  const res = await fetch(assetApiUrl, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
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

ipcMain.handle('m365:requestDeviceCode', async (_e, input: { tenantId?: string; clientId?: string; scopes?: string[] }) => {
  const clientId = String(input?.clientId || '').trim();
  if (!clientId) throw new Error('Microsoft Entra application client ID is required.');
  const scopes = Array.isArray(input?.scopes) && input.scopes.length ? input.scopes : M365_SCOPES;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantSegment(input?.tenantId))}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: clientId, scope: scopes }),
  });
  const payload = await readJsonResponse(res);
  if (!res.ok) throw microsoftError(payload, `Microsoft device-code request failed with HTTP ${res.status}.`);
  shell.openExternal(String(payload.verification_uri || 'https://microsoft.com/devicelogin'));
  return payload;
});

ipcMain.handle('m365:pollDeviceCode', async (_e, input: { tenantId?: string; clientId?: string; deviceCode?: string }) => {
  const clientId = String(input?.clientId || '').trim();
  const deviceCode = String(input?.deviceCode || '').trim();
  if (!clientId || !deviceCode) throw new Error('Microsoft device-code polling requires a client ID and device code.');
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantSegment(input?.tenantId))}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    }),
  });
  const payload = await readJsonResponse(res);
  if (!res.ok) throw microsoftError(payload, `Microsoft token request failed with HTTP ${res.status}.`);
  return payload;
});

ipcMain.handle('m365:refreshToken', async (_e, input: { tenantId?: string; clientId?: string; refreshToken?: string; scopes?: string[] }) => {
  const clientId = String(input?.clientId || '').trim();
  const refreshToken = String(input?.refreshToken || '').trim();
  if (!clientId || !refreshToken) throw new Error('Microsoft token refresh requires a client ID and refresh token.');
  const scopes = Array.isArray(input?.scopes) && input.scopes.length ? input.scopes : M365_SCOPES;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantSegment(input?.tenantId))}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope: scopes,
    }),
  });
  const payload = await readJsonResponse(res);
  if (!res.ok) throw microsoftError(payload, `Microsoft token refresh failed with HTTP ${res.status}.`);
  return payload;
});

ipcMain.handle('m365:profile', async (_e, input: { accessToken?: string }) => {
  const token = String(input?.accessToken || '').trim();
  if (!token) throw new Error('Microsoft profile lookup requires an access token.');
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await readJsonResponse(res);
  if (!res.ok) throw microsoftError(payload, `Microsoft Graph profile lookup failed with HTTP ${res.status}.`);
  return payload;
});

ipcMain.handle('m365:sendMail', async (_e, input: { accessToken?: string; to?: string; subject?: string; body?: string; saveToSentItems?: boolean }) => {
  const token = String(input?.accessToken || '').trim();
  const to = String(input?.to || '').trim();
  if (!token) throw new Error('Microsoft Graph sendMail requires an access token.');
  if (!/.+@.+\..+/.test(to)) throw new Error('A valid recipient email address is required.');
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: String(input?.subject || ''),
        body: { contentType: 'Text', content: String(input?.body || '') },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: input?.saveToSentItems !== false,
    }),
  });
  if (!res.ok) throw microsoftError(await readJsonResponse(res), `Microsoft Graph sendMail failed with HTTP ${res.status}.`);
  return true;
});

app.whenReady().then(() => {
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
