import type {
  AutomationRecipient, AutomationRule, EmailTemplate, NoteTemplate, UserSettings,
} from './types';

export const AUTOMATION_TRANSFER_FORMAT = 'privacyflow.automation';
export const AUTOMATION_TRANSFER_VERSION = 1;

export interface AutomationTransferData {
  emailTemplates: EmailTemplate[];
  automationRules: AutomationRule[];
  automationRecipients: AutomationRecipient[];
  noteTemplates: NoteTemplate[];
}

export interface AutomationTransferFile {
  format: typeof AUTOMATION_TRANSFER_FORMAT;
  version: typeof AUTOMATION_TRANSFER_VERSION;
  exportedAt: string;
  data: AutomationTransferData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function assertUniqueIds(items: { id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${label} contains duplicate ID "${item.id}".`);
    ids.add(item.id);
  }
}

function parseTemplate(value: unknown, index: number): EmailTemplate {
  if (!isRecord(value)) throw new Error(`Email template ${index + 1} must be an object.`);
  const audience = requiredString(value.audience, `Email template ${index + 1} audience`);
  if (audience !== 'requester' && audience !== 'department') {
    throw new Error(`Email template ${index + 1} has an unsupported audience.`);
  }
  return {
    id: requiredString(value.id, `Email template ${index + 1} ID`),
    name: stringValue(value.name, `Email template ${index + 1} name`),
    subject: stringValue(value.subject, `Email template ${index + 1} subject`),
    body: stringValue(value.body, `Email template ${index + 1} body`),
    audience,
    department: optionalString(value.department, `Email template ${index + 1} department`),
  };
}

function parseRule(value: unknown, index: number): AutomationRule {
  if (!isRecord(value)) throw new Error(`Automation rule ${index + 1} must be an object.`);
  const trigger = requiredString(value.trigger, `Automation rule ${index + 1} trigger`);
  if (trigger !== 'case.created' && trigger !== 'case.updated' && trigger !== 'status.changed') {
    throw new Error(`Automation rule ${index + 1} has an unsupported trigger.`);
  }
  return {
    id: requiredString(value.id, `Automation rule ${index + 1} ID`),
    name: stringValue(value.name, `Automation rule ${index + 1} name`),
    trigger,
    updateField: optionalString(value.updateField, `Automation rule ${index + 1} changed field`),
    toStatus: optionalString(value.toStatus, `Automation rule ${index + 1} status`),
    requestType: optionalString(value.requestType, `Automation rule ${index + 1} request type`),
    excludeRequestType: optionalString(value.excludeRequestType, `Automation rule ${index + 1} request type exception`),
    intakeChannel: optionalString(value.intakeChannel, `Automation rule ${index + 1} intake channel`),
    templateId: requiredString(value.templateId, `Automation rule ${index + 1} template ID`),
    enabled: requiredBoolean(value.enabled, `Automation rule ${index + 1} enabled value`),
  };
}

function parseRecipient(value: unknown, index: number): AutomationRecipient {
  if (!isRecord(value)) throw new Error(`Automation recipient ${index + 1} must be an object.`);
  return {
    id: requiredString(value.id, `Automation recipient ${index + 1} ID`),
    name: stringValue(value.name, `Automation recipient ${index + 1} name`),
    email: optionalString(value.email, `Automation recipient ${index + 1} email`) ?? '',
    enabled: requiredBoolean(value.enabled, `Automation recipient ${index + 1} enabled value`),
  };
}

function parseNoteTemplate(value: unknown, index: number): NoteTemplate {
  if (!isRecord(value)) throw new Error(`Note template ${index + 1} must be an object.`);
  const target = requiredString(value.target, `Note template ${index + 1} target`);
  if (target !== 'comments' && target !== 'description') {
    throw new Error(`Note template ${index + 1} has an unsupported target.`);
  }
  return {
    id: requiredString(value.id, `Note template ${index + 1} ID`),
    name: stringValue(value.name, `Note template ${index + 1} name`),
    target,
    body: stringValue(value.body, `Note template ${index + 1} body`),
  };
}

export function createAutomationTransfer(settings: UserSettings): AutomationTransferFile {
  return {
    format: AUTOMATION_TRANSFER_FORMAT,
    version: AUTOMATION_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      emailTemplates: settings.emailTemplates,
      automationRules: settings.automationRules,
      automationRecipients: settings.automationRecipients,
      noteTemplates: settings.noteTemplates,
    },
  };
}

export function parseAutomationTransfer(text: string): AutomationTransferData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('The automation file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== AUTOMATION_TRANSFER_FORMAT) {
    throw new Error('This is not a PrivacyFlow automation transfer file.');
  }
  if (parsed.version !== AUTOMATION_TRANSFER_VERSION) {
    throw new Error(`Unsupported automation transfer version: ${String(parsed.version)}.`);
  }
  if (!isRecord(parsed.data)) throw new Error('The automation transfer data is missing.');

  const emailTemplates = requiredArray(parsed.data.emailTemplates, 'Email templates').map(parseTemplate);
  const automationRules = requiredArray(parsed.data.automationRules, 'Automation rules').map(parseRule);
  const automationRecipients = requiredArray(parsed.data.automationRecipients, 'Automation recipients').map(parseRecipient);
  const noteTemplates = requiredArray(parsed.data.noteTemplates, 'Note templates').map(parseNoteTemplate);
  assertUniqueIds(emailTemplates, 'Email templates');
  assertUniqueIds(automationRules, 'Automation rules');
  assertUniqueIds(automationRecipients, 'Automation recipients');
  assertUniqueIds(noteTemplates, 'Note templates');

  const templateIds = new Set(emailTemplates.map((template) => template.id));
  const missingTemplate = automationRules.find((rule) => !templateIds.has(rule.templateId));
  if (missingTemplate) {
    throw new Error(`Automation rule "${missingTemplate.name}" refers to a missing email template.`);
  }
  return { emailTemplates, automationRules, automationRecipients, noteTemplates };
}
