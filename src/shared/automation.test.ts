import { describe, expect, it } from 'vitest';
import type { AutomationRule, DsrCase } from './types';
import { automationConditionsMatch, requesterAutomationEmail } from './automation';

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    trigger: 'case.created',
    templateId: 'template-1',
    enabled: true,
    ...overrides,
  };
}

function request(requestTypes: string[], intakeChannel = 'Email'): DsrCase {
  return {
    id: 'case-1',
    caseNumber: 'DSRREQ0000001',
    status: 'New',
    requestTypes,
    intakeChannel,
    description: '',
    jurisdiction: 'US',
    priority: 'Medium',
    risk: 'Medium',
    tags: [],
    subject: {
      lastName: 'Person',
      emails: ['person@example.com'],
      phones: [],
      addresses: [],
      relationship: 'Customer',
      minor: false,
      authorizedAgent: false,
      identifiers: [],
    },
    verificationStatus: 'Not Started',
    sla: {
      receivedDate: '2026-08-03T00:00:00.000Z',
      originalDueDate: '2026-09-17T00:00:00.000Z',
      currentDueDate: '2026-09-17T00:00:00.000Z',
      pausedTotalDays: 0,
      ruleName: 'US',
      businessDays: false,
      periodDays: 45,
    },
    demo: false,
    createdBy: 'user-1',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    lastActivityAt: '2026-08-03T00:00:00.000Z',
    nextAction: '',
  };
}

describe('automationConditionsMatch', () => {
  it('matches any request type except the configured exception', () => {
    const exceptDeletion = rule({ excludeRequestType: 'Deletion' });

    expect(automationConditionsMatch(exceptDeletion, request(['Do Not Sell']))).toBe(true);
    expect(automationConditionsMatch(exceptDeletion, request(['Deletion']))).toBe(false);
    expect(automationConditionsMatch(exceptDeletion, request(['Access', 'Deletion']))).toBe(false);
  });

  it('applies both required request type and intake channel conditions', () => {
    const emailDoNotSell = rule({ requestType: 'Do Not Sell', intakeChannel: 'Email' });

    expect(automationConditionsMatch(emailDoNotSell, request(['Do Not Sell']))).toBe(true);
    expect(automationConditionsMatch(emailDoNotSell, request(['Do Not Sell'], 'Web Form'))).toBe(false);
    expect(automationConditionsMatch(emailDoNotSell, request(['Access']))).toBe(false);
  });
});

describe('requesterAutomationEmail', () => {
  it('uses the requester email entered on the case', () => {
    expect(requesterAutomationEmail(request(['Access']))).toBe('person@example.com');
  });

  it('does not invent a recipient when the case has no requester email', () => {
    const withoutEmail = request(['Access']);
    withoutEmail.subject.emails = [];

    expect(requesterAutomationEmail(withoutEmail)).toBe('requester');
  });
});
