import { addDays, isSameMonth, parseISO } from 'date-fns';
import type {
  DsrCase, AuditEvent, IntegrityReport, OrgSettings, CaseNote, SlaInfo, Project, SlaRule,
  EmailTemplate, AutomationRule, AutomationTrigger, AutomationRecipient, User, CaseDocument, Communication,
  SourceEmail,
} from '@shared/types';
import type { CaseStatus, ProjectStatus } from '@shared/constants';
import { CASE_STATUSES, OPEN_STATUSES, PROJECT_STATUSES, LEGACY_STATUS_MAP } from '@shared/constants';
import { APP_CONFIG } from '@shared/config';
import { computeDueDate } from '@shared/sla';
import { verifyChain } from '@shared/audit';
import { generateTempPassword, hashPassword, PASSWORD_MIN_LENGTH } from '@shared/password';
import type {
  PrivacyFlowAPI, DashboardMetrics, NewCaseInput, NewProjectInput, CompleteSetupInput,
  LoginResult, NameValue, CreateUserInput, CreateUserResult, UpdateUserInput,
  AddDocumentInput, AddCommunicationInput, ImportSummary,
} from './types';
import {
  type Db, appendAudit, createSeed, nextActionFor, nextCaseNumber, nextProjectNumber,
  uid, fakeHash,
} from './seed';
import { workspaceBridge, isReadOnly, mailBridge, outlookBridge } from './workspace';

// -----------------------------------------------------------------------------
// Persistence-backed implementation of PrivacyFlowAPI.
//
// Two storage backends share this exact logic:
//   * Browser preview   -> localStorage.
//   * Packaged desktop  -> the shared JSON file on the firm network share,
//     written only while this instance holds the lock file (single writer).
// When the lock is held by someone else the workspace opens READ-ONLY: reads
// work everywhere (ideal for the auditor profile) and every data mutation
// throws a clear error, which the UI surfaces. Session-only state (sign-in,
// audit verification results) is kept in memory without persisting.
// -----------------------------------------------------------------------------

const KEY = 'privacyflow.db.v1';

function assertWritable(): void {
  if (isReadOnly()) {
    throw new Error(
      'Workspace is read-only — another user is currently editing. You can view everything, but changes are disabled until the lock is free.',
    );
  }
}

function defaultSlaRules(): SlaRule[] {
  return APP_CONFIG.slaRules.map((r) => ({
    jurisdiction: r.jurisdiction,
    periodDays: r.periodDays,
    businessDays: r.businessDays,
    note: r.note,
  }));
}

function defaultEmailTemplates(): EmailTemplate[] {
  return [
    {
      id: 'tpl-acknowledgement',
      name: 'Request acknowledgement',
      subject: 'We received your privacy request ({{case.number}})',
      body: 'Dear {{requester.lastName}},\n\nThis confirms we have received your {{case.types}} request, logged as {{case.number}} on {{case.receivedDate}}.\n\nKind regards,\n{{org.name}} Privacy Office',
      audience: 'requester',
    },
    {
      id: 'tpl-standard-response',
      name: 'Standard response',
      subject: 'Response to your privacy request ({{case.number}})',
      body: 'Dear {{requester.lastName}},\n\nThank you for your {{case.types}} request ({{case.number}}). This is our standard response confirming next steps and the expected timeline.\n\nKind regards,\n{{org.name}} Privacy Office',
      audience: 'requester',
    },
    {
      id: 'tpl-dept-search',
      name: 'Forward to Ron K.',
      subject: 'Data search required — {{case.number}}',
      body: 'Hello {{rule.department}} team,\n\nPlease search your systems for personal data relating to {{requester.lastName}} ({{requester.email}}) in support of privacy request {{case.number}} ({{case.types}}).\n\nThank you,\n{{org.name}} Privacy Office',
      audience: 'department',
      department: 'Ron K.',
    },
    {
      id: 'tpl-fulfilled',
      name: 'Request closed',
      subject: 'Your privacy request {{case.number}} is complete',
      body: 'Dear {{requester.lastName}},\n\nYour {{case.types}} request ({{case.number}}) has been completed and closed. A summary of the actions taken is attached.\n\nKind regards,\n{{org.name}} Privacy Office',
      audience: 'requester',
    },
  ];
}

function defaultAutomationRecipients(): AutomationRecipient[] {
  return [
    { id: 'recipient-ron-k', name: 'Ron K.', email: '', enabled: true },
    { id: 'recipient-customer-support', name: 'Customer Support', email: '', enabled: true },
    { id: 'recipient-marketing', name: 'Marketing', email: '', enabled: true },
    { id: 'recipient-sales', name: 'Sales', email: '', enabled: true },
    { id: 'recipient-people', name: 'People', email: '', enabled: true },
    { id: 'recipient-finance', name: 'Finance', email: '', enabled: true },
    { id: 'recipient-legal', name: 'Legal', email: '', enabled: true },
    { id: 'recipient-it', name: 'IT', email: '', enabled: true },
    { id: 'recipient-engineering', name: 'Engineering', email: '', enabled: true },
  ];
}

function defaultAutomationRules(): AutomationRule[] {
  return [
    { id: 'rule-ack-on-create', name: 'Acknowledge new requests', trigger: 'case.created', templateId: 'tpl-acknowledgement', enabled: true },
    { id: 'rule-standard-response', name: 'Standard response sent', trigger: 'status.changed', toStatus: 'Email Response Sent', templateId: 'tpl-standard-response', enabled: true },
    { id: 'rule-forward-ron', name: 'Forward email to Ron K.', trigger: 'status.changed', toStatus: 'Email Ron K.', templateId: 'tpl-dept-search', enabled: true },
    { id: 'rule-closed', name: 'Notify requester on closure', trigger: 'status.changed', toStatus: 'Closed', templateId: 'tpl-fulfilled', enabled: true },
  ];
}

function defaultSettings(): OrgSettings {
  return {
    organizationName: APP_CONFIG.defaults.organizationName,
    caseNumberPrefix: APP_CONFIG.defaults.caseNumberPrefix,
    defaultJurisdiction: APP_CONFIG.defaults.defaultJurisdiction,
    autoLockMinutes: APP_CONFIG.defaults.autoLockMinutes,
    theme: 'dark',
    setupComplete: false,
    demoDataInstalled: false,
    slaRules: defaultSlaRules(),
    reminderCadenceDays: [...APP_CONFIG.reminderCadenceDays],
    dueSoonThresholdDays: 5,
    autoPauseSla: true,
    escalationAlerts: true,
    emailTemplates: defaultEmailTemplates(),
    automationRules: defaultAutomationRules(),
    automationRecipients: defaultAutomationRecipients(),
    m365: { connected: false, mode: 'simulated' },
  };
}

function ruleFor(settings: OrgSettings, jurisdiction: string): SlaRule {
  const rules = Array.isArray(settings.slaRules) && settings.slaRules.length
    ? settings.slaRules
    : defaultSlaRules();
  return rules.find((r) => r.jurisdiction === jurisdiction) ?? rules[rules.length - 1];
}

// ---- Field-level change summaries for the audit trail -------------------------
//
// Produces a human-readable "what changed" string by diffing the record before
// and after an update, e.g.:
//   Case DSRREQ0002568 updated (status: New → Email Response Sent; description changed)
// Deep objects (subject, intakeDates) are compared field-by-field so the
// summary names the specific nested field that changed.

const FIELD_LABELS: Record<string, string> = {
  status: 'status',
  requestTypes: 'request types',
  intakeChannel: 'intake channel',
  description: 'description',
  jurisdiction: 'jurisdiction',
  businessUnit: 'business unit',
  priority: 'priority',
  risk: 'risk',
  ownerId: 'owner',
  team: 'team',
  verificationStatus: 'verification status',
  closureSummary: 'closure summary',
  resolutionDate: 'resolution date',
  subject: 'requester',
  intakeDates: 'intake timeline',
  sla: 'SLA',
  // Project fields
  projectName: 'project name',
  source: 'source',
  dateNotificationReceived: "date notification rec'd",
  notificationCancelled: 'project cancelled',
  ritmNumber: 'RITM number',
  investmentClass: 'investment class',
  fiscalYear: 'fiscal year',
  piaNumber: 'PIA number',
  ssdsTask: 'SSDS task',
  ssdsType: 'SSDS type',
  projectUid: 'project UID',
  businessSponsors: 'business sponsors',
  demandNumber: 'demand number',
  assetsMentioned: 'assets mentioned',
  comments: 'comments',
};

const NESTED_LABELS: Record<string, Record<string, string>> = {
  subject: {
    lastName: 'last name',
    emails: 'email',
    phones: 'phone',
    relationship: 'relationship',
    minor: 'minor flag',
    authorizedAgent: 'authorized agent flag',
    clientCenterStatus: 'Client Center status',
    emailedFA: 'emailed FA date',
    identifiers: 'identifiers',
  },
  intakeDates: {
    dateClientServiceReceivedEmail: "Client Svcs. rec'd email date",
    dateDppReceivedEmail: "DPP rec'd email date",
    standardResponseSent: 'standard response sent date',
    forwardedEmailToRon: 'forwarded to Ron K. date',
    followUpEmailSent: 'follow-up email sent date',
  },
};

// Fields that change as a side effect of saving (timestamps) — not meaningful
// to report as "edited".
const IGNORED_KEYS = new Set(['id', 'updatedAt', 'lastActivityAt', 'createdAt', 'createdBy', 'demo']);

function shortVal(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ') || '—';
  const s = String(v);
  // ISO timestamps → date only for readability.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

function diffSummary(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const changes: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (IGNORED_KEYS.has(key)) continue;
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b ?? null) === JSON.stringify(a ?? null)) continue;

    const label = FIELD_LABELS[key] ?? key;
    const nested = NESTED_LABELS[key];
    if (nested && typeof b === 'object' && typeof a === 'object' && b && a) {
      // Diff nested object field-by-field for a precise summary.
      const subKeys = new Set([...Object.keys(b as object), ...Object.keys(a as object)]);
      for (const sk of subKeys) {
        const sb = (b as Record<string, unknown>)[sk];
        const sa = (a as Record<string, unknown>)[sk];
        if (JSON.stringify(sb ?? null) === JSON.stringify(sa ?? null)) continue;
        const subLabel = nested[sk] ?? `${label} ${sk}`;
        changes.push(`${subLabel}: ${shortVal(sb)} → ${shortVal(sa)}`);
      }
      continue;
    }

    // For long free-text fields, note the change without dumping the content.
    if (key === 'description' || key === 'comments') {
      changes.push(`${label} changed`);
      continue;
    }
    changes.push(`${label}: ${shortVal(b)} → ${shortVal(a)}`);
  }
  if (!changes.length) return '';
  const MAX = 4;
  const shown = changes.slice(0, MAX).join('; ');
  return changes.length > MAX ? `${shown}; +${changes.length - MAX} more` : shown;
}

// ---- Email automation engine -------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function fmtShort(iso?: string): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d);
}

function renderTemplate(text: string, c: DsrCase, orgName: string, department?: string): string {
  const map: Record<string, string> = {
    'requester.lastName': c.subject.lastName,
    'requester.email': c.subject.emails[0] ?? '',
    'case.number': c.caseNumber,
    'case.types': c.requestTypes.join(', '),
    'case.status': c.status,
    'case.receivedDate': fmtShort(c.sla.receivedDate),
    'org.name': orgName,
    'rule.department': department ?? '',
  };
  return text.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (m, key) => map[key] ?? m);
}

function formatOriginalEmail(source: SourceEmail): string {
  const from = source.fromEmail
    ? (source.fromName ? `${source.fromName} <${source.fromEmail}>` : source.fromEmail)
    : 'Unknown sender';
  return [
    '',
    '',
    '----- Original Message -----',
    `From: ${from}`,
    source.to ? `To: ${source.to}` : '',
    source.date ? `Date: ${source.date}` : '',
    `Subject: ${source.subject}`,
    '',
    source.bodyText,
  ].filter((line) => line !== '').join('\n');
}

function prefixedSubject(prefix: 'RE' | 'FW', subject: string): string {
  const clean = subject.trim();
  return new RegExp(`^${prefix}:`, 'i').test(clean) ? clean : `${prefix}: ${clean}`;
}

function sourceEmailForCase(d: Db, caseId: string): SourceEmail | null {
  return [...d.communications]
    .filter((comm) => comm.caseId === caseId && comm.direction === 'Inbound' && comm.sourceEmail)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]?.sourceEmail ?? null;
}

function resolveAutomationRecipient(settings: OrgSettings, name?: string): { label: string; email: string } {
  const label = name?.trim() || 'Department';
  const match = (settings.automationRecipients ?? []).find(
    (recipient) => recipient.enabled && recipient.name.trim().toLowerCase() === label.toLowerCase(),
  );
  return { label, email: match?.email.trim() ?? '' };
}

async function runAutomations(
  d: Db,
  c: DsrCase,
  trigger: AutomationTrigger,
  ctx: { toStatus?: string },
): Promise<void> {
  const rules = (d.settings.automationRules ?? []).filter((r) => r.enabled && r.trigger === trigger);
  if (!rules.length) return;

  const m365 = d.settings.m365;
  const viaM365 = !!m365?.connected;
  const sender = viaM365 ? (m365.accountEmail ?? 'connected mailbox') : null;

  for (const rule of rules) {
    if (trigger === 'status.changed' && rule.toStatus && rule.toStatus !== ctx.toStatus) continue;
    const tpl = (d.settings.emailTemplates ?? []).find((t) => t.id === rule.templateId);
    if (!tpl) continue;

    const isDept = tpl.audience === 'department';
    const sourceEmail = sourceEmailForCase(d, c.id);
    const resolved = isDept ? resolveAutomationRecipient(d.settings, tpl.department) : null;
    const recipient = isDept
      ? (resolved?.email || `${resolved?.label ?? 'Department'} team`)
      : (sourceEmail?.fromEmail ?? c.subject.emails[0] ?? 'requester');
    const recipientLabel = isDept && resolved?.email ? `${resolved.label} <${resolved.email}>` : recipient;
    const renderedSubject = renderTemplate(tpl.subject, c, d.settings.organizationName, tpl.department);
    const subject = sourceEmail
      ? prefixedSubject(isDept ? 'FW' : 'RE', sourceEmail.subject)
      : renderedSubject;
    const body = `${renderTemplate(tpl.body, c, d.settings.organizationName, tpl.department)}${sourceEmail ? formatOriginalEmail(sourceEmail) : ''}`;
    const now = new Date().toISOString();
    const outlook = m365?.mode === 'outlook' ? outlookBridge() : null;
    const fallbackDraft = m365?.mode === 'outlook' ? mailBridge() : null;
    let deliveryNote = '';
    let deliveryStatus = 'Logged only';

    if (m365?.mode === 'outlook' && /.+@.+\..+/.test(recipient)) {
      try {
        if (outlook) {
          await outlook.openDraft({ accountEmail: m365.accountEmail, to: recipient, subject, body });
          deliveryStatus = 'Draft opened in Outlook';
        } else if (fallbackDraft) {
          await fallbackDraft.openDraft({ to: recipient, subject, body });
          deliveryStatus = 'Draft opened in default mail app';
          deliveryNote = '\n\nOpened with the default mail app because local Outlook automation was unavailable.';
        } else {
          deliveryStatus = 'Draft not opened';
          deliveryNote = '\n\nDraft was not opened because local Outlook automation is unavailable in this environment.';
        }
      } catch (e) {
        deliveryStatus = 'Draft not opened';
        deliveryNote = `\n\nDraft was not opened: ${e instanceof Error ? e.message : 'Outlook automation failed.'}`;
      }
    } else if (m365?.mode === 'outlook') {
      deliveryStatus = 'Draft not opened';
      deliveryNote = `\n\nOutlook draft was not opened because ${recipient} does not have a configured email address. Add it in Automation > Recipients.`;
    } else if (m365?.mode === 'simulated') {
      deliveryStatus = 'Simulated only';
      deliveryNote = '\n\nBrowser preview records simulated delivery only. Open the Windows desktop app and connect Microsoft 365 (Outlook) to create drafts.';
    } else {
      deliveryNote = '\n\nNo Microsoft 365 (Outlook) mailbox is connected, so PrivacyFlow logged this automation only.';
    }

    d.communications.push({
      id: uid(),
      caseId: c.id,
      direction: 'Outbound',
      channel: viaM365 ? 'Email (Microsoft 365)' : 'Email',
      subject,
      summary: `[Automated · ${rule.name}]${sender ? ` From: ${sender}` : ''} To: ${recipientLabel}${deliveryNote}\n\n${body}`,
      sentAt: now,
      status: deliveryStatus,
      createdBy: 'automation',
    });
    c.lastActivityAt = now;

    await appendAudit(d, { id: 'automation', name: 'Automation engine', role: 'system' }, {
      category: 'Automation',
      action: 'automation.email_draft',
      entityType: 'communication',
      entityId: c.id,
      caseId: c.id,
      summary: `Automated email "${tpl.name}" ${deliveryStatus.toLowerCase()} for ${recipientLabel} (${rule.name})${sender ? ` via ${sender}` : ''}`,
      newValue: { rule: rule.name, template: tpl.name, recipient: recipientLabel, subject, status: deliveryStatus, via: sender ?? 'local log' },
    });
  }
}

// ---- One-time data cleanup ----------------------------------------------------
//
// Earlier builds seeded fictional demo profiles (Jordan, Maya, etc.) into the
// workspace. This migration removes every account except the primary user —
// Ava Reynolds — from existing workspaces, remapping record references (case
// owners, note authors, decision makers) onto her so nothing dangles. It runs
// once per workspace and only when more than one user exists.

const PRIMARY_USER_NAME = 'ava reynolds';

async function cleanupUsers(d: Db): Promise<void> {
  if (d.users.length <= 1) return;
  const primary = d.users.find((u) => u.name.trim().toLowerCase() === PRIMARY_USER_NAME);
  if (!primary) return; // no primary account — leave the workspace untouched

  const removedIds = new Set(d.users.filter((u) => u.id !== primary.id).map((u) => u.id));
  d.users = [primary];

  // Ensure the workspace always has an administrator.
  if (primary.role !== 'administrator') primary.role = 'administrator';

  for (const c of d.cases) {
    if (c.ownerId && removedIds.has(c.ownerId)) c.ownerId = primary.id;
    if (removedIds.has(c.createdBy)) c.createdBy = primary.id;
  }
  for (const n of d.notes) if (removedIds.has(n.authorId)) n.authorId = primary.id;
  for (const t of d.tasks) if (removedIds.has(t.createdBy)) t.createdBy = primary.id;
  for (const doc of d.documents) if (removedIds.has(doc.uploadedBy)) doc.uploadedBy = primary.id;
  for (const dec of d.decisions) if (removedIds.has(dec.decisionMakerId)) dec.decisionMakerId = primary.id;
  for (const p of d.projects) if (removedIds.has(p.createdBy)) p.createdBy = primary.id;
  if (d.currentUserId && removedIds.has(d.currentUserId)) d.currentUserId = primary.id;

  await appendAudit(d, { id: primary.id, name: primary.name, role: primary.role }, {
    category: 'User',
    action: 'users.cleaned',
    entityType: 'user',
    entityId: primary.id,
    summary: `Removed ${removedIds.size} unused account(s); ${primary.name} is now the only workspace user`,
  });
}

// ---- Legacy workflow migration -------------------------------------------------
//
// Maps request statuses from earlier versions onto the current workflow
// (New → Email Response Sent → Email Ron K. → Follow-up Email Sent → Closed)
// and defaults projects created before the workflow field existed to New.

function migrateWorkflow(d: Db): boolean {
  let changed = false;
  for (const c of d.cases) {
    const mapped = LEGACY_STATUS_MAP[String(c.status)];
    if (mapped) {
      c.status = mapped;
      c.nextAction = nextActionFor(mapped);
      if (!OPEN_STATUSES.includes(mapped) && !c.sla.closureDate) {
        c.sla.closureDate = new Date().toISOString();
        c.resolutionDate = c.sla.closureDate;
      }
      changed = true;
    }
  }
  for (const p of d.projects) {
    if (!p.status || !PROJECT_STATUSES.includes(p.status as ProjectStatus)) {
      p.status = 'New';
      changed = true;
    }
  }
  // Retarget automation rules that referenced removed statuses.
  for (const r of d.settings.automationRules ?? []) {
    if (r.trigger === 'status.changed' && r.toStatus) {
      const current = r.toStatus as string;
      if (!(CASE_STATUSES as readonly string[]).includes(current)) {
        r.toStatus = LEGACY_STATUS_MAP[current] ?? 'Closed';
        changed = true;
      }
    }
  }
  return changed;
}

function removeRequesterFirstNamePlaceholder(text: string): string {
  return text
    .replace(/\{\{\s*requester\.firstName\s*\}\}\s+\{\{\s*requester\.lastName\s*\}\}/g, '{{requester.lastName}}')
    .replace(/\{\{\s*requester\.firstName\s*\}\}/g, '{{requester.lastName}}')
    .replace(/\s*We will respond by\s+\{\{\s*case\.dueDate\s*\}\}\./gi, '')
    .replace(/\s*\(due\s+\{\{\s*case\.dueDate\s*\}\}\)/gi, '')
    .replace(/\s*The statutory due date is\s+\{\{\s*case\.dueDate\s*\}\}\./gi, '')
    .replace(/\{\{\s*case\.dueDate\s*\}\}/g, '');
}

function migrateRequesterFirstNameTemplates(d: Db): boolean {
  let changed = false;
  for (const template of d.settings.emailTemplates ?? []) {
    const subject = removeRequesterFirstNamePlaceholder(template.subject);
    const body = removeRequesterFirstNamePlaceholder(template.body);
    if (subject !== template.subject || body !== template.body) {
      template.subject = subject;
      template.body = body;
      changed = true;
    }
  }
  return changed;
}

function migrateRequestTypeNames(d: Db): boolean {
  let changed = false;
  for (const c of d.cases) {
    const nextTypes = c.requestTypes.map((type) => (String(type) === 'Do Not Sale' ? 'Do Not Sell' : type));
    if (nextTypes.some((type, index) => type !== c.requestTypes[index])) {
      c.requestTypes = nextTypes as typeof c.requestTypes;
      changed = true;
    }
  }
  return changed;
}

let cache: Db | null = null;

function load(): Db | null {
  if (cache) return cache;
  const bridge = workspaceBridge();
  const raw = bridge ? bridge.read() : localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    cache = JSON.parse(raw) as Db;
    if (!Array.isArray(cache.projects)) cache.projects = [];
    if (typeof cache.projectSeq !== 'number') cache.projectSeq = 0;
    const d = defaultSettings();
    const s = cache.settings as OrgSettings;
    if (!Array.isArray(s.slaRules) || !s.slaRules.length) s.slaRules = d.slaRules;
    if (!Array.isArray(s.reminderCadenceDays)) s.reminderCadenceDays = d.reminderCadenceDays;
    if (typeof s.dueSoonThresholdDays !== 'number') s.dueSoonThresholdDays = d.dueSoonThresholdDays;
    if (typeof s.autoPauseSla !== 'boolean') s.autoPauseSla = d.autoPauseSla;
    if (typeof s.escalationAlerts !== 'boolean') s.escalationAlerts = d.escalationAlerts;
    if (!Array.isArray(s.emailTemplates)) s.emailTemplates = d.emailTemplates;
    if (!Array.isArray(s.automationRules)) s.automationRules = d.automationRules;
    if (!Array.isArray(s.automationRecipients)) s.automationRecipients = d.automationRecipients;
    if (!s.m365 || typeof s.m365.connected !== 'boolean') s.m365 = d.m365;
    const workflowMigrated = migrateWorkflow(cache);
    const templateMigrated = migrateRequesterFirstNameTemplates(cache);
    const requestTypeMigrated = migrateRequestTypeNames(cache);
    const migrated = workflowMigrated || templateMigrated || requestTypeMigrated;
    if (migrated && !isReadOnly()) save(cache);
    return cache;
  } catch {
    return null;
  }
}

function save(db: Db): void {
  cache = db;
  const bridge = workspaceBridge();
  if (bridge) {
    // Read-only instances (e.g. the auditor while a colleague holds the lock)
    // keep session state in memory only — nothing is written to the share.
    if (isReadOnly()) return;
    void bridge.write(JSON.stringify(db)).catch((err) => {
      console.error('Workspace write failed:', err);
    });
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(db));
}

function db(): Db {
  const d = load();
  if (!d) throw new Error('Workspace is not initialised yet.');
  return d;
}

let cleanupRan = false;

async function dbClean(): Promise<Db> {
  const d = db();
  if (!cleanupRan) {
    cleanupRan = true;
    if (d.users.length > 1) {
      await cleanupUsers(d);
      save(d);
    }
  }
  return d;
}

function actorOf(d: Db) {
  const u = d.users.find((x) => x.id === d.currentUserId);
  return u ? { id: u.id, name: u.name, role: u.role } : null;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// A user object safe to hand to the renderer: the password hash never leaves
// the platform layer.
function publicUser(u: User): User {
  const { passwordHash: _omit, ...rest } = u;
  return clone(rest) as User;
}

async function verifyCredentials(d: Db, username: string, password: string): Promise<{ user?: User; error?: string }> {
  const user = d.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) return { error: 'Unknown username for this workspace.' };
  if (!user.active) return { error: 'This account is deactivated.' };
  if (user.passwordHash) {
    const hash = await hashPassword(user.username, password);
    if (hash !== user.passwordHash) return { error: 'Incorrect password.' };
  }
  // Accounts without a stored hash are the initial administrator account,
  // which intentionally accepts any password in this preview until a real
  // password is set.
  return { user };
}

function computeMetrics(d: Db): DashboardMetrics {
  const now = new Date();
  const open = d.cases.filter((c) => OPEN_STATUSES.includes(c.status));

  const closed = d.cases.filter((c) => !OPEN_STATUSES.includes(c.status));
  const completedThisMonth = closed.filter(
    (c) => c.sla.closureDate && isSameMonth(parseISO(c.sla.closureDate), now),
  ).length;

  const tally = (items: string[]): NameValue[] => {
    const m = new Map<string, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const openWithType = (t: string) =>
    open.filter((c) => c.requestTypes.map(String).includes(t)).length;

  const receivedThisMonth = d.cases.filter(
    (c) => isSameMonth(parseISO(c.sla.receivedDate), now),
  ).length;

  return {
    openCases: open.length,
    newCases: d.cases.filter((c) => c.status === 'New').length,
    completedThisMonth,
    byType: tally(d.cases.flatMap((c) => c.requestTypes.map(String))),
    byJurisdiction: tally(d.cases.map((c) => String(c.jurisdiction))),
    byStatus: tally(d.cases.map((c) => c.status)),
    accessCount: openWithType('Access'),
    deletionCount: openWithType('Deletion'),
    correctionCount: openWithType('Correction'),
    unsubscribeCount: openWithType('Unsubscribe'),
    doNotSaleCount: openWithType('Do Not Sell'),
    receivedThisMonth,
    closedThisMonth: completedThisMonth,
  };
}

// ---- Project identity ---------------------------------------------------------
//
// The RITM Number is the project's unique identifier: duplicate RITM numbers
// are rejected on create and on edit. Project numbers and project names may
// legitimately repeat (grouped parent/child entries), so they are NOT checked.
// Blank RITM numbers are exempt — a project without an RITM yet can't collide.

function assertRitmUnique(d: Db, ritmNumber: string | undefined, excludeId?: string): void {
  const trimmed = ritmNumber?.trim();
  if (!trimmed) return;
  const clash = d.projects.find(
    (x) => x.id !== excludeId && x.ritmNumber?.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) {
    throw new Error(
      `RITM number "${trimmed}" is already used by project ${clash.projectNumber} — ${clash.projectName}. ` +
      'The RITM number must be unique for every project entry.',
    );
  }
}

async function addImportedCase(
  d: Db,
  input: NewCaseInput,
  actor: User | null,
  status: CaseStatus = 'New',
): Promise<DsrCase> {
  const now = new Date();
  const rule = ruleFor(d.settings, String(input.jurisdiction));
  const due = computeDueDate(now, { periodDays: rule.periodDays, businessDays: rule.businessDays });
  const caseNumber = input.caseNumberOverride?.trim() || nextCaseNumber(d);
  const c: DsrCase = {
    id: uid(),
    caseNumber,
    status,
    requestTypes: input.requestTypes,
    intakeChannel: input.intakeChannel,
    description: input.description,
    jurisdiction: input.jurisdiction,
    businessUnit: input.businessUnit,
    priority: input.priority,
    risk: input.risk,
    ownerId: input.ownerId,
    team: 'Privacy Office',
    tags: [],
    subject: input.subject,
    verificationStatus: 'Not Started',
    sla: {
      receivedDate: now.toISOString(),
      originalDueDate: due.toISOString(),
      currentDueDate: due.toISOString(),
      pausedTotalDays: 0,
      ruleName: rule.jurisdiction,
      businessDays: rule.businessDays,
      periodDays: rule.periodDays,
      closureDate: OPEN_STATUSES.includes(status) ? undefined : now.toISOString(),
    },
    demo: false,
    createdBy: actor?.id ?? 'system',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    nextAction: nextActionFor(status),
    intakeDates: input.intakeDates,
  };
  d.cases.push(c);
  d.statusHistory.push({ id: uid(), caseId: c.id, fromStatus: null, toStatus: status, actorId: actor?.id ?? 'system', at: now.toISOString() });
  ['Send standard response', 'Forward email to Ron K.', 'Send follow-up email', 'Close the request'].forEach((title, i) => {
    d.tasks.push({
      id: uid(), caseId: c.id, title, status: 'Not Started', priority: input.priority,
      dueDate: addDays(now, 7 * (i + 1)).toISOString(), checklistGroup: 'Standard workflow',
      createdBy: actor?.id ?? 'system', createdAt: now.toISOString(),
    });
  });
  await appendAudit(d, actor, {
    category: 'Case',
    action: 'case.imported',
    entityType: 'case',
    entityId: c.id,
    caseId: c.id,
    summary: `Case ${c.caseNumber} imported (${c.requestTypes.join(', ')})`,
    newValue: { status: c.status, jurisdiction: c.jurisdiction },
  });
  return c;
}

async function addImportedProject(d: Db, input: NewProjectInput, actor: User | null): Promise<Project> {
  const now = new Date().toISOString();
  assertRitmUnique(d, input.ritmNumber);
  const p: Project = {
    ...input,
    status: input.status ?? 'New',
    projectNumber: input.projectNumber?.trim() || nextProjectNumber(d),
    id: uid(),
    createdBy: actor?.id ?? 'system',
    createdAt: now,
  };
  d.projects.push(p);
  await appendAudit(d, actor, {
    category: 'Project',
    action: 'project.imported',
    entityType: 'project',
    entityId: p.id,
    summary: `Project ${p.projectNumber} — ${p.projectName} imported`,
    newValue: { projectNumber: p.projectNumber, status: p.status, source: p.source, investmentClass: p.investmentClass, ritmNumber: p.ritmNumber },
  });
  return p;
}

export function createBrowserPlatform(): PrivacyFlowAPI {
  return {
    isElectron: !!workspaceBridge(),

    system: {
      async settings() {
        const d = load();
        return d ? clone(d.settings) : defaultSettings();
      },
      async completeSetup(input: CompleteSetupInput) {
        assertWritable();
        const settings: OrgSettings = {
          ...defaultSettings(),
          organizationName: input.organizationName ?? APP_CONFIG.defaults.organizationName,
          caseNumberPrefix: input.caseNumberPrefix ?? APP_CONFIG.defaults.caseNumberPrefix,
          defaultJurisdiction: input.defaultJurisdiction ?? APP_CONFIG.defaults.defaultJurisdiction,
          autoLockMinutes: input.autoLockMinutes ?? APP_CONFIG.defaults.autoLockMinutes,
          theme: input.theme ?? 'dark',
          demoDataInstalled: input.demoDataInstalled ?? false,
          setupComplete: true,
        };
        const seeded = await createSeed(settings);
        save(seeded);
        return clone(seeded.settings);
      },
      async updateSettings(patch: Partial<OrgSettings>) {
        assertWritable();
        const d = db();
        const before = clone(d.settings);
        d.settings = { ...d.settings, ...patch };
        await appendAudit(d, actorOf(d), {
          category: 'System',
          action: 'settings.updated',
          entityType: 'settings',
          entityId: 'workspace',
          summary: 'Workspace settings updated',
          previousValue: before,
          newValue: clone(d.settings),
        });
        save(d);
        return clone(d.settings);
      },
      async resetApplication() {
        assertWritable();
        const fresh = await createSeed(defaultSettings());
        save(fresh);
      },
      async exportTracking() {
        const d = db();
        return {
          version: APP_CONFIG.version,
          exportedAt: new Date().toISOString(),
          cases: clone(d.cases),
          projects: clone(d.projects),
        };
      },
      async importCases(input: NewCaseInput[]): Promise<ImportSummary> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        const summary: ImportSummary = { cases: 0, projects: 0, skipped: 0, errors: [] };
        const existing = new Set(d.cases.map((c) => c.caseNumber.trim().toLowerCase()));
        for (const [index, item] of input.entries()) {
          try {
            const explicit = item.caseNumberOverride?.trim();
            if (explicit && existing.has(explicit.toLowerCase())) {
              summary.skipped += 1;
              continue;
            }
            const created = await addImportedCase(d, item, actor);
            existing.add(created.caseNumber.trim().toLowerCase());
            summary.cases += 1;
          } catch (e) {
            summary.errors.push(`Request row ${index + 1}: ${e instanceof Error ? e.message : 'Import failed.'}`);
          }
        }
        save(d);
        return summary;
      },
      async importProjects(input: NewProjectInput[]): Promise<ImportSummary> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        const summary: ImportSummary = { cases: 0, projects: 0, skipped: 0, errors: [] };
        for (const [index, item] of input.entries()) {
          try {
            if (item.ritmNumber?.trim() && d.projects.some((p) => p.ritmNumber?.trim().toLowerCase() === item.ritmNumber!.trim().toLowerCase())) {
              summary.skipped += 1;
              continue;
            }
            await addImportedProject(d, item, actor);
            summary.projects += 1;
          } catch (e) {
            summary.errors.push(`Project row ${index + 1}: ${e instanceof Error ? e.message : 'Import failed.'}`);
          }
        }
        save(d);
        return summary;
      },
      async importTracking(input: { cases?: DsrCase[]; projects?: Project[] }): Promise<ImportSummary> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        const summary: ImportSummary = { cases: 0, projects: 0, skipped: 0, errors: [] };
        const existingCases = new Set(d.cases.map((c) => c.caseNumber.trim().toLowerCase()));
        for (const [index, c] of (input.cases ?? []).entries()) {
          try {
            if (existingCases.has(c.caseNumber.trim().toLowerCase())) {
              summary.skipped += 1;
              continue;
            }
            const imported = await addImportedCase(d, {
              caseNumberOverride: c.caseNumber,
              requestTypes: c.requestTypes,
              intakeChannel: c.intakeChannel,
              jurisdiction: c.jurisdiction,
              priority: c.priority,
              risk: c.risk,
              businessUnit: c.businessUnit,
              description: c.description,
              subject: c.subject,
              intakeDates: c.intakeDates,
            }, actor, CASE_STATUSES.includes(c.status as CaseStatus) ? c.status as CaseStatus : 'New');
            existingCases.add(imported.caseNumber.trim().toLowerCase());
            summary.cases += 1;
          } catch (e) {
            summary.errors.push(`PrivacyFlow request ${index + 1}: ${e instanceof Error ? e.message : 'Import failed.'}`);
          }
        }
        for (const [index, p] of (input.projects ?? []).entries()) {
          try {
            if (p.ritmNumber?.trim() && d.projects.some((x) => x.ritmNumber?.trim().toLowerCase() === p.ritmNumber!.trim().toLowerCase())) {
              summary.skipped += 1;
              continue;
            }
            await addImportedProject(d, {
              ...p,
              projectNumber: p.projectNumber,
              status: PROJECT_STATUSES.includes(p.status as ProjectStatus) ? p.status : 'New',
            }, actor);
            summary.projects += 1;
          } catch (e) {
            summary.errors.push(`PrivacyFlow project ${index + 1}: ${e instanceof Error ? e.message : 'Import failed.'}`);
          }
        }
        save(d);
        return summary;
      },
    },

    auth: {
      async currentUser() {
        const d = load();
        if (!d || !d.currentUserId) return null;
        const u = d.users.find((x) => x.id === d.currentUserId);
        return u ? publicUser(u) : null;
      },
      async listUsers() {
        const d = await dbClean();
        return d.users.map(publicUser);
      },
      async login(username: string, password: string): Promise<LoginResult> {
        const d = await dbClean();
        const { user, error } = await verifyCredentials(d, username, password);
        if (!user) return { ok: false, error: error ?? 'Unable to sign in.' };
        if (user.mustChangePassword) {
          return { ok: false, mustChangePassword: true, user: publicUser(user) };
        }
        d.currentUserId = user.id;
        await appendAudit(d, { id: user.id, name: user.name, role: user.role }, {
          category: 'Auth',
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          summary: `${user.name} signed in`,
        });
        save(d);
        return { ok: true, user: publicUser(user) };
      },
      async logout() {
        const d = load();
        if (!d || !d.currentUserId) return;
        const actor = actorOf(d);
        await appendAudit(d, actor, {
          category: 'Auth',
          action: 'auth.logout',
          entityType: 'user',
          entityId: d.currentUserId,
          summary: `${actor?.name ?? 'User'} signed out`,
        });
        d.currentUserId = null;
        save(d);
      },
      async createUser(input: CreateUserInput): Promise<CreateUserResult> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        if (!actor || actor.role !== 'administrator') {
          throw new Error('Only administrators can create users.');
        }
        const name = input.name.trim();
        const username = input.username.trim().toLowerCase();
        const email = input.email?.trim();
        if (!name) throw new Error('Name is required.');
        if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
          throw new Error('Username must be 2–32 characters: lowercase letters, numbers, dots, dashes, underscores.');
        }
        if (email && !/.+@.+\..+/.test(email)) throw new Error('Enter a valid email address.');
        if (d.users.some((u) => u.username.toLowerCase() === username)) {
          throw new Error(`The username "${username}" is already taken.`);
        }
        const tempPassword = generateTempPassword();
        const u: User = {
          id: uid(),
          name,
          username,
          email: email || undefined,
          role: input.role,
          active: true,
          createdAt: new Date().toISOString(),
          passwordHash: await hashPassword(username, tempPassword),
          mustChangePassword: true,
        };
        d.users.push(u);
        await appendAudit(d, actor, {
          category: 'User',
          action: 'user.created',
          entityType: 'user',
          entityId: u.id,
          summary: `User ${u.name} (@${u.username}) created with role ${u.role} (temporary password issued)`,
          newValue: { name: u.name, username: u.username, email: u.email, role: u.role },
        });
        save(d);
        return { user: publicUser(u), tempPassword };
      },
      async updateUser(id: string, patch: UpdateUserInput): Promise<User> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        if (!actor || actor.role !== 'administrator') {
          throw new Error('Only administrators can manage users.');
        }
        const u = d.users.find((x) => x.id === id);
        if (!u) throw new Error('User not found');
        if (u.id === actor.id && patch.role && patch.role !== u.role) {
          throw new Error('You cannot change your own role.');
        }
        if (u.id === actor.id && patch.active === false) {
          throw new Error('You cannot deactivate your own account.');
        }
        const before = { role: u.role, active: u.active };
        if (patch.role) u.role = patch.role;
        if (patch.active !== undefined) u.active = patch.active;
        if (!u.active && d.currentUserId === u.id) d.currentUserId = null;
        await appendAudit(d, actor, {
          category: 'User',
          action: 'user.updated',
          entityType: 'user',
          entityId: u.id,
          summary: `${u.name}'s account updated (role: ${before.role} → ${u.role}${u.active !== before.active ? `; ${u.active ? 'activated' : 'deactivated'}` : ''})`,
          previousValue: before,
          newValue: { role: u.role, active: u.active },
        });
        save(d);
        return publicUser(u);
      },
      async deleteUser(id: string): Promise<void> {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        if (!actor || actor.role !== 'administrator') {
          throw new Error('Only administrators can delete users.');
        }
        const u = d.users.find((x) => x.id === id);
        if (!u) throw new Error('User not found');
        if (u.id === actor.id) {
          throw new Error('You cannot delete your own account.');
        }
        if (u.role === 'administrator' && d.users.filter((x) => x.role === 'administrator').length <= 1) {
          throw new Error('The workspace must keep at least one administrator.');
        }
        d.users = d.users.filter((x) => x.id !== id);
        for (const c of d.cases) {
          if (c.ownerId === id) c.ownerId = undefined;
        }
        if (d.currentUserId === id) d.currentUserId = null;
        await appendAudit(d, actor, {
          category: 'User',
          action: 'user.deleted',
          entityType: 'user',
          entityId: id,
          summary: `User ${u.name} (@${u.username}) deleted`,
          previousValue: { name: u.name, username: u.username, role: u.role },
        });
        save(d);
      },
      async changePassword(username: string, currentPassword: string, newPassword: string): Promise<LoginResult> {
        assertWritable();
        const d = db();
        const trimmed = newPassword.trim();
        if (trimmed.length < PASSWORD_MIN_LENGTH) {
          return { ok: false, error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
        }
        if (trimmed === currentPassword) {
          return { ok: false, error: 'New password must differ from the temporary password.' };
        }
        const { user, error } = await verifyCredentials(d, username, currentPassword);
        if (!user) return { ok: false, error: error ?? 'Unable to verify current password.' };

        user.passwordHash = await hashPassword(user.username, trimmed);
        const wasForced = !!user.mustChangePassword;
        user.mustChangePassword = false;
        d.currentUserId = user.id;
        await appendAudit(d, { id: user.id, name: user.name, role: user.role }, {
          category: 'Auth',
          action: wasForced ? 'auth.password_set' : 'auth.password_changed',
          entityType: 'user',
          entityId: user.id,
          summary: wasForced
            ? `${user.name} set their password on first sign-in`
            : `${user.name} changed their password`,
        });
        save(d);
        return { ok: true, user: publicUser(user) };
      },
    },

    cases: {
      async list() {
        return clone(db().cases);
      },
      async getById(id: string) {
        return clone(db().cases.find((c) => c.id === id) ?? null);
      },
      async create(input: NewCaseInput) {
        assertWritable();
        const d = db();
        const now = new Date();
        const rule = ruleFor(d.settings, String(input.jurisdiction));
        const due = computeDueDate(now, { periodDays: rule.periodDays, businessDays: rule.businessDays });
        const sla: SlaInfo = {
          receivedDate: now.toISOString(),
          originalDueDate: due.toISOString(),
          currentDueDate: due.toISOString(),
          pausedTotalDays: 0,
          ruleName: rule.jurisdiction,
          businessDays: rule.businessDays,
          periodDays: rule.periodDays,
        };
        const actor = actorOf(d);
        const caseNumber = input.caseNumberOverride?.trim() || nextCaseNumber(d);
        const c: DsrCase = {
          id: uid(),
          caseNumber,
          status: 'New',
          requestTypes: input.requestTypes,
          intakeChannel: input.intakeChannel,
          description: input.description,
          jurisdiction: input.jurisdiction,
          businessUnit: input.businessUnit,
          priority: input.priority,
          risk: input.risk,
          ownerId: input.ownerId,
          team: 'Privacy Office',
          tags: [],
          subject: input.subject,
          verificationStatus: 'Not Started',
          sla,
          demo: false,
          createdBy: actor?.id ?? 'system',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          lastActivityAt: now.toISOString(),
          nextAction: nextActionFor('New'),
          intakeDates: input.intakeDates,
        };
        d.cases.push(c);
        if (input.sourceEmail) {
          d.communications.push({
            id: uid(),
            caseId: c.id,
            direction: 'Inbound',
            channel: 'Uploaded email',
            subject: input.sourceEmail.subject || input.sourceEmail.filename,
            summary: [
              `Uploaded source email: ${input.sourceEmail.filename}`,
              input.sourceEmail.fromEmail
                ? `From: ${input.sourceEmail.fromName ? `${input.sourceEmail.fromName} <${input.sourceEmail.fromEmail}>` : input.sourceEmail.fromEmail}`
                : '',
              input.sourceEmail.to ? `To: ${input.sourceEmail.to}` : '',
              input.sourceEmail.date ? `Date: ${input.sourceEmail.date}` : '',
              '',
              input.sourceEmail.bodyText,
            ].filter((line) => line !== '').join('\n'),
            sentAt: now.toISOString(),
            status: 'Uploaded source email',
            createdBy: actor?.id ?? 'system',
            sourceEmail: input.sourceEmail,
          });
        }
        d.statusHistory.push({
          id: uid(), caseId: c.id, fromStatus: null, toStatus: 'New',
          actorId: actor?.id ?? 'system', at: now.toISOString(),
        });
        ['Send standard response', 'Forward email to Ron K.', 'Send follow-up email', 'Close the request']
          .forEach((title, i) => {
            d.tasks.push({
              id: uid(), caseId: c.id, title, status: 'Not Started', priority: input.priority,
              dueDate: addDays(now, 7 * (i + 1)).toISOString(), checklistGroup: 'Standard workflow',
              createdBy: actor?.id ?? 'system', createdAt: now.toISOString(),
            });
          });
        await appendAudit(d, actor, {
          category: 'Case',
          action: 'case.created',
          entityType: 'case',
          entityId: c.id,
          caseId: c.id,
          summary: `Case ${c.caseNumber} created (${c.requestTypes.join(', ')})`,
          newValue: { status: 'New', jurisdiction: c.jurisdiction },
        });
        await runAutomations(d, c, 'case.created', {});
        save(d);
        return clone(c);
      },
      async update(id: string, patch: Partial<DsrCase>, reason?: string) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const before = clone(c);
        Object.assign(c, patch);
        c.updatedAt = new Date().toISOString();
        c.lastActivityAt = c.updatedAt;
        const changed = diffSummary(before as unknown as Record<string, unknown>, c as unknown as Record<string, unknown>);
        await appendAudit(d, actorOf(d), {
          category: 'Case',
          action: 'case.updated',
          entityType: 'case',
          entityId: c.id,
          caseId: c.id,
          summary: changed
            ? `Case ${c.caseNumber} updated (${changed})`
            : `Case ${c.caseNumber} updated`,
          previousValue: before,
          newValue: clone(c),
          reason,
        });
        save(d);
        return clone(c);
      },
      async updateCaseNumber(id: string, caseNumber: string) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const trimmed = caseNumber.trim();
        if (!trimmed) throw new Error('Request number cannot be empty.');
        const duplicate = d.cases.find(
          (x) => x.id !== id && x.caseNumber.toLowerCase() === trimmed.toLowerCase(),
        );
        if (duplicate) throw new Error(`"${trimmed}" is already used by another request.`);
        if (trimmed === c.caseNumber) return clone(c);
        const previous = c.caseNumber;
        c.caseNumber = trimmed;
        c.updatedAt = new Date().toISOString();
        c.lastActivityAt = c.updatedAt;
        await appendAudit(d, actorOf(d), {
          category: 'Case',
          action: 'case.number_changed',
          entityType: 'case',
          entityId: c.id,
          caseId: c.id,
          summary: `Request number changed: ${previous} → ${trimmed}`,
          previousValue: { caseNumber: previous },
          newValue: { caseNumber: trimmed },
        });
        save(d);
        return clone(c);
      },
      async transition(id: string, to: CaseStatus, reason?: string) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const from = c.status;
        if (from === to) return clone(c);
        const now = new Date();
        const actor = actorOf(d);

        // Stamp the intake-timeline date that corresponds to the new status,
        // so the workflow's fields stay in sync automatically.
        c.intakeDates = { ...(c.intakeDates ?? {}) };
        if (to === 'Email Response Sent' && !c.intakeDates.standardResponseSent) {
          c.intakeDates.standardResponseSent = now.toISOString();
        }
        if (to === 'Email Ron K.' && !c.intakeDates.forwardedEmailToRon) {
          c.intakeDates.forwardedEmailToRon = now.toISOString();
        }
        if (to === 'Follow-up Email Sent' && !c.intakeDates.followUpEmailSent) {
          c.intakeDates.followUpEmailSent = now.toISOString();
        }

        const nowClosed = !OPEN_STATUSES.includes(to);
        if (nowClosed) {
          c.sla.closureDate = now.toISOString();
          c.sla.fulfillmentDate = now.toISOString();
          c.resolutionDate = now.toISOString();
          if (reason) c.closureSummary = reason;
        }

        c.status = to;
        c.nextAction = nextActionFor(to);
        c.updatedAt = now.toISOString();
        c.lastActivityAt = now.toISOString();

        d.statusHistory.push({
          id: uid(), caseId: c.id, fromStatus: from, toStatus: to,
          actorId: actor?.id ?? 'system', at: now.toISOString(), reason,
        });
        await appendAudit(d, actor, {
          category: 'Case',
          action: 'case.status_changed',
          entityType: 'case',
          entityId: c.id,
          caseId: c.id,
          summary: `Case ${c.caseNumber}: ${from} → ${to}`,
          previousValue: { status: from },
          newValue: { status: to },
          reason,
        });
        await runAutomations(d, c, 'status.changed', { toStatus: to });
        save(d);
        return clone(c);
      },
      async statusHistory(id: string) {
        return clone(db().statusHistory.filter((s) => s.caseId === id).sort((a, b) => a.at.localeCompare(b.at)));
      },
      async slaHistory(id: string) {
        return clone(db().slaHistory.filter((s) => s.caseId === id));
      },
      async tasks(id: string) {
        return clone(db().tasks.filter((t) => t.caseId === id));
      },
      async notes(id: string) {
        return clone(db().notes.filter((n) => n.caseId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      },
      async communications(id: string) {
        return clone(db().communications.filter((m) => m.caseId === id).sort((a, b) => b.sentAt.localeCompare(a.sentAt)));
      },
      async decisions(id: string) {
        return clone(db().decisions.filter((x) => x.caseId === id));
      },
      async documents(id: string) {
        return clone(db().documents.filter((x) => x.caseId === id));
      },
      async addNote(id: string, content: string, category: string) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const actor = actorOf(d);
        const note: CaseNote = {
          id: uid(),
          caseId: id,
          authorId: actor?.id ?? 'system',
          createdAt: new Date().toISOString(),
          content,
          category,
          pinned: false,
          revision: 1,
          revisions: [],
        };
        d.notes.push(note);
        c.lastActivityAt = note.createdAt;
        await appendAudit(d, actor, {
          category: 'Case',
          action: 'note.added',
          entityType: 'note',
          entityId: note.id,
          caseId: id,
          summary: `Note added to ${c.caseNumber} (${category})`,
        });
        save(d);
        return clone(note);
      },
      async addDocument(id: string, input: AddDocumentInput) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const actor = actorOf(d);
        const filename = input.originalFilename.trim();
        if (!filename) throw new Error('File name is required.');
        const doc: CaseDocument = {
          id: uid(),
          caseId: id,
          originalFilename: filename,
          internalFilename: `${uid()}.enc`,
          mimeType: input.mimeType ?? 'application/octet-stream',
          sizeBytes: input.sizeBytes ?? 0,
          sha256: fakeHash(),
          category: input.category ?? 'General',
          uploadedBy: actor?.id ?? 'system',
          uploadedAt: new Date().toISOString(),
          sensitivity: 'Internal',
          encrypted: true,
        };
        d.documents.push(doc);
        c.lastActivityAt = doc.uploadedAt;
        await appendAudit(d, actor, {
          category: 'Case',
          action: 'document.added',
          entityType: 'document',
          entityId: doc.id,
          caseId: id,
          summary: `Document "${doc.originalFilename}" added to ${c.caseNumber}`,
          newValue: { filename: doc.originalFilename, category: doc.category, sizeBytes: doc.sizeBytes },
        });
        save(d);
        return clone(doc);
      },
      async addCommunication(id: string, input: AddCommunicationInput) {
        assertWritable();
        const d = db();
        const c = d.cases.find((x) => x.id === id);
        if (!c) throw new Error('Case not found');
        const actor = actorOf(d);
        const subject = input.subject.trim();
        if (!subject) throw new Error('Subject is required.');
        const now = new Date().toISOString();
        const comm: Communication = {
          id: uid(),
          caseId: id,
          direction: input.direction ?? 'Outbound',
          channel: input.channel ?? 'File attachment',
          subject,
          summary: input.summary,
          sentAt: now,
          status: input.sourceEmail ? 'Uploaded source email' : 'Logged',
          createdBy: actor?.id ?? 'system',
          sourceEmail: input.sourceEmail,
        };
        d.communications.push(comm);
        c.lastActivityAt = now;
        await appendAudit(d, actor, {
          category: 'Case',
          action: 'communication.added',
          entityType: 'communication',
          entityId: comm.id,
          caseId: id,
          summary: `${input.sourceEmail ? 'Source email' : 'File'} "${comm.subject}" added to ${c.caseNumber} communications`,
          newValue: { subject: comm.subject, direction: comm.direction },
        });
        save(d);
        return clone(comm);
      },
      async completeTask(caseId: string, taskId: string) {
        assertWritable();
        const d = db();
        const t = d.tasks.find((x) => x.id === taskId && x.caseId === caseId);
        if (!t) throw new Error('Task not found');
        t.status = 'Completed';
        t.completedAt = new Date().toISOString();
        const c = d.cases.find((x) => x.id === caseId);
        if (c) c.lastActivityAt = t.completedAt;
        await appendAudit(d, actorOf(d), {
          category: 'Task',
          action: 'task.completed',
          entityType: 'task',
          entityId: t.id,
          caseId,
          summary: `Task completed: ${t.title}`,
        });
        save(d);
        return clone(t);
      },
    },

    projects: {
      async list() {
        return clone(db().projects);
      },
      async create(input: NewProjectInput) {
        assertWritable();
        const d = db();
        const actor = actorOf(d);
        const now = new Date().toISOString();
        // The RITM number is the unique identifier — reject duplicates.
        assertRitmUnique(d, input.ritmNumber);
        const projectNumber = input.projectNumber?.trim() || nextProjectNumber(d);
        const p: Project = {
          ...input,
          status: input.status ?? 'New',
          projectNumber,
          id: uid(),
          createdBy: actor?.id ?? 'system',
          createdAt: now,
        };
        d.projects.push(p);
        await appendAudit(d, actor, {
          category: 'Project',
          action: 'project.created',
          entityType: 'project',
          entityId: p.id,
          summary: `Project ${p.projectNumber} — ${p.projectName} created`,
          newValue: { projectNumber: p.projectNumber, status: p.status, source: p.source, investmentClass: p.investmentClass, ritmNumber: p.ritmNumber },
        });
        save(d);
        return clone(p);
      },
      async update(id: string, patch: Partial<Project>, reason?: string) {
        assertWritable();
        const d = db();
        const p = d.projects.find((x) => x.id === id);
        if (!p) throw new Error('Project not found');
        // RITM uniqueness also applies to edits (the patch may not include the
        // field at all, in which case the existing value stands).
        if (patch.ritmNumber !== undefined) {
          assertRitmUnique(d, patch.ritmNumber, id);
        }
        const before = clone(p);
        Object.assign(p, patch, { id: p.id, createdBy: p.createdBy, createdAt: p.createdAt });
        const changed = diffSummary(before as unknown as Record<string, unknown>, p as unknown as Record<string, unknown>);
        await appendAudit(d, actorOf(d), {
          category: 'Project',
          action: 'project.updated',
          entityType: 'project',
          entityId: p.id,
          summary: changed
            ? `Project ${p.projectNumber} — ${p.projectName} updated (${changed})`
            : `Project ${p.projectNumber} — ${p.projectName} updated`,
          previousValue: before,
          newValue: clone(p),
          reason,
        });
        save(d);
        return clone(p);
      },
      async updateProjectNumber(id: string, projectNumber: string) {
        assertWritable();
        const d = db();
        const p = d.projects.find((x) => x.id === id);
        if (!p) throw new Error('Project not found');
        const trimmed = projectNumber.trim();
        if (!trimmed) throw new Error('Project number cannot be empty.');
        // Project numbers may be shared between entries (grouped parent/child
        // projects) — only the RITM number is unique — so no duplicate check.
        if (trimmed === p.projectNumber) return clone(p);
        const previous = p.projectNumber;
        p.projectNumber = trimmed;
        await appendAudit(d, actorOf(d), {
          category: 'Project',
          action: 'project.number_changed',
          entityType: 'project',
          entityId: p.id,
          summary: `Project number changed: ${previous} → ${trimmed}`,
          previousValue: { projectNumber: previous },
          newValue: { projectNumber: trimmed },
        });
        save(d);
        return clone(p);
      },
      async communications(id: string) {
        return clone(
          db().communications
            .filter((m) => m.caseId === id)
            .sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
        );
      },
      async addCommunication(id: string, input: AddCommunicationInput) {
        assertWritable();
        const d = db();
        const p = d.projects.find((x) => x.id === id);
        if (!p) throw new Error('Project not found');
        const actor = actorOf(d);
        const subject = input.subject.trim();
        if (!subject) throw new Error('Subject is required.');
        const now = new Date().toISOString();
        const comm: Communication = {
          id: uid(),
          caseId: id,
          direction: input.direction ?? 'Inbound',
          channel: input.channel ?? 'File attachment',
          subject,
          summary: input.summary,
          sentAt: now,
          status: 'Logged',
          createdBy: actor?.id ?? 'system',
        };
        d.communications.push(comm);
        await appendAudit(d, actor, {
          category: 'Project',
          action: 'project.file_added',
          entityType: 'project',
          entityId: p.id,
          summary: `File "${comm.subject}" added to project ${p.projectNumber} communications`,
          newValue: { subject: comm.subject, direction: comm.direction },
        });
        save(d);
        return clone(comm);
      },
    },

    dashboard: {
      async metrics() {
        return computeMetrics(db());
      },
    },

    audit: {
      async list() {
        return clone(db().audit);
      },
      async byCase(caseId: string) {
        return clone(db().audit.filter((e: AuditEvent) => e.caseId === caseId));
      },
      async verifyIntegrity(): Promise<IntegrityReport> {
        const d = db();
        const result = await verifyChain(d.audit as unknown as Array<Record<string, unknown>>);
        const report: IntegrityReport = {
          ok: result.ok,
          checkedAt: new Date().toISOString(),
          totalEvents: d.audit.length,
          brokenAt: result.brokenAt,
          message: result.ok
            ? `All ${d.audit.length} events verified — the hash chain is intact.`
            : `Chain integrity check failed at event #${result.brokenAt}. Records may have been altered or removed.`,
        };
        await appendAudit(d, actorOf(d), {
          category: 'Audit',
          action: 'audit.verified',
          entityType: 'audit',
          entityId: 'chain',
          summary: report.ok ? 'Audit chain verified as intact' : `Audit chain verification failed at #${result.brokenAt}`,
        });
        save(d);
        return report;
      },
    },
  };
}
