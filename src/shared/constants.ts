// -----------------------------------------------------------------------------
// Enumerations and role/permission matrix. Single source of truth shared by the
// renderer and the main process.
// -----------------------------------------------------------------------------

// Request workflow: New → Email Response Sent → Email Ron K. →
// Follow-up Email Sent → Closed
export const CASE_STATUSES = [
  'New',
  'Email Response Sent',
  'Email Ron K.',
  'Follow-up Email Sent',
  'Closed',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const OPEN_STATUSES: CaseStatus[] = [
  'New',
  'Email Response Sent',
  'Email Ron K.',
  'Follow-up Email Sent',
];

// Project workflow: New → Reviewing → Needs Assessment → Assessment Sent →
// Approved / Denied / Closed
export const PROJECT_STATUSES = [
  'New',
  'Reviewing',
  'Needs Assessment',
  'Assessment Sent',
  'Approved',
  'Denied',
  'Closed',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Maps statuses from earlier versions of the app onto the current request
// workflow so existing workspaces migrate cleanly.
export const LEGACY_STATUS_MAP: Record<string, CaseStatus> = {
  Triage: 'Email Response Sent',
  'Awaiting Identity Verification': 'Email Response Sent',
  'Identity Verified': 'Email Response Sent',
  'In Progress': 'Email Response Sent',
  'Waiting on Business Unit': 'Follow-up Email Sent',
  'Waiting on Requester': 'Follow-up Email Sent',
  'Legal or Privacy Review': 'Email Ron K.',
  Fulfilled: 'Closed',
  'Partially Fulfilled': 'Closed',
  'Denied or Refused': 'Closed',
  Withdrawn: 'Closed',
  Archived: 'Closed',
};

export const REQUEST_TYPES = [
  'Access',
  'Deletion',
  'Correction',
  'Unsubscribe',
  'Do Not Sell',
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const INTAKE_CHANNELS = [
  'Email',
  'Web Form',
  'Phone',
  'Postal Mail',
  'In Person',
  'Regulator Referral',
] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

export const JURISDICTIONS = [
  'GDPR (EU/EEA)',
  'UK GDPR',
  'CCPA/CPRA (California)',
  'LGPD (Brazil)',
  'PIPEDA (Canada)',
  'US',
  'Other',
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const CLIENT_CENTER_STATUSES = ['Not located', 'Located', 'Closed'] as const;
export type ClientCenterStatus = (typeof CLIENT_CENTER_STATUSES)[number];

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const VERIFICATION_STATUSES = ['Not Started', 'Pending', 'Verified', 'Failed'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const RELATIONSHIP_TYPES = [
  'Client',
  'Employee',
  'Former Employee',
  'Prospect',
  'Vendor',
  'Other',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// ---- Roles & permissions ----------------------------------------------------
export const ROLES = [
  'administrator',
  'privacy_manager',
  'privacy_analyst',
  'reviewer',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: 'Administrator',
  privacy_manager: 'Privacy Manager',
  privacy_analyst: 'Privacy Analyst',
  reviewer: 'Reviewer',
  auditor: 'Auditor',
};

export const PERMISSIONS = [
  'requests.view',
  'requests.create',
  'requests.update',
  'requests.delete',
  'projects.view',
  'projects.create',
  'projects.update',
  'projects.delete',
  'audit.view',
  'audit.verify',
  'reports.view',
  'settings.manage',
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  administrator: [...PERMISSIONS],
  privacy_manager: [
    'requests.view', 'requests.create', 'requests.update', 'requests.delete',
    'projects.view', 'projects.create', 'projects.update', 'projects.delete',
    'audit.view', 'audit.verify', 'reports.view', 'settings.manage',
  ],
  privacy_analyst: [
    'requests.view', 'requests.create', 'requests.update',
    'projects.view', 'projects.create', 'projects.update',
    'reports.view',
  ],
  reviewer: ['requests.view', 'projects.view', 'projects.update', 'reports.view', 'audit.view'],
  auditor: ['requests.view', 'projects.view', 'audit.view', 'audit.verify', 'reports.view'],
};
