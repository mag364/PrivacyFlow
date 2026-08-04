import { describe, expect, it } from 'vitest';
import { caseInputFromRow, projectInputFromRow } from './importers';

describe('record link imports', () => {
  it('imports a per-request ServiceNow link', () => {
    const input = caseInputFromRow({
      'Case Number': 'DSRREQ0000123',
      'ServiceNow Link': 'https://example.service-now.com/request/123',
      'Last Name': 'Requester',
      Email: 'requester@example.com',
      Types: 'Access',
      Description: 'Imported request',
    }, { jurisdiction: 'US' });

    expect(input.serviceNowUrl).toBe('https://example.service-now.com/request/123');
  });

  it('imports OneTrust fields and the renamed source heading', () => {
    const input = projectInputFromRow({
      'Project Number': 'PRJ0000123',
      'Project Name': 'Example notification',
      'Source Information': 'Lighthouse',
      'OneTrust Project ID': 'OT-456',
      'OneTrust Link': 'https://example.onetrust.com/project/456',
      Description: 'Imported notification',
    });

    expect(input.source).toBe('Lighthouse');
    expect(input.oneTrustProjectId).toBe('OT-456');
    expect(input.oneTrustUrl).toBe('https://example.onetrust.com/project/456');
  });
});
