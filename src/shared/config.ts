// -----------------------------------------------------------------------------
// Application-wide configuration and reference data. Pure data, no side effects,
// safe to import from both the renderer and the Electron main process.
// -----------------------------------------------------------------------------

export const APP_CONFIG = {
  version: '1.1.09',
  productName: 'PrivacyFlow',
  tagline: 'DSR & Data Notification Tracking',
  updates: {
    owner: 'mag364',
    repo: 'PrivacyFlow',
    latestReleaseUrl: 'https://api.github.com/repos/mag364/PrivacyFlow/releases/latest',
    releasesApiUrl: 'https://api.github.com/repos/mag364/PrivacyFlow/releases',
    releasesUrl: 'https://github.com/mag364/PrivacyFlow/releases',
    latestReleasePageUrl: 'https://github.com/mag364/PrivacyFlow/releases/latest',
  },
  disclaimer:
    'PrivacyFlow is a workflow and record-keeping tool for privacy operations. All demonstration data is fictional.',
  defaults: {
    organizationName: 'Raymond James Financial',
    caseNumberPrefix: 'PH-',
    dsrreqNumberPrefix: 'DSRREQ',
    caseNumberSequenceLength: 7,
    defaultJurisdiction: 'US',
    autoLockMinutes: 15,
    retentionYears: 5,
    autoRetentionCleanup: false,
  },
  slaRules: [
    { jurisdiction: 'GDPR (EU/EEA)', periodDays: 30, businessDays: false, note: 'One month, extendable by two further months for complex requests.' },
    { jurisdiction: 'UK GDPR', periodDays: 30, businessDays: false, note: 'One calendar month from receipt.' },
    { jurisdiction: 'CCPA/CPRA (California)', periodDays: 45, businessDays: false, note: '45 calendar days, extendable by a further 45 days.' },
    { jurisdiction: 'LGPD (Brazil)', periodDays: 15, businessDays: false, note: 'Simplified access within 15 days.' },
    { jurisdiction: 'PIPEDA (Canada)', periodDays: 30, businessDays: false, note: '30 days from receipt.' },
    { jurisdiction: 'US', periodDays: 45, businessDays: false, note: 'Organization default for US requests.' },
    { jurisdiction: 'Other', periodDays: 30, businessDays: false, note: 'Organization default.' },
  ],
  reminderCadenceDays: [14, 7, 3, 1],
  systemsOfRecord: [
    { name: 'Customer CRM', category: 'Sales & Support', owner: 'Customer Support', avgResponseDays: 3 },
    { name: 'Marketing Automation', category: 'Marketing', owner: 'Marketing', avgResponseDays: 2 },
    { name: 'HR Information System', category: 'People', owner: 'HR', avgResponseDays: 4 },
    { name: 'Billing & Payments', category: 'Finance', owner: 'Finance', avgResponseDays: 5 },
    { name: 'Product Analytics', category: 'Engineering', owner: 'Engineering', avgResponseDays: 3 },
    { name: 'Data Warehouse', category: 'Engineering', owner: 'Engineering', avgResponseDays: 6 },
    { name: 'Email & Collaboration', category: 'IT', owner: 'IT', avgResponseDays: 2 },
    { name: 'Backup & Archive', category: 'IT', owner: 'IT', avgResponseDays: 7 },
  ],
} as const;
