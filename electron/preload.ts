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
    choosePath: () => ipcRenderer.invoke('workspace:choosePath'),
  },
  updater: {
    downloadReleaseAsset: (input: { assetApiUrl: string; token: string; fileName: string }) =>
      ipcRenderer.invoke('updater:downloadReleaseAsset', input),
  },
  mail: {
    openDraft: (input: { to: string; subject: string; body: string }) => ipcRenderer.invoke('mail:openDraft', input),
  },
});
