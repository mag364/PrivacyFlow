import { describe, expect, it } from 'vitest';
import { parseCcAddresses, resolveAutomationCc } from './emailRecipients';
const recipients = [{ id: 'ron', name: 'Ron K.', email: 'ron@example.test', enabled: true }];
describe('template Cc recipients', () => {
  it('supports optional Cc and comma or semicolon separated addresses', () => {
    expect(parseCcAddresses()).toEqual([]);
    expect(parseCcAddresses(' a@example.test; b@example.test, A@example.test ')).toEqual(['a@example.test', 'b@example.test']);
  });
  it('resolves departments and removes duplicates and the To recipient', () => {
    expect(resolveAutomationCc('Ron K.; ron@example.test; primary@example.test; other@example.test', recipients, 'PRIMARY@example.test'))
      .toBe('ron@example.test; other@example.test');
  });
  it('uses changed recipient addresses', () => {
    expect(resolveAutomationCc('Ron K.', [{ ...recipients[0], email: 'new@example.test' }])).toBe('new@example.test');
  });
  it('rejects invalid addresses and disabled, missing, or unconfigured recipients', () => {
    expect(() => parseCcAddresses('bad-address')).toThrow('Invalid Cc');
    expect(() => parseCcAddresses('a@example.test\r\nBcc: hidden@example.test')).toThrow('Invalid Cc');
    expect(() => resolveAutomationCc('Unknown', recipients)).toThrow('enabled email');
    expect(() => resolveAutomationCc('Ron K.', [{ ...recipients[0], enabled: false }])).toThrow('enabled email');
    expect(() => resolveAutomationCc('Ron K.', [{ ...recipients[0], email: '' }])).toThrow('enabled email');
  });
});
