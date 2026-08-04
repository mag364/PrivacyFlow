import type { AutomationRule, DsrCase } from './types';

export function automationConditionsMatch(rule: AutomationRule, c: DsrCase): boolean {
  const requestTypes = c.requestTypes.map(String);
  if (rule.requestType && !requestTypes.includes(rule.requestType)) return false;
  if (rule.excludeRequestType && requestTypes.includes(rule.excludeRequestType)) return false;
  if (rule.intakeChannel && c.intakeChannel !== rule.intakeChannel) return false;
  return true;
}

export function requesterAutomationEmail(c: DsrCase): string {
  return c.subject.emails.find((email) => email.trim())?.trim() ?? 'requester';
}
