import type { PrivacyFlowAPI } from './types';
import { createBrowserPlatform } from './browser';

// -----------------------------------------------------------------------------
// Platform selector. The renderer always runs its full platform logic locally;
// persistence is redirected to the shared workspace file (via the Electron
// workspace bridge, see workspace.ts) when packaged, or localStorage in the
// browser preview. A preload that injects a complete PrivacyFlowAPI directly
// is still honored for forward compatibility.
// -----------------------------------------------------------------------------

let instance: PrivacyFlowAPI | null = null;

export function platform(): PrivacyFlowAPI {
  if (instance) return instance;
  const injected = (globalThis as unknown as { privacyflow?: Partial<PrivacyFlowAPI> }).privacyflow;
  instance =
    injected && typeof injected.cases?.list === 'function'
      ? (injected as PrivacyFlowAPI)
      : createBrowserPlatform();
  return instance;
}