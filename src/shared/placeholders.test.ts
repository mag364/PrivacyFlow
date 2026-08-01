import { describe, expect, it } from 'vitest';
import type { DsrCase, Project } from './types';
import {
  projectPlaceholderValues,
  replacePlaceholders,
  requestIdForCase,
  requestPlaceholderValues,
} from './placeholders';

describe('placeholders', () => {
  it('resolves Request ID separately from DSRREQ number', () => {
    const c: DsrCase = {
      id: 'case-1',
      caseNumber: 'DSRREQ-123',
      status: 'New',
      requestTypes: ['Access'],
      intakeChannel: 'Email',
      description: 'Request description',
      jurisdiction: 'US',
      priority: 'Medium',
      risk: 'Medium',
      tags: ['tag-a'],
      subject: {
        lastName: 'Smith',
        emails: ['smith@example.com'],
        phones: [],
        addresses: [],
        relationship: 'Client',
        minor: false,
        authorizedAgent: true,
        identifiers: [{ label: 'Request ID', value: 'PH-0000001' }],
      },
      verificationStatus: 'Pending',
      sla: {
        receivedDate: '2026-08-01',
        originalDueDate: '2026-08-31',
        currentDueDate: '2026-08-31',
        pausedTotalDays: 0,
        ruleName: 'Default',
        businessDays: false,
        periodDays: 30,
      },
      demo: false,
      createdBy: 'admin',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
      lastActivityAt: '2026-08-01T12:00:00.000Z',
      nextAction: 'Review',
    };

    const values = requestPlaceholderValues(c, 'PrivacyFlow Org', 'Ron K.');

    expect(requestIdForCase(c)).toBe('PH-0000001');
    expect(replacePlaceholders('{{case.requestId}} / {{case.number}}', values)).toBe('PH-0000001 / DSRREQ-123');
    expect(replacePlaceholders('{{requester.authorizedAgent}}', values)).toBe('Yes');
  });

  it('resolves project placeholders and blanks unknown values', () => {
    const p: Project = {
      id: 'project-1',
      projectNumber: 'PRJ-101',
      projectName: 'Portal Review',
      status: 'Reviewing',
      source: 'DD',
      notificationCancelled: false,
      investmentClass: 'CTB',
      description: 'Project description',
      ssdsType: 'User',
      businessUnit: 'Privacy',
      createdBy: 'admin',
      createdAt: '2026-08-01T12:00:00.000Z',
    };

    const values = projectPlaceholderValues(p, 'PrivacyFlow Org');

    expect(replacePlaceholders('{{project.name}} - {{project.businessUnit}} - {{org.name}}', values))
      .toBe('Portal Review - Privacy - PrivacyFlow Org');
    expect(replacePlaceholders('{{project.ritmNumber}}{{missing.value}}', values)).toBe('');
  });
});
