import type {
  DsrCase, User, AuditEvent, IntegrityReport, OrgSettings, Task, CaseNote,
  Communication, Decision, CaseDocument, StatusHistoryEntry, SlaHistoryEntry,
  DataSubject, IntakeDates, Project,
} from '@shared/types';
import type {
  CaseStatus, RequestType, IntakeChannel, Jurisdiction, Priority, RiskLevel, Role,
} from '@shared/constants';

// -----------------------------------------------------------------------------
// The single contract the renderer depends on. Implemented by the browser
// fallback (localStorage) and, in the packaged desktop build, by the Electron
// preload bridge over IPC to a SQLite-backed service. UI code imports ONLY this
// interface so the backend is fully swappable.
// -----------------------------------------------------------------------------

export interface NameValue {
  name: string;
  value: number;
}

export interface DashboardMetrics {
  openCases: number;
  newCases: number;
  awaitingVerification: number;
  dueSoon: number;
  overdue: number;
  paused: number;
  unassigned: number;
  highRisk: number;
  completedThisMonth: number;
  avgCompletionDays: number;
  onTimeRate: number;
  byType: NameValue[];
  byJurisdiction: NameValue[];
  byStatus: NameValue[];
  byAnalyst: NameValue[];
  accessCount: number;
  deletionCount: number;
  correctionCount: number;
  unsubscribeCount: number;
  doNotSaleCount: number;
  receivedThisMonth: number;
  closedThisMonth: number;
}

export interface NewCaseInput {
  requestTypes: (RequestType | string)[];
  intakeChannel: IntakeChannel | string;
  jurisdiction: Jurisdiction | string;
  priority: Priority;
  risk: RiskLevel;
  businessUnit?: string;
  description: string;
  caseNumberOverride?: string;
  ownerId?: string;
  subject: DataSubject;
  intakeDates?: IntakeDates;
}

export type NewProjectInput = Omit<Project, 'id' | 'createdBy' | 'createdAt' | 'projectNumber' | 'status'> & {
  // Optional: when blank the platform auto-assigns the next PRJ0000000 number.
  projectNumber?: string;
  // Optional: projects start in "New" unless a different workflow status is
  // supplied (e.g. when importing historical records).
  status?: Project['status'];
};

export interface CompleteSetupInput {
  organizationName?: string;
  caseNumberPrefix?: string;
  defaultJurisdiction?: string;
  autoLockMinutes?: number;
  theme?: string;
  demoDataInstalled?: boolean;
}

export interface LoginResult {
  ok: boolean;
  user?: User;
  error?: string;
  // True when the credentials are valid but the account is flagged for a
  // mandatory password change before access is granted.
  mustChangePassword?: boolean;
}

export interface CreateUserInput {
  name: string;
  username: string;
  email?: string;
  role: Role;
}

export interface CreateUserResult {
  user: User;
  // The generated temporary password, returned ONCE so the admin can share
  // it with the new user. Only the hash is stored afterwards.
  tempPassword: string;
}

export interface UpdateUserInput {
  role?: Role;
  active?: boolean;
}

export interface AddDocumentInput {
  originalFilename: string;
  mimeType?: string;
  sizeBytes?: number;
  category?: string;
}

export interface AddCommunicationInput {
  subject: string;
  summary: string;
  direction?: 'Inbound' | 'Outbound';
  channel?: string;
}

export interface PrivacyFlowAPI {
  isElectron: boolean;

  system: {
    settings: () => Promise<OrgSettings>;
    completeSetup: (input: CompleteSetupInput) => Promise<OrgSettings>;
    updateSettings: (patch: Partial<OrgSettings>) => Promise<OrgSettings>;
    resetApplication: () => Promise<void>;
  };

  auth: {
    currentUser: () => Promise<User | null>;
    listUsers: () => Promise<User[]>;
    login: (username: string, password: string) => Promise<LoginResult>;
    logout: () => Promise<void>;
    createUser: (input: CreateUserInput) => Promise<CreateUserResult>;
    updateUser: (id: string, patch: UpdateUserInput) => Promise<User>;
    deleteUser: (id: string) => Promise<void>;
    changePassword: (username: string, currentPassword: string, newPassword: string) => Promise<LoginResult>;
  };

  cases: {
    list: () => Promise<DsrCase[]>;
    getById: (id: string) => Promise<DsrCase | null>;
    create: (input: NewCaseInput) => Promise<DsrCase>;
    update: (id: string, patch: Partial<DsrCase>, reason?: string) => Promise<DsrCase>;
    transition: (id: string, to: CaseStatus, reason?: string) => Promise<DsrCase>;
    updateCaseNumber: (id: string, caseNumber: string) => Promise<DsrCase>;
    statusHistory: (id: string) => Promise<StatusHistoryEntry[]>;
    slaHistory: (id: string) => Promise<SlaHistoryEntry[]>;
    tasks: (id: string) => Promise<Task[]>;
    notes: (id: string) => Promise<CaseNote[]>;
    communications: (id: string) => Promise<Communication[]>;
    decisions: (id: string) => Promise<Decision[]>;
    documents: (id: string) => Promise<CaseDocument[]>;
    addNote: (id: string, content: string, category: string) => Promise<CaseNote>;
    addDocument: (id: string, input: AddDocumentInput) => Promise<CaseDocument>;
    addCommunication: (id: string, input: AddCommunicationInput) => Promise<Communication>;
    completeTask: (caseId: string, taskId: string) => Promise<Task>;
  };

  projects: {
    list: () => Promise<Project[]>;
    create: (input: NewProjectInput) => Promise<Project>;
    update: (id: string, patch: Partial<Project>, reason?: string) => Promise<Project>;
    updateProjectNumber: (id: string, projectNumber: string) => Promise<Project>;
    communications: (id: string) => Promise<Communication[]>;
    addCommunication: (id: string, input: AddCommunicationInput) => Promise<Communication>;
  };

  dashboard: {
    metrics: () => Promise<DashboardMetrics>;
  };

  audit: {
    list: () => Promise<AuditEvent[]>;
    byCase: (caseId: string) => Promise<AuditEvent[]>;
    verifyIntegrity: () => Promise<IntegrityReport>;
  };
}
