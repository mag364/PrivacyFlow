// -----------------------------------------------------------------------------
// Electron preload bridge. Exposes the shared-workspace file/lock surface to
// the renderer. The renderer's platform layer uses window.privacyflow.workspace
// when present (packaged desktop) and localStorage otherwise (browser preview).
// -----------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('privacyflow', {
  isElectron: true,
  workspace: {
    // Synchronous read at boot (the main process has the file ready before
    // the window finishes loading, so this never blocks meaningfully).
    read: (): string | null => ipcRenderer.sendSync('workspace:read'),
    write: (json: string): Promise<boolean> => ipcRenderer.invoke('workspace:write', json),
    lockStatus: () => ipcRenderer.invoke('workspace:lockStatus'),
    recheckLock: () => ipcRenderer.invoke('workspace:recheckLock'),
    claimStale: () => ipcRenderer.invoke('workspace:claimStale'),
    info: () => ipcRenderer.invoke('workspace:info'),
    syncNow: () => ipcRenderer.invoke('workspace:syncNow'),
    choosePath: () => ipcRenderer.invoke('workspace:choosePath'),
  },
  authSession: {
    get: () => ipcRenderer.invoke('authSession:get'),
    set: (userId: string) => ipcRenderer.invoke('authSession:set', userId),
    touch: () => ipcRenderer.invoke('authSession:touch'),
    clear: () => ipcRenderer.invoke('authSession:clear'),
  },
  userSettings: {
    get: (userId: string) => ipcRenderer.invoke('userSettings:get', userId),
    set: (userId: string, settings: unknown) => ipcRenderer.invoke('userSettings:set', userId, settings),
  },
  updater: {
    downloadReleaseAsset: (input: { assetApiUrl: string; token?: string; fileName: string }) =>
      ipcRenderer.invoke('updater:downloadReleaseAsset', input),
    getApplicationFolder: () => ipcRenderer.invoke('updater:getApplicationFolder'),
    chooseApplicationFolder: () => ipcRenderer.invoke('updater:chooseApplicationFolder'),
    applyReleaseAsset: (input: { assetApiUrl: string; token?: string; fileName: string; appFolder?: string }) =>
      ipcRenderer.invoke('updater:applyReleaseAsset', input),
  },
  backup: {
    list: () => ipcRenderer.invoke('backup:list'),
    create: () => ipcRenderer.invoke('backup:create'),
    restore: (input: { fileName: string }) => ipcRenderer.invoke('backup:restore', input),
    delete: (input: { fileName: string }) => ipcRenderer.invoke('backup:delete', input),
  },
  mail: {
    openDraft: (input: { to: string; subject: string; body: string }) => ipcRenderer.invoke('mail:openDraft', input),
  },
  graph: {
    startDeviceLogin: (input: { clientId: string; scopes?: string[] }) => ipcRenderer.invoke('graph:startDeviceLogin', input),
    pollDeviceLogin: (input: { clientId: string; deviceCode: string; interval: number; expiresIn: number }) =>
      ipcRenderer.invoke('graph:pollDeviceLogin', input),
    refreshToken: (input: { clientId: string; refreshToken: string; scopes?: string[] }) =>
      ipcRenderer.invoke('graph:refreshToken', input),
    profile: (input: { accessToken: string }) => ipcRenderer.invoke('graph:profile', input),
    sendMail: (input: { accessToken: string; to: string; subject: string; body: string; saveToSentItems?: boolean }) =>
      ipcRenderer.invoke('graph:sendMail', input),
  },
  outlook: {
    accounts: () => ipcRenderer.invoke('outlook:accounts'),
    openDraft: (input: { accountEmail?: string; to: string; subject: string; body: string }) =>
      ipcRenderer.invoke('outlook:openDraft', input),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
});
