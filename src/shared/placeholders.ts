import type { DsrCase, Project } from './types';

export interface PlaceholderDef {
  key: string;
  token: string;
  label: string;
}

const token = (key: string) => `{{${key}}}`;
const def = (key: string, label: string): PlaceholderDef => ({ key, token: token(key), label });

export const REQUEST_PLACEHOLDERS: PlaceholderDef[] = [
  def('case.requestId', 'Request ID'),
  def('case.number', 'DSRREQ #'),
  def('case.types', 'Request types'),
  def('case.status', 'Status'),
  def('case.intakeChannel', 'Intake channel'),
  def('case.description', 'Description'),
  def('case.receivedDate', 'Received date'),
  def('case.createdAt', 'Created date'),
  def('case.updatedAt', 'Updated date'),
  def('case.lastActivityAt', 'Last activity date'),
  def('case.standardResponseSent', 'Standard response sent'),
  def('case.forwardedEmailToRon', 'Forwarded email to Ron K.'),
  def('case.followUpEmailSent', 'Follow-up sent'),
  def('case.closedDate', 'Closed date'),
  def('case.resolutionDate', 'Resolution date'),
  def('case.priority', 'Priority'),
  def('case.risk', 'Risk'),
  def('case.businessUnit', 'Business unit'),
  def('case.ownerId', 'Owner ID'),
  def('case.team', 'Team'),
  def('case.tags', 'Tags'),
  def('case.verificationStatus', 'Verification status'),
  def('case.nextAction', 'Next action'),
  def('case.closureSummary', 'Closure summary'),
  def('case.createdBy', 'Created by'),
  def('requester.lastName', 'Requester last name'),
  def('requester.email', 'Requester email'),
  def('requester.relationship', 'Relationship'),
  def('requester.minor', 'Minor'),
  def('requester.authorizedAgent', 'Authorized agent'),
  def('requester.clientCenterStatus', 'Client Center Status'),
  def('requester.emailedFA', 'Emailed FA'),
  def('org.name', 'Organization name'),
  def('rule.department', 'Rule department'),
];

export const PROJECT_PLACEHOLDERS: PlaceholderDef[] = [
  def('project.number', 'Project number'),
  def('project.name', 'Project name'),
  def('project.status', 'Status'),
  def('project.source', 'Source'),
  def('project.dateNotificationReceived', 'Notification received date'),
  def('project.notificationCancelled', 'Project cancelled'),
  def('project.ritmNumber', 'RITM number'),
  def('project.investmentClass', 'Investment class'),
  def('project.description', 'Description'),
  def('project.fiscalYear', 'Fiscal year'),
  def('project.piaNumber', 'PIA number'),
  def('project.ssdsTask', 'SSDS task'),
  def('project.ssdsType', 'SSDS type'),
  def('project.uid', 'Project UID'),
  def('project.businessUnit', 'Business unit'),
  def('project.businessSponsors', 'Business sponsors'),
  def('project.demandNumber', 'Demand number'),
  def('project.assetsMentioned', 'Assets mentioned'),
  def('project.comments', 'Comments'),
  def('project.createdBy', 'Created by'),
  def('project.createdAt', 'Created date'),
  def('org.name', 'Organization name'),
];

export function replacePlaceholders(text: string, values: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function requestIdForCase(c: DsrCase): string {
  return c.subject.identifiers.find((i) => i.label === 'Request ID')?.value ?? c.subject.firstName ?? '';
}

export function formatPlaceholderDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function boolText(value?: boolean): string {
  if (value === undefined) return '';
  return value ? 'Yes' : 'No';
}

export function requestPlaceholderValues(
  c: DsrCase,
  orgName: string,
  department?: string,
): Record<string, string> {
  return {
    'case.requestId': requestIdForCase(c),
    'case.number': c.caseNumber,
    'case.types': c.requestTypes.join(', '),
    'case.status': c.status,
    'case.intakeChannel': String(c.intakeChannel),
    'case.description': c.description,
    'case.receivedDate': formatPlaceholderDate(c.sla.receivedDate),
    'case.createdAt': formatPlaceholderDate(c.createdAt),
    'case.updatedAt': formatPlaceholderDate(c.updatedAt),
    'case.lastActivityAt': formatPlaceholderDate(c.lastActivityAt),
    'case.standardResponseSent': formatPlaceholderDate(c.intakeDates?.standardResponseSent),
    'case.forwardedEmailToRon': formatPlaceholderDate(c.intakeDates?.forwardedEmailToRon),
    'case.followUpEmailSent': formatPlaceholderDate(c.intakeDates?.followUpEmailSent),
    'case.closedDate': formatPlaceholderDate(c.sla.closureDate ?? c.resolutionDate),
    'case.resolutionDate': formatPlaceholderDate(c.resolutionDate),
    'case.priority': c.priority,
    'case.risk': c.risk,
    'case.businessUnit': c.businessUnit ?? '',
    'case.ownerId': c.ownerId ?? '',
    'case.team': c.team ?? '',
    'case.tags': c.tags.join(', '),
    'case.verificationStatus': String(c.verificationStatus),
    'case.nextAction': c.nextAction,
    'case.closureSummary': c.closureSummary ?? '',
    'case.createdBy': c.createdBy,
    'requester.lastName': c.subject.lastName,
    'requester.email': c.subject.emails[0] ?? '',
    'requester.relationship': String(c.subject.relationship),
    'requester.minor': boolText(c.subject.minor),
    'requester.authorizedAgent': boolText(c.subject.authorizedAgent),
    'requester.clientCenterStatus': c.subject.clientCenterStatus ?? '',
    'requester.emailedFA': formatPlaceholderDate(c.subject.emailedFA),
    'org.name': orgName,
    'rule.department': department ?? '',
  };
}

export function projectPlaceholderValues(p: Project, orgName: string): Record<string, string> {
  return {
    'project.number': p.projectNumber,
    'project.name': p.projectName,
    'project.status': String(p.status),
    'project.source': String(p.source),
    'project.dateNotificationReceived': formatPlaceholderDate(p.dateNotificationReceived),
    'project.notificationCancelled': boolText(p.notificationCancelled),
    'project.ritmNumber': p.ritmNumber ?? '',
    'project.investmentClass': String(p.investmentClass),
    'project.description': p.description,
    'project.fiscalYear': p.fiscalYear ?? '',
    'project.piaNumber': p.piaNumber ?? '',
    'project.ssdsTask': p.ssdsTask ?? '',
    'project.ssdsType': String(p.ssdsType),
    'project.uid': p.projectUid ?? '',
    'project.businessUnit': p.businessUnit ?? '',
    'project.businessSponsors': p.businessSponsors ?? '',
    'project.demandNumber': p.demandNumber ?? '',
    'project.assetsMentioned': p.assetsMentioned ?? '',
    'project.comments': p.comments ?? '',
    'project.createdBy': p.createdBy,
    'project.createdAt': formatPlaceholderDate(p.createdAt),
    'org.name': orgName,
  };
}
