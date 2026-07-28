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

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WorkspaceLock, type LockState } from './lockfile';

const isDev = !app.isPackaged;

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
