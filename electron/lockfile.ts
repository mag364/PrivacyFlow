// -----------------------------------------------------------------------------
// Shared-folder lock file protocol (Option 3).
//
// PrivacyFlow's desktop build stores its workspace database on a firm network
// share (e.g. \\FIRM\PrivacyTeam\privacyflow.db.json). Only ONE user may write
// at a time. The lock is a small JSON file (privacyflow.lock) created
// atomically beside the database; everyone else opens the workspace READ-ONLY.
//
// Protocol:
//   1. Try fs.open(lockPath, 'wx') — atomic create-if-absent, honored by SMB.
//   2. If it exists, read the holder info (user, machine, since, heartbeat).
//   3. A lock is STALE if its heartbeat is older than STALE_MS (crashed app),
//      and may then be claimed after confirmation.
//   4. The holder rewrites the lock every HEARTBEAT_MS while running.
//   5. On clean exit the holder deletes the lock.
//   The audit hash chain is unaffected: one writer at a time keeps a single
//   linear, verifiable history.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HEARTBEAT_MS = 15_000;
export const STALE_MS = 90_000;

export interface LockInfo {
  user: string;
  machine: string;
  pid: number;
  since: string; // ISO — when the holder acquired the lock
  heartbeat: string; // ISO — refreshed while the holder is alive
}

export type LockState =
  | { mode: 'write'; info: LockInfo }
  | { mode: 'read-only'; holder: LockInfo; stale: boolean };

export class WorkspaceLock {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private info: LockInfo;

  constructor(
    private readonly dbPath: string,
    userName: string,
  ) {
    this.info = {
      user: userName || os.userInfo().username,
      machine: os.hostname(),
      pid: process.pid,
      since: new Date().toISOString(),
      heartbeat: new Date().toISOString(),
    };
  }

  get lockPath(): string {
    const dir = path.dirname(this.dbPath);
    const base = path.basename(this.dbPath).replace(/\.[^.]+$/, '');
    return path.join(dir, `${base}.lock`);
  }

  /** Attempt to acquire the write lock; otherwise report who holds it. */
  acquire(): LockState {
    try {
      // 'wx' fails with EEXIST if the file is already there — atomic on SMB.
      const fd = fs.openSync(this.lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify(this.info, null, 2));
      fs.closeSync(fd);
      this.startHeartbeat();
      return { mode: 'write', info: this.info };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      return this.readOnlyState();
    }
  }

  /** Re-check the lock (used by the "Retry" button in the UI). */
  recheck(): LockState {
    if (this.heartbeatTimer) return { mode: 'write', info: this.info };
    return this.acquire();
  }

  /** Claim a stale lock left behind by a crashed instance. */
  claimStale(): LockState {
    const state = this.readOnlyState();
    if (!state.stale) return state; // someone is alive — do not steal the lock
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
    return this.acquire();
  }

  release(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        /* already removed */
      }
    }
  }

  private readOnlyState(): LockState {
    let holder: LockInfo;
    try {
      holder = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo;
    } catch {
      // Corrupt/unreadable lock — treat as stale so the user can reclaim it.
      holder = { user: 'unknown', machine: 'unknown', pid: 0, since: '', heartbeat: '' };
    }
    const lastBeat = Date.parse(holder.heartbeat || '') || 0;
    const stale = Date.now() - lastBeat > STALE_MS;
    return { mode: 'read-only', holder, stale };
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      try {
        this.info.heartbeat = new Date().toISOString();
        fs.writeFileSync(this.lockPath, JSON.stringify(this.info, null, 2));
      } catch {
        /* share temporarily unavailable — the next tick retries */
      }
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }
}