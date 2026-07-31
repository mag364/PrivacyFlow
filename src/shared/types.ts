import type {
  CaseStatus, ProjectStatus, RequestType, IntakeChannel, Jurisdiction, Priority,
  RiskLevel, VerificationStatus, RelationshipType, TaskStatus, Role,
} from './constants';

// -----------------------------------------------------------------------------
// Domain model. Shared between renderer and main process.
// -----------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: Role;
  active: boolean;
  createdAt: string;
  // Salted SHA-256 hash of the password. Absent on seeded demo accounts,
  // which intentionally accept any password in the browser preview.
  passwordHash?: string;
  // When true, the user must set a new password before gaining access.
  mustChangePassword?: boolean;
}

export interface Identifier {
  label: string;
  value: string;
}

export interface DataSubject {
  // Legacy only: older workspaces stored request IDs here. New requests do not
  // collect requester first names.
  firstName?: string;
  lastName: string;
  preferredName?: string;
  emails: string[];
  phones: string[];
  addresses: string[];
  country?: string;
  region?: string;
  relationship: RelationshipType | string;
  minor: boolean;
  authorizedAgent: boolean;
  identifiers: Identifier[];
  preferredLanguage?: string;
  clientCenterStatus?: string;
  emailedFA?: string;
}

export interface IntakeDates {
  dateClientServiceReceivedEmail?: string;
  dateDppReceivedEmail?: string;
  standardResponseSent?: string;
  forwardedEmailToRon?: string;
  followUpEmailSent?: string;
}

export interface SlaInfo {
  receivedDate: string;
  originalDueDate: string;
  currentDueDate: string;
  pausedTotalDays: number;
  currentPauseReason?: string;
  ruleName: string;
  businessDays: boolean;
  periodDays: number;
  closureDate?: string;
  fulfillmentDate?: string;
}

export interface DsrCase {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  requestTypes: (RequestType | string)[];
  intakeChannel: IntakeChannel | string;
  description: string;
  jurisdiction: Jurisdiction | string;
  businessUnit?: string;
  priority: Priority;
  risk: RiskLevel;
  ownerId?: string;
  team?: string;
  tags: string[];
  subject: DataSubject;
  verificationStatus: VerificationStatus | string;
  sla: SlaInfo;
  demo: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  nextAction: string;
  closureSummary?: string;
  resolutionDate?: string;
  intakeDates?: IntakeDates;
}

export interface Task {
  id: string;
  caseId: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  completedAt?: string;
  checklistGroup?: string;
  createdBy: string;
  createdAt: string;
}

// Standalone project record (separate from the request workflow).
export interface Project {
  id: string;
  projectNumber: string;
  projectName: string;
  // Project workflow: New → Reviewing → Needs Assessment → Assessment Sent →
  // Approved / Denied / Closed
  status: ProjectStatus | string;
  source: 'DD' | 'SSDS' | 'Lighthouse' | string;
  dateNotificationReceived?: string;
  notificationCancelled: boolean;
  ritmNumber?: string;
  investmentClass: 'CTB' | 'KTLO' | 'RTB' | 'Not Listed' | string;
  description: string;
  fiscalYear?: string;
  piaNumber?: string;
  ssdsTask?: string;
  ssdsType: 'User' | 'Application' | 'N/A' | string;
  projectUid?: string;
  businessUnit?: string;
  businessSponsors?: string;
  demandNumber?: string;
  assetsMentioned?: string;
  comments?: string;
  createdBy: string;
  createdAt: string;
}

export interface NoteRevision {
  content: string;
  editedAt: string;
  editedBy: string;
}

export interface CaseNote {
  id: string;
  caseId: string;
  authorId: string;
  createdAt: string;
  content: string;
  category: string;
  pinned: boolean;
  revision: number;
  revisions: NoteRevision[];
}

export interface Communication {
  id: string;
  caseId: string;
  direction: 'Inbound' | 'Outbound';
  channel: string;
  subject: string;
  summary: string;
  sentAt: string;
  status: string;
  createdBy: string;
  sourceEmail?: SourceEmail;
}

export interface SourceEmail {
  filename: string;
  fromName?: string;
  fromEmail?: string;
  to?: string;
  subject: string;
  date?: string;
  bodyText: string;
  rawSizeBytes: number;
}

export interface Decision {
  id: string;
  caseId: string;
  type: string;
  decision: string;
  rationale: string;
  decisionMakerId: string;
  date: string;
  approvalStatus: 'Pending' | 'Approved' | 'Rejected';
}

export interface CaseDocument {
  id: string;
  caseId: string;
  originalFilename: string;
  internalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string;
  uploadedBy: string;
  uploadedAt: string;
  sensitivity: string;
  encrypted: boolean;
}

export interface StatusHistoryEntry {
  id: string;
  caseId: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  actorId: string;
  at: string;
  reason?: string;
}

export interface SlaHistoryEntry {
  id: string;
  caseId: string;
  at: string;
  reason: string;
  previousDue: string;
  newDue: string;
}

export interface AuditEvent {
  id: string;
  seq: number;
  utc: string;
  localDisplay: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  category: string;
  action: string;
  entityType: string;
  entityId: string;
  caseId?: string;
  summary: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  appVersion: string;
  deviceId: string;
  sessionId: string;
  prevHash: string;
  hash: string;
}

export interface IntegrityReport {
  ok: boolean;
  checkedAt: string;
  totalEvents: number;
  brokenAt?: number;
  message: string;
}

// A single editable statutory deadline rule (Automation tab).
export interface SlaRule {
  jurisdiction: string;
  periodDays: number;
  businessDays: boolean;
  note?: string;
}

// ---- Email automation (Automation tab) --------------------------------------

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience: 'requester' | 'department';
  department?: string;
}

export interface AutomationRecipient {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
}

export type AutomationTrigger = 'case.created' | 'case.updated' | 'status.changed';

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  updateField?: string;
  toStatus?: CaseStatus | string;
  requestType?: string;
  intakeChannel?: string;
  templateId: string;
  enabled: boolean;
}

export interface NoteTemplate {
  id: string;
  name: string;
  target: 'comments' | 'description';
  body: string;
}

// ---- Microsoft 365 / Outlook integration (Settings tab) ---------------------

export interface M365Integration {
  connected: boolean;
  accountEmail?: string;
  tenantId?: string;
  connectedAt?: string;
  connectedBy?: string;
  mode: 'graph' | 'outlook' | 'mailto' | 'simulated';
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  fallback?: 'mailto';
}

export interface OrgSettings {
  organizationName: string;
  caseNumberPrefix: string;
  defaultJurisdiction: string;
  autoLockMinutes: number;
  retentionYears: number;
  autoRetentionCleanup: boolean;
  theme: string;
  setupComplete: boolean;
  demoDataInstalled: boolean;
  // ---- SLA automation ----
  slaRules: SlaRule[];
  reminderCadenceDays: number[];
  dueSoonThresholdDays: number;
  autoPauseSla: boolean;
  escalationAlerts: boolean;
  // ---- Email automation ----
  emailTemplates: EmailTemplate[];
  automationRules: AutomationRule[];
  automationRecipients: AutomationRecipient[];
  noteTemplates: NoteTemplate[];
  // ---- Integrations ----
  m365: M365Integration;
}
