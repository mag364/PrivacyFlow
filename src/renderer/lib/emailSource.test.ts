import { describe, expect, it } from 'vitest';
import type { SourceEmail } from '@shared/types';
import { sourceEmailDescription, sourceEmailSummary } from './emailSource';

describe('source email request fields', () => {
  const email: SourceEmail = {
    filename: 'request.eml',
    fromName: 'Example Person',
    fromEmail: 'person@example.com',
    to: 'privacy@example.com',
    subject: 'Do not sell request',
    date: '2026-08-04T12:00:00.000Z',
    bodyText: 'This full message should remain in Communications.',
    rawSizeBytes: 512,
  };

  it('uses only the subject as the request description', () => {
    expect(sourceEmailDescription(email)).toBe('Do not sell request');
    expect(sourceEmailDescription(email)).not.toContain(email.bodyText);
  });

  it('keeps the full body in the stored communication summary', () => {
    const summary = sourceEmailSummary(email);

    expect(summary).toContain(email.bodyText);
  });

  it('falls back to the uploaded filename when the subject is blank', () => {
    expect(sourceEmailDescription({ ...email, subject: '  ' })).toBe('request.eml');
  });
});
