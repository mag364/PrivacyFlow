import type { AutomationRecipient } from './types';

function uniqueAddresses(addresses: string[], to = ''): string[] {
  const seen = new Set([to.trim().toLowerCase()]);
  return addresses.filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseCcAddresses(value = ''): string[] {
  const addresses = value.split(/[;,]/).map(part => part.trim()).filter(Boolean);
  for (const address of addresses) {
    if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(address)) {
      throw new Error(`Invalid Cc email address: ${address}`);
    }
  }
  return uniqueAddresses(addresses);
}

/** Resolve named personal recipients at send time so address changes are respected. */
export function resolveAutomationCc(value: string | undefined, recipients: AutomationRecipient[], to = ''): string {
  const addresses = (value ?? '').split(/[;,]/).map(part => part.trim()).filter(Boolean).flatMap(part => {
    if (part.includes('@')) return parseCcAddresses(part);
    const recipient = recipients.find(r => r.name.trim().toLowerCase() === part.toLowerCase());
    if (!recipient?.enabled || !recipient.email.trim()) {
      throw new Error(`Cc recipient "${part}" needs an enabled email address in Automation > Recipients.`);
    }
    return parseCcAddresses(recipient.email);
  });
  return uniqueAddresses(addresses, to).join('; ');
}
