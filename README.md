# PrivacyFlow

**DSR Tracking** — Data Subject Request (DSR) management with a tamper-evident audit
trail. Built as a desktop-oriented application (Electron) whose renderer also runs
standalone in the browser against a localStorage fallback — which is what powers
this preview.

## Highlights

- **Operational dashboard** — live SLA health, workload, risk, and completion metrics.
- **Case management** — sortable/filterable case list, intake form with validation,
  and a full case workspace (overview, documents, communications, notes, audit log).
- **Projects register** — standalone project records with their own communications,
  parent/child grouping by project name, and Excel exports with native collapsible
  row groups.
- **Statutory SLA engine** — calendar/business-day due dates, pausing, and
  overdue/due-soon health (`src/shared/sla.ts`, unit tested).
- **Tamper-evident audit trail** — every material action is appended to a
  SHA-256 hash-linked chain; the Audit Integrity screen re-verifies the chain and
  reports any break (`src/shared/audit.ts`, unit tested).
- **Role-based UI** — administrator / privacy manager / analyst / reviewer / auditor.
- **User management** — administrators add users from Settings → Users; each new
  account gets a generated temporary password and must set its own at first sign-in.
- **Shared team workspace** — see below.
- **Liquid Glass design system** — dark/light themes, high-contrast and
  reduced-transparency/motion accessibility modes.

## Shared team workspace (desktop builds)

For small teams, the packaged app can share one workspace over a firm network
share using a **single-writer lock-file protocol** — no server or external
database required:

1. Set the `PRIVACYFLOW_WORKSPACE` environment variable on each machine to the
   same shared file path, e.g. `\\FIRM\PrivacyTeam\privacyflow.db.json`.
2. The first person to open the app holds the lock (`privacyflow.lock`, created
   atomically beside the database) and can edit normally.
3. Everyone else opens in **read-only mode** — full visibility (ideal for the
   auditor profile) with edits disabled, plus a banner showing who holds the
   lock, a **Retry** button, and automatic detection of stale locks left by a
   crash (with a one-click takeover).
4. Writes are atomic (write-then-rename), the holder refreshes the lock every
   15 seconds, and the single-writer model keeps the audit hash chain linear
   and verifiable.

Authentication sessions are local to each Windows profile and workspace. Each
PC remembers its own signed-in user until that user signs out or the configured
inactivity timeout expires; a login on one PC never changes another PC's user.

If `PRIVACYFLOW_WORKSPACE` is not set, each install keeps a private per-user
database — suitable for solo use.

## Architecture

The renderer depends only on the `PrivacyFlowAPI` interface
(`src/renderer/platform/types.ts`). Persistence is swappable without touching
feature code:

| Runtime | Storage | Files |
| --- | --- | --- |
| Browser preview | `localStorage` + seed data | `src/renderer/platform/browser.ts` |
| Packaged desktop | Shared JSON file on network share, lock-file guarded | `electron/main.ts`, `electron/lockfile.ts`, `electron/preload.ts`, `src/renderer/platform/workspace.ts` |

## Getting started

```bash
npm install
npm run dev      # start the Vite preview
npm run build    # production build
npm test         # run SLA + audit unit tests
```

## Signing in

The workspace is provisioned with a single **administrator** account:
username `admin` (accepts any password in this preview until a real password
is set). Create further accounts from **Settings → Users** — each receives a
generated temporary password and must set their own at first sign-in.

Start over any time via **Settings → Organization → Reset application**, which
wipes all records, users, and settings and restarts the setup wizard.

## Notes & assumptions

- All demonstration data is **fictional** and marked `demo: true`.
- The preview persists to `localStorage`; clearing site data resets it.
- PrivacyFlow is a workflow/record-keeping tool and does not provide legal advice.
