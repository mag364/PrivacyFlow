// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewCaseInput, PrivacyFlowAPI } from './types';

let api: PrivacyFlowAPI;
let openDraft: ReturnType<typeof vi.fn>;
const input = (dates: NewCaseInput['intakeDates'] = {}): NewCaseInput => ({
  requestTypes: ['Do Not Sell'], intakeChannel: 'Email', jurisdiction: 'US',
  priority: 'Medium', risk: 'Medium', description: 'Test request',
  subject: { lastName: 'Test', emails: ['requester@example.test'], phones: [], addresses: [],
    relationship: 'Client', minor: false, authorizedAgent: false, identifiers: [] },
  intakeDates: dates,
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  openDraft = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('privacyflow', { outlook: { openDraft } });
  const { createBrowserPlatform } = await import('./browser');
  api = createBrowserPlatform();
  await api.system.completeSetup({ demoDataInstalled: false });
  expect((await api.auth.login('admin', 'test')).ok).toBe(true);
  const settings = await api.system.settings();
  await api.system.updateSettings({
    automationRules: settings.automationRules.filter(r => ['rule-standard-response', 'rule-forward-ron'].includes(r.id))
      .map(r => r.id === 'rule-forward-ron' ? { ...r, excludeRequestType: 'Deletion', intakeChannel: 'Email' } : r),
    automationRecipients: [{ id: 'ron', name: 'Ron K.', email: 'ron@example.test', enabled: true }],
    m365: { connected: true, mode: 'outlook', accountEmail: 'operator@example.test' },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function expectForward(id: string) {
  const communications = await api.cases.communications(id);
  expect(communications.filter(c => c.summary.includes('[Automated · Forward email to Ron K.]'))).toHaveLength(1);
  expect(openDraft).toHaveBeenCalledWith(expect.objectContaining({ to: 'ron@example.test' }));
}

describe('Ron forwarding with the reported Do Not Sell rule', () => {
  it('runs when both dates are populated on submission', async () => {
    const c = await api.cases.create(input({ standardResponseSent: '2026-09-11', forwardedEmailToRon: '2026-09-11' }));
    await expectForward(c.id);
  });
  it('runs when both dates are populated in one edit', async () => {
    const c = await api.cases.create(input());
    await api.cases.update(c.id, { intakeDates: { standardResponseSent: '2026-09-11', forwardedEmailToRon: '2026-09-11' } });
    await expectForward(c.id);
  });
  it('runs when forwarding is populated after the standard response', async () => {
    const c = await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(openDraft).toHaveBeenCalledWith(expect.objectContaining({ to: 'requester@example.test' }));
    await api.cases.update(c.id, { intakeDates: { ...c.intakeDates, forwardedEmailToRon: '2026-09-11' } });
    await expectForward(c.id);
  });
  it('does not retry a previously skipped milestone when only its existing date changes', async () => {
    const excluded = input({ standardResponseSent: '2026-09-10', forwardedEmailToRon: '2026-09-10' });
    excluded.requestTypes = ['Deletion'];
    const c = await api.cases.create(excluded);
    expect(openDraft).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'ron@example.test' }));
    await api.cases.update(c.id, { requestTypes: ['Do Not Sell'],
      intakeDates: { ...c.intakeDates, forwardedEmailToRon: '2026-09-11' } });
    expect((await api.cases.getById(c.id))?.status).toBe('Email Ron K.');
    expect((await api.cases.communications(c.id)).filter(c => c.summary.includes('[Automated · Forward email to Ron K.]'))).toHaveLength(0);
  });
  it('runs on explicit status transition', async () => {
    const c = await api.cases.create(input());
    await api.cases.transition(c.id, 'Email Ron K.');
    await expectForward(c.id);
  });
});


describe('Cc delivery', () => {
  async function configure(cc: string) {
    const settings = await api.system.settings();
    await api.system.updateSettings({ emailTemplates: settings.emailTemplates.map(t =>
      t.id === 'tpl-standard-response' ? { ...t, cc } : t) });
  }
  it('passes resolved Cc to Outlook and records it in Communications and Audit', async () => {
    await configure('Ron K.; extra@example.test');
    const c = await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(openDraft).toHaveBeenCalledWith(expect.objectContaining({
      to: 'requester@example.test', cc: 'ron@example.test; extra@example.test',
    }));
    expect((await api.cases.communications(c.id))[0].summary).toContain('Cc: ron@example.test; extra@example.test');
    expect((await api.audit.byCase(c.id)).some(e => (e.newValue as { cc?: string })?.cc === 'ron@example.test; extra@example.test')).toBe(true);
  });
  it('records a failure instead of silently omitting an unavailable Cc recipient', async () => {
    await configure('Missing department');
    const c = await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(openDraft).not.toHaveBeenCalled();
    const communications = await api.cases.communications(c.id);
    expect(communications[0].status).toBe('Draft not opened');
    expect(communications[0].summary).toContain('Missing department');
  });
  it('preserves Cc in the default mail app handoff', async () => {
    await configure('Ron K.');
    const mailDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('privacyflow', { mail: { openDraft: mailDraft } });
    await api.system.updateSettings({ m365: { connected: true, mode: 'mailto' } });
    await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(mailDraft).toHaveBeenCalledWith(expect.objectContaining({ cc: 'ron@example.test' }));
  });
  it('preserves Cc in Graph sending and its mail fallback', async () => {
    await configure('Ron K.');
    const sendMail = vi.fn().mockResolvedValue(true);
    const mailDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('privacyflow', { graph: { sendMail }, mail: { openDraft: mailDraft } });
    await api.system.updateSettings({ m365: { connected: true, mode: 'graph', clientId: 'test', accessToken: 'test', expiresAt: '2099-01-01T00:00:00Z' } });
    await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ cc: 'ron@example.test' }));
    sendMail.mockRejectedValueOnce(new Error('Test failure'));
    await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(mailDraft).toHaveBeenCalledWith(expect.objectContaining({ cc: 'ron@example.test' }));
  });
});


describe('rich template delivery', () => {
  it('sends escaped HTML plus readable text to Outlook with Cc', async () => {
    const settings = await api.system.settings();
    await api.system.updateSettings({ emailTemplates: settings.emailTemplates.map(t => t.id === 'tpl-standard-response'
      ? { ...t, bodyFormat: 'html', body: '<p>Hello <b>{{requester.lastName}}</b></p><img src="data:image/png;base64,aGVsbG8=">', cc: 'Ron K.' } : t) });
    const request = input({ standardResponseSent: '2026-09-11' });
    request.subject.lastName = '<Test & Co>';
    const c = await api.cases.create(request);
    expect(openDraft).toHaveBeenCalledWith(expect.objectContaining({
      cc: 'ron@example.test', bodyHtml: expect.stringContaining('<b>&lt;Test &amp; Co&gt;</b>'),
      body: expect.stringContaining('Hello <Test & Co>'),
    }));
    expect((await api.cases.communications(c.id))[0].summary).not.toContain('base64');
  });
  it('sends HTML to Graph and explains plain-text mailto fallback', async () => {
    const settings = await api.system.settings();
    await api.system.updateSettings({ emailTemplates: settings.emailTemplates.map(t => t.id === 'tpl-standard-response'
      ? { ...t, bodyFormat: 'html', body: '<p><b>Formatted</b></p>' } : t),
      m365: { connected: true, mode: 'graph', clientId: 'test', accessToken: 'test', expiresAt: '2099-01-01T00:00:00Z' } });
    const sendMail = vi.fn().mockResolvedValue(true);
    const mailDraft = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('privacyflow', { graph: { sendMail }, mail: { openDraft: mailDraft } });
    await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ bodyHtml: expect.stringContaining('<p><b>Formatted</b></p>') }));
    sendMail.mockRejectedValueOnce(new Error('test failure'));
    const c = await api.cases.create(input({ standardResponseSent: '2026-09-11' }));
    expect(mailDraft).toHaveBeenCalledWith(expect.objectContaining({ body: 'Formatted' }));
    expect((await api.cases.communications(c.id))[0].summary).toContain('plain-text fallback');
  });
});
