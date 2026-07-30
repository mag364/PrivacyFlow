import type { DsrCase, Project } from '@shared/types';
import type { NewCaseInput, NewProjectInput } from '../platform/types';

export type TableRow = Record<string, string>;

const decoder = new TextDecoder();

function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function pick(row: TableRow, names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const wanted = normKey(name);
    const key = keys.find((k) => normKey(k) === wanted);
    if (key && row[key]) return row[key].trim();
  }
  return '';
}

export function splitMulti(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function excelSerialDate(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 1 || value > 80000) return undefined;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function shortUsDate(value: string): string | undefined {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

export function normalizeImportedDate(value: string): string | undefined {
  const clean = value.trim();
  if (!clean) return undefined;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(clean)) return clean;
  if (/^\d{5}(?:\.0+)?$/.test(clean)) return excelSerialDate(Number(clean));
  const shortDate = shortUsDate(clean);
  if (shortDate) return shortDate;
  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getFullYear();
  if (year < 1900 || year > 2200) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function parseDelimited(text: string): TableRow[] {
  const delimiter = text.includes('\t') && !text.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell.trim());
  rows.push(row);

  const header = rows.shift()?.map((h) => h.trim()) ?? [];
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h || `Column ${i + 1}`, r[i] ?? ''])));
}

function zipEntries(bytes: Uint8Array): Map<string, { method: number; compressed: Uint8Array }> {
  const entries = new Map<string, { method: number; compressed: Uint8Array }>();
  let i = 0;
  const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
  const u32 = (o: number) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  while (i < bytes.length - 30) {
    if (u32(i) !== 0x04034b50) {
      i += 1;
      continue;
    }
    const flags = u16(i + 6);
    const method = u16(i + 8);
    const compressedSize = u32(i + 18);
    const nameLen = u16(i + 26);
    const extraLen = u16(i + 28);
    const name = decoder.decode(bytes.slice(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0) break; // data descriptors are uncommon for workbook exports; fail softly.
    entries.set(name, { method, compressed: bytes.slice(start, start + compressedSize) });
    i = start + compressedSize;
  }
  return entries;
}

async function inflate(entry: { method: number; compressed: Uint8Array }): Promise<string> {
  if (entry.method === 0) return decoder.decode(entry.compressed);
  if (entry.method !== 8 || typeof DecompressionStream === 'undefined') {
    throw new Error('This .xlsx compression format is not supported in this browser.');
  }
  const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return decoder.decode(await new Response(stream).arrayBuffer());
}

function textContent(node: Element | null): string {
  return node?.textContent ?? '';
}

function colIndex(ref: string): number {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export async function parseXlsx(file: File): Promise<TableRow[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(bytes);
  const get = async (name: string) => {
    const entry = entries.get(name);
    if (!entry) return '';
    return inflate(entry);
  };

  const sharedXml = await get('xl/sharedStrings.xml');
  const shared = sharedXml
    ? Array.from(new DOMParser().parseFromString(sharedXml, 'application/xml').querySelectorAll('si'))
        .map((si) => Array.from(si.querySelectorAll('t')).map((t) => t.textContent ?? '').join(''))
    : [];

  let sheetName = 'xl/worksheets/sheet1.xml';
  const workbookXml = await get('xl/workbook.xml');
  const relsXml = await get('xl/_rels/workbook.xml.rels');
  if (workbookXml && relsXml) {
    const workbook = new DOMParser().parseFromString(workbookXml, 'application/xml');
    const rels = new DOMParser().parseFromString(relsXml, 'application/xml');
    const sheets = Array.from(workbook.querySelectorAll('sheet'));
    const preferred = sheets.find((s) => /requests|projects/i.test(s.getAttribute('name') ?? '')) ?? sheets[0];
    const rid = preferred?.getAttribute('r:id');
    const target = rid ? Array.from(rels.querySelectorAll('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : null;
    if (target) sheetName = `xl/${target.replace(/^\/?xl\//, '')}`;
  }

  const sheetXml = await get(sheetName);
  if (!sheetXml) throw new Error('No worksheet was found in this .xlsx file.');
  const sheet = new DOMParser().parseFromString(sheetXml, 'application/xml');
  const rows = Array.from(sheet.querySelectorAll('sheetData row')).map((r) => {
    const cells: string[] = [];
    for (const c of Array.from(r.querySelectorAll('c'))) {
      const idx = colIndex(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      const value =
        type === 's'
          ? shared[Number(textContent(c.querySelector('v')))] ?? ''
          : type === 'inlineStr'
            ? textContent(c.querySelector('is t'))
            : textContent(c.querySelector('v'));
      cells[idx] = value.trim();
    }
    return cells;
  }).filter((r) => r.some(Boolean));

  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h || `Column ${i + 1}`, r[i] ?? ''])));
}

export async function rowsFromFile(file: File): Promise<TableRow[]> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(file);
  return parseDelimited(await file.text());
}

export function privacyFlowPayloadFromJson(text: string): { cases: DsrCase[]; projects: Project[] } {
  const parsed = JSON.parse(text) as { cases?: DsrCase[]; projects?: Project[]; data?: { cases?: DsrCase[]; projects?: Project[] } };
  const source = parsed.data ?? parsed;
  return {
    cases: Array.isArray(source.cases) ? source.cases : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
  };
}

export function caseInputFromRow(row: TableRow, defaults: { jurisdiction: string }): NewCaseInput {
  const requestId = pick(row, ['Request ID', 'RequestId', 'DSR ID', 'Smartsheet ID']);
  const lastName = pick(row, ['Subject', 'Last Name', 'Requester Last Name', 'Name', 'Requester']);
  const email = pick(row, ['Email', 'Requester Email', 'Email Address']);
  const requestTypes = splitMulti(pick(row, ['Types', 'Request Types', 'Type']));
  const emailedFA = normalizeImportedDate(pick(row, ['Emailed FA']));
  const dateClientServiceReceivedEmail = normalizeImportedDate(pick(row, [
    "Client Svcs. rec'd email",
    'Client Svcs. rec’d email',
    'Client Svcs. rec’d email date',
    'Client Svcs. received email',
    'Client Services Received',
    'Date Received',
  ]));
  const dateDppReceivedEmail = normalizeImportedDate(pick(row, [
    "DPP rec'd email from Client Svcs.",
    'DPP rec’d email from Client Svcs.',
    "DPP rec'd email date",
    'DPP rec’d email date',
    'DPP Received',
    'Date DPP Received',
  ]));
  const standardResponseSent = normalizeImportedDate(pick(row, ['Standard Response sent', 'Standard Response Sent']));
  const forwardedEmailToRon = normalizeImportedDate(pick(row, [
    'Forwarded email to Ron K.',
    'Forwarded Email to Ron K.',
    'Forwarded to Ron',
    'Forwarded Email To Ron',
  ]));
  const followUpEmailSent = normalizeImportedDate(pick(row, ['Follow-up sent', 'Follow-up Email Sent']));
  return {
    caseNumberOverride: pick(row, ['Request', 'Case Number', 'CaseNumber']) || undefined,
    requestTypes: requestTypes.length ? requestTypes : ['Access'],
    intakeChannel: pick(row, ['Intake Channel', 'Channel', 'Source']) || 'Email',
    jurisdiction: defaults.jurisdiction || 'Other',
    priority: pick(row, ['Priority']) || 'Medium',
    risk: pick(row, ['Risk', 'Risk Level']) || 'Medium',
    businessUnit: pick(row, ['Business Unit', 'Department']) || undefined,
    description: pick(row, ['Description', 'Request Description', 'Summary', 'Details']) || 'Imported request',
    subject: {
      lastName: lastName || 'Imported',
      emails: email ? [email] : [],
      phones: [],
      addresses: [],
      relationship: pick(row, ['Relationship']) || 'Client',
      minor: /^true|yes|1$/i.test(pick(row, ['Minor'])),
      authorizedAgent: /^true|yes|1$/i.test(pick(row, ['Authorized Agent'])),
      identifiers: requestId ? [{ label: 'Request ID', value: requestId }] : [],
      clientCenterStatus: pick(row, ['Client Center Status']) || undefined,
      emailedFA,
    },
    intakeDates: {
      dateClientServiceReceivedEmail,
      dateDppReceivedEmail,
      standardResponseSent,
      forwardedEmailToRon,
      followUpEmailSent,
    },
  };
}

export function projectInputFromRow(row: TableRow): NewProjectInput {
  const notificationDate = normalizeImportedDate(pick(row, ['Date Notification Rec’d', 'Date Notification Received', 'Date Received']));
  return {
    projectNumber: pick(row, ['Project Number', 'Project']) || undefined,
    projectName: pick(row, ['Project Name', 'Name', 'Parent Project']) || 'Imported project',
    status: pick(row, ['Status']) || 'New',
    source: pick(row, ['Source']) || 'DD',
    dateNotificationReceived: notificationDate,
    notificationCancelled: /^true|yes|1$/i.test(pick(row, ['Notification Cancelled', 'Cancelled'])),
    ritmNumber: pick(row, ['RITM Number', 'RITM']) || undefined,
    investmentClass: pick(row, ['Investment Class']) || 'Not Listed',
    description: pick(row, ['Request Description/Explanation', 'Description', 'Summary']) || 'Imported project',
    fiscalYear: pick(row, ['Fiscal Year', 'FY']) || undefined,
    piaNumber: pick(row, ['PIA Number', 'PIA']) || undefined,
    ssdsTask: pick(row, ['SSDS Task']) || undefined,
    ssdsType: pick(row, ['SSDS Type']) || 'N/A',
    projectUid: pick(row, ['Project UID', 'UID']) || undefined,
    businessUnit: pick(row, ['Business Unit']) || undefined,
    businessSponsors: pick(row, ['Business Sponsors', 'Sponsor']) || undefined,
    demandNumber: pick(row, ['Demand Number']) || undefined,
    assetsMentioned: pick(row, ['Assets Mentioned', 'Assets']) || undefined,
    comments: pick(row, ['Comments', 'Notes']) || undefined,
  };
}
