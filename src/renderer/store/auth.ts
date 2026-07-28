import { create } from 'zustand';
import type { User } from '@shared/types';
import type { Permission, Role } from '@shared/constants';
import { ROLE_PERMISSIONS } from '@shared/constants';
import { platform } from '../platform';

// -----------------------------------------------------------------------------
// Authentication + session store. Backed by the platform layer so it works
// identically in the browser preview and the packaged desktop app.
// -----------------------------------------------------------------------------

export interface PendingPasswordChange {
  username: string;
  name: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  // Set when login succeeds but the account must set a new password first.
  pendingPasswordChange: PendingPasswordChange | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  // Set a new password for the pending account; signs the user in on success.
  completePasswordChange: (currentPassword: string, newPassword: string) => Promise<boolean>;
  cancelPasswordChange: () => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  error: null,
  pendingPasswordChange: null,
  async init() {
    const user = await platform().auth.currentUser();
    set({ user });
  },
  async login(username, password) {
    set({ loading: true, error: null });
    const result = await platform().auth.login(username, password);
    if (result.ok && result.user) {
      set({ user: result.user, loading: false, error: null, pendingPasswordChange: null });
      return true;
    }
    if (result.mustChangePassword) {
      set({
        loading: false,
        error: null,
        pendingPasswordChange: {
          username: username.trim(),
          name: result.user?.name ?? username.trim(),
        },
      });
      return false;
    }
    set({ loading: false, error: result.error ?? 'Unable to sign in.' });
    return false;
  },
  async completePasswordChange(currentPassword, newPassword) {
    const pending = get().pendingPasswordChange;
    if (!pending) return false;
    set({ loading: true, error: null });
    const result = await platform().auth.changePassword(pending.username, currentPassword, newPassword);
    if (result.ok && result.user) {
      set({ user: result.user, loading: false, error: null, pendingPasswordChange: null });
      return true;
    }
    set({ loading: false, error: result.error ?? 'Unable to set new password.' });
    return false;
  },
  cancelPasswordChange() {
    set({ pendingPasswordChange: null, error: null });
  },
  async logout() {
    await platform().auth.logout();
    set({ user: null });
  },
}));

// Permission check used to gate UI actions per role.
export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}