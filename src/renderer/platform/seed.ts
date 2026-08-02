import { addDays, subDays } from 'date-fns';
import type {
  OrgSettings, User, DsrCase, Task, CaseNote, Communication, Decision,
  CaseDocument, StatusHistoryEntry, SlaHistoryEntry, AuditEvent, SlaInfo, Project,
  CaseLink,
} from '@shared/types';
import type { CaseStatus, Priority, RiskLevel, Role } from '@shared/constants';
import { OPEN_STATUSES } from '@shared/constants';
import { APP_CONFIG } from '@shared/config';
import { computeDueDate } from '@shared/sla';
import { GENESIS_HASH, hashEvent } from '@shared/audit';

// -----------------------------------------------------------------------------
// In-memory database shape + deterministic seed generator for the browser
// preview. Mirrors what the desktop SQLite service would persist.
// -----------------------------------------------------------------------------

export interface Db {
  settings: OrgSettings;
  currentUserId: string | null;
  seq: number;
  projectSeq: number;
  auditSeq: number;
  deviceId: string;
  sessionId: string;
  users: User[];
  cases: DsrCase[];
  tasks: Task[];
  projects: Project[];
  notes: CaseNote[];
  communications: Communication[];
  decisions: Decision[];
  documents: CaseDocument[];
  statusHistory: StatusHistoryEntry[];
  slaHistory: SlaHistoryEntry[];
  caseLinks: CaseLink[];
  audit: AuditEvent[];
  pauseStarts: Record<string, string>;
}

export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);

export function fakeHash(): string {
  const c = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 64; i++) s += c[Math.floor(Math.random() * 16)];
  return s;
}

export function periodFor(jurisdiction: string) {
  return (
    APP_CONFIG.slaRules.find((r) => r.jurisdiction === jurisdiction) ??
    APP_CONFIG.slaRules[APP_CONFIG.slaRules.length - 1]
  );
}

// DSRREQ numbers follow the ServiceNow-style format: fixed prefix + zero-padded
// sequence, e.g. DSRREQ0000001. Request ID uses the editable organization prefix.
export function nextCaseNumber(db: Db): string {
  db.seq += 1;
  const n = String(db.seq).padStart(APP_CONFIG.defaults.caseNumberSequenceLength, '0');
  return `${APP_CONFIG.defaults.dsrreqNumberPrefix}${n}`;
}

// Project numbers follow the same pattern with the PRJ prefix: PRJ0000001.
export function nextProjectNumber(db: Db): string {
  db.projectSeq += 1;
  const n = String(db.projectSeq).padStart(APP_CONFIG.defaults.caseNumberSequenceLength, '0');
  return `PRJ${n}`;
}

export function nextActionFor(status: CaseStatus): string {
  switch (status) {
    case 'New': return 'Send the standard response email';
    case 'Email Response Sent': return 'Forward the email to Ron K.';
    case 'Email Ron K.': return 'Send the follow-up email';
    case 'Follow-up Email Sent': return 'Review and close the request';
    default: return 'No action required';
  }
}

type Actor = { id: string; name: string; role: string } | null;

export async function appendAudit(
  db: Db,
  actor: Actor,
  fields: {
    category: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    caseId?: string;
    previousValue?: unknown;
    newValue?: unknown;
    reason?: string;
  },
): Promise<AuditEvent> {
  const seq = db.auditSeq + 1;
  const prevHash = db.audit.length ? db.audit[db.audit.length - 1].hash : GENESIS_HASH;
  const now = new Date();
  // IMPORTANT: only include DEFINED keys — localStorage JSON drops undefined
  // keys, which would otherwise break the reproducible hash on reload.
  const base: Record<string, unknown> = {
    id: uid(),
    seq,
    utc: now.toISOString(),
    localDisplay: now.toLocaleString(),
    actorId: actor?.id ?? 'system',
    actorName: actor?.name ?? 'System',
    actorRole: actor?.role ?? 'system',
    category: fields.category,
    action: fields.action,
    entityType: fields.entityType,
    entityId: fields.entityId,
    summary: fields.summary,
    appVersion: APP_CONFIG.version,
    deviceId: db.deviceId,
    sessionId: db.sessionId,
    prevHash,
  };
  if (fields.caseId !== undefined) base.caseId = fields.caseId;
  if (fields.previousValue !== undefined) base.previousValue = fields.previousValue;
  if (fields.newValue !== undefined) base.newValue = fields.newValue;
  if (fields.reason !== undefined) base.reason = fields.reason;

  const hash = await hashEvent(base);
  const full = { ...base, hash } as AuditEvent;
  db.audit.push(full);
  db.auditSeq = seq;
  return full;
}

interface Spec {
  first: string;
  last: string;
  email: string;
  phone?: string;
  country?: string;
  types: string[];
  jurisdiction: string;
  channel: string;
  status: CaseStatus;
  priority: Priority;
  risk: RiskLevel;
  daysAgo: number;
  ownerIdx: number | null;
  relationship: string;
  businessUnit: string;
  description: string;
}

const SPECS: Spec[] = [
  { first: 'Hannah', last: 'Müller', email: 'hannah.muller@example.de', phone: '+49 30 1234567', country: 'DE', types: ['Access'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Email', status: 'Email Response Sent', priority: 'High', risk: 'Medium', daysAgo: 40, ownerIdx: 0, relationship: 'Client', businessUnit: 'Customer Support', description: 'Requesting a copy of all personal data held, including support tickets and marketing profiles.' },
  { first: 'Marcus', last: 'Lee', email: 'marcus.lee@example.com', phone: '+1 415 555 0132', country: 'US', types: ['Deletion'], jurisdiction: 'CCPA/CPRA (California)', channel: 'Web Form', status: 'Email Ron K.', priority: 'High', risk: 'High', daysAgo: 40, ownerIdx: null, relationship: 'Client', businessUnit: 'Marketing', description: 'Requests deletion of account and all associated marketing and analytics data.' },
  { first: 'Sofia', last: 'Rossi', email: 'sofia.rossi@example.it', country: 'IT', types: ['Access', 'Unsubscribe'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Email', status: 'Follow-up Email Sent', priority: 'Medium', risk: 'Medium', daysAgo: 10, ownerIdx: 0, relationship: 'Client', businessUnit: 'Sales', description: 'Access to order history and removal from all marketing mailing lists.' },
  { first: 'Daniel', last: 'Okonkwo', email: 'daniel.okonkwo@example.com', country: 'GB', types: ['Correction'], jurisdiction: 'UK GDPR', channel: 'Phone', status: 'New', priority: 'Low', risk: 'Low', daysAgo: 2, ownerIdx: null, relationship: 'Prospect', businessUnit: 'Sales', description: 'Correction of an outdated postal address on the mailing list.' },
  { first: 'Amara', last: 'Singh', email: 'amara.singh@example.com', country: 'CA', types: ['Unsubscribe'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Web Form', status: 'Closed', priority: 'Medium', risk: 'Low', daysAgo: 25, ownerIdx: 0, relationship: 'Client', businessUnit: 'Marketing', description: 'Unsubscribe from all marketing communications and newsletters.' },
  { first: 'Lucas', last: 'Almeida', email: 'lucas.almeida@example.br', country: 'BR', types: ['Deletion'], jurisdiction: 'LGPD (Brazil)', channel: 'Email', status: 'Closed', priority: 'Medium', risk: 'Medium', daysAgo: 20, ownerIdx: 0, relationship: 'Former Employee', businessUnit: 'People', description: 'Deletion of former employee data outside statutory retention windows.' },
  { first: 'Grace', last: 'Chen', email: 'grace.chen@example.com', country: 'US', types: ['Do Not Sell'], jurisdiction: 'CCPA/CPRA (California)', channel: 'Web Form', status: 'Email Response Sent', priority: 'Low', risk: 'Low', daysAgo: 10, ownerIdx: null, relationship: 'Client', businessUnit: 'Marketing', description: 'Opt out of the sale and sharing of personal information.' },
  { first: 'Noah', last: 'Weber', email: 'noah.weber@example.de', country: 'DE', types: ['Do Not Sell'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Email', status: 'Email Ron K.', priority: 'High', risk: 'High', daysAgo: 15, ownerIdx: 0, relationship: 'Client', businessUnit: 'Legal', description: 'Do-not-sell request covering profiling and data brokerage activities.' },
  { first: 'Emily', last: 'Tremblay', email: 'emily.tremblay@example.ca', country: 'CA', types: ['Access'], jurisdiction: 'PIPEDA (Canada)', channel: 'Postal Mail', status: 'Email Response Sent', priority: 'Medium', risk: 'Medium', daysAgo: 12, ownerIdx: null, relationship: 'Employee', businessUnit: 'People', description: 'Access to HR file and performance records.' },
  { first: 'Ravi', last: 'Patel', email: 'ravi.patel@example.com', country: 'US', types: ['Unsubscribe'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Email', status: 'Email Response Sent', priority: 'Urgent', risk: 'Critical', daysAgo: 5, ownerIdx: 0, relationship: 'Client', businessUnit: 'Marketing', description: 'Unsubscribe request where marketing emails continued after a prior opt-out; escalated.' },
  { first: 'Olivia', last: 'Novak', email: 'olivia.novak@example.eu', country: 'PL', types: ['Deletion'], jurisdiction: 'GDPR (EU/EEA)', channel: 'Email', status: 'Closed', priority: 'Medium', risk: 'Medium', daysAgo: 30, ownerIdx: 0, relationship: 'Client', businessUnit: 'Finance', description: 'Deletion request refused due to an ongoing legal retention obligation.' },
];

export async function createSeed(settings: OrgSettings): Promise<Db> {
  const now = new Date();
  const db: Db = {
    settings,
    currentUserId: null,
    seq: 0,
    projectSeq: 0,
    auditSeq: 0,
    deviceId: 'browser-preview',
    sessionId: uid(),
    users: [],
    cases: [],
    tasks: [],
    projects: [],
    notes: [],
    communications: [],
    decisions: [],
    documents: [],
    statusHistory: [],
    slaHistory: [],
    caseLinks: [],
    audit: [],
    pauseStarts: {},
  };

  const mk = (name: string, username: string, role: Role): User => ({
    id: uid(), name, username, role, active: true, createdAt: now.toISOString(),
  });
  // A single administrator account is provisioned so the workspace has an
  // initial sign-in. It has no stored password hash (in this preview that
  // means it accepts any password) — add further users from Settings → Users,
  // which issues each one a temporary password.
  db.users = [mk('Administrator', 'admin', 'administrator')];
  const admin = db.users[0];
  const adminActor = { id: admin.id, name: admin.name, role: admin.role };

  await appendAudit(db, adminActor, {
    category: 'System',
    action: 'setup.completed',
    entityType: 'system',
    entityId: 'system',
    summary: `Workspace initialised for ${settings.organizationName}`,
  });

  if (!settings.demoDataInstalled) return db;

  for (const spec of SPECS) {
    const received = subDays(now, spec.daysAgo);
    const rule = periodFor(spec.jurisdiction);
    const due = computeDueDate(received, { periodDays: rule.periodDays, businessDays: rule.businessDays });
    const closed = !OPEN_STATUSES.includes(spec.status);
    const owner = spec.ownerIdx === null ? undefined : db.users[spec.ownerIdx];

    const sla: SlaInfo = {
      receivedDate: received.toISOString(),
      originalDueDate: due.toISOString(),
      currentDueDate: due.toISOString(),
      pausedTotalDays: 0,
      ruleName: rule.jurisdiction,
      businessDays: rule.businessDays,
      periodDays: rule.periodDays,
    };
    let closureIso: string | undefined;
    if (closed) {
      const closureDay = subDays(now, Math.max(1, Math.floor(spec.daysAgo / 3)));
      closureIso = closureDay.toISOString();
      sla.closureDate = closureIso;
      sla.fulfillmentDate = closureIso;
    }

    // Populate the intake timeline to match the workflow status so demo
    // records look right against the new statuses.
    const stepIndex = ['New', 'Email Response Sent', 'Email Ron K.', 'Follow-up Email Sent', 'Closed'].indexOf(spec.status);
    const intakeDates: DsrCase['intakeDates'] = {
      dateClientServiceReceivedEmail: received.toISOString(),
      dateDppReceivedEmail: addDays(received, 1).toISOString(),
      standardResponseSent: stepIndex >= 1 ? addDays(received, 3).toISOString() : undefined,
      forwardedEmailToRon: stepIndex >= 2 ? addDays(received, 5).toISOString() : undefined,
      followUpEmailSent: stepIndex >= 3 ? addDays(received, 8).toISOString() : undefined,
    } as DsrCase['intakeDates'];

    const verificationStatus = spec.status === 'New' ? 'Not Started' : 'Verified';

    const c: DsrCase = {
      id: uid(),
      caseNumber: nextCaseNumber(db),
      status: spec.status,
      requestTypes: spec.types,
      intakeChannel: spec.channel,
      description: spec.description,
      jurisdiction: spec.jurisdiction,
      businessUnit: spec.businessUnit,
      priority: spec.priority,
      risk: spec.risk,
      ownerId: owner?.id,
      team: 'Privacy Office',
      tags: [],
      subject: {
        lastName: spec.last,
        emails: [spec.email],
        phones: spec.phone ? [spec.phone] : [],
        addresses: [],
        country: spec.country,
        relationship: spec.relationship,
        minor: false,
        authorizedAgent: false,
        identifiers: [
          { label: 'Customer ID', value: `CUST-${1000 + db.seq}` },
          { label: 'Request ID', value: `REQ-${1000 + db.seq}` },
        ],
      },
      verificationStatus,
      sla,
      demo: true,
      createdBy: admin.id,
      createdAt: received.toISOString(),
      updatedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      nextAction: nextActionFor(spec.status),
      closureSummary: closed ? 'Response finalised and communicated to the data subject.' : undefined,
      resolutionDate: closureIso,
      intakeDates,
    };
    db.cases.push(c);

    db.statusHistory.push({
      id: uid(), caseId: c.id, fromStatus: null, toStatus: spec.status,
      actorId: admin.id, at: received.toISOString(),
    });

    const titles = ['Send standard response', 'Forward email to Ron K.', 'Send follow-up email', 'Close the request'];
    titles.forEach((title, i) => {
      const done = closed || stepIndex > i;
      db.tasks.push({
        id: uid(),
        caseId: c.id,
        title,
        status: done ? 'Completed' : 'Not Started',
        priority: spec.priority,
        dueDate: addDays(received, 7 * (i + 1)).toISOString(),
        completedAt: done ? addDays(received, 7 * (i + 1) - 2).toISOString() : undefined,
        checklistGroup: 'Standard workflow',
        createdBy: admin.id,
        createdAt: received.toISOString(),
      });
    });

    db.notes.push({
      id: uid(),
      caseId: c.id,
      authorId: owner?.id ?? admin.id,
      createdAt: addDays(received, 1).toISOString(),
      content: `Intake reviewed and logged. ${spec.description}`,
      category: 'Triage',
      pinned: false,
      revision: 1,
      revisions: [],
    });

    db.communications.push({
      id: uid(),
      caseId: c.id,
      direction: 'Outbound',
      channel: 'Email',
      subject: 'Acknowledgement of your data subject request',
      summary: 'Confirmed receipt of the request and provided the expected statutory response timeline.',
      sentAt: addDays(received, 1).toISOString(),
      status: 'Sent Externally',
      createdBy: admin.id,
    });

    if (closed) {
      db.decisions.push({
        id: uid(),
        caseId: c.id,
        type: 'Fulfilment decision',
        decision: 'Request completed',
        rationale: 'Identity verified and applicable data compiled and delivered.',
        decisionMakerId: admin.id,
        date: closureIso ?? now.toISOString(),
        approvalStatus: 'Approved',
      });
    }

    await appendAudit(db, adminActor, {
      category: 'Case',
      action: 'case.created',
      entityType: 'case',
      entityId: c.id,
      caseId: c.id,
      summary: `Case ${c.caseNumber} created (${spec.types.join(', ')})`,
    });
  }

  // Seed a handful of demo projects across the new workflow statuses.
  const projectSpecs: Array<[string, string, Project['status'], string]> = [
    ['Vendor Onboarding Platform', 'DD', 'Reviewing', 'CTB'],
    ['Marketing Consent Refresh', 'SSDS', 'Needs Assessment', 'KTLO'],
    ['Data Lake Access Controls', 'Lighthouse', 'Assessment Sent', 'RTB'],
    ['HR Records Retention Update', 'DD', 'Approved', 'CTB'],
    ['Legacy CRM Decommission', 'SSDS', 'Closed', 'Not Listed'],
  ];
  projectSpecs.forEach(([name, source, status, investmentClass], i) => {
    const received = subDays(now, 30 - i * 4);
    db.projects.push({
      id: uid(),
      projectNumber: nextProjectNumber(db),
      projectName: name,
      status,
      source,
      dateNotificationReceived: received.toISOString(),
      notificationCancelled: false,
      ritmNumber: `RITM00${12345 + i}`,
      investmentClass,
      description: `Privacy review for ${name}.`,
      fiscalYear: 'FY26',
      ssdsType: 'Application',
      createdBy: admin.id,
      createdAt: received.toISOString(),
    });
  });

  return db;
}
