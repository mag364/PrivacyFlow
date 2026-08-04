import { describe, expect, it } from 'vitest';
import type { UserSettings } from './types';
import { createAutomationTransfer, parseAutomationTransfer } from './automationTransfer';

const settings: UserSettings = {
  emailTemplates: [{ id: 'template-1', name: 'Response', subject: 'Subject', body: 'Body', audience: 'requester' }],
  automationRules: [{ id: 'rule-1', name: 'On create', trigger: 'case.created', templateId: 'template-1', enabled: true }],
  automationRecipients: [{ id: 'recipient-1', name: 'Privacy', email: 'privacy@example.com', enabled: true }],
  noteTemplates: [{ id: 'note-1', name: 'Review', target: 'comments', body: 'Reviewed.' }],
  m365: {
    connected: true,
    mode: 'graph',
    accountEmail: 'private@example.com',
    accessToken: 'secret-access-token',
    refreshToken: 'secret-refresh-token',
  },
};

describe('automation transfers', () => {
  it('round-trips automation settings without Outlook credentials', () => {
    const file = createAutomationTransfer(settings);
    const serialized = JSON.stringify(file);

    expect(parseAutomationTransfer(serialized)).toEqual(file.data);
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('secret-access-token');
    expect(serialized).not.toContain('secret-refresh-token');
  });

  it('rejects rules that refer to missing templates', () => {
    const file = createAutomationTransfer(settings);
    file.data.emailTemplates = [];

    expect(() => parseAutomationTransfer(JSON.stringify(file))).toThrow('missing email template');
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseAutomationTransfer('{"cases":[]}')).toThrow('not a PrivacyFlow automation transfer file');
  });
});
