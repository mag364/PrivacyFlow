// -----------------------------------------------------------------------------
// Minimal, dependency-free XLSX (Office Open XML) writer.
//
// Builds a real .xlsx workbook — a ZIP archive containing XML parts — so Excel,
// Numbers, and Google Sheets open it with no format/extension warnings.
// Files are stored uncompressed (ZIP "stored" method) with correct CRC-32 and
// local/central headers, which is fully spec-compliant.
//
// Supports Excel outline grouping: rows can carry an outlineLevel (1–7) plus a
// hidden flag, producing the collapsible +/- grouped rows in Excel.
// -----------------------------------------------------------------------------

export type XlsxCell = string | number | null | undefined;

// A row is either a plain array of cells, or an object that also carries
// outline-grouping metadata (for collapsible parent/child structures).
export type XlsxRow =
  | XlsxCell[]
  | { cells: XlsxCell[]; outlineLevel?: number; hidden?: boolean };

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
}

// ---- CRC-32 -----------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- ZIP assembly (stored, no compression) ----------------------------------
const encoder = new TextEncoder();

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function buildZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;

  // Fixed DOS date/time (2024-01-01 00:00:00) for deterministic output.
  const dosTime = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), // local file header signature
      ...u16(20), // version needed
      ...u16(0x0800), // flags: UTF-8 names
      ...u16(0), // method: stored
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(entry.data.length), // compressed size
      ...u32(entry.data.length), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
    ]);
    chunks.push(localHeader, nameBytes, entry.data);

    central.push(
      ...u32(0x02014b50), // central directory signature
      ...u16(20), // version made by
      ...u16(20), // version needed
      ...u16(0x0800), // flags
      ...u16(0), // method
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(nameBytes.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), // extra/comment/disk/int attrs
      ...u32(0), // external attrs
      ...u32(offset), // local header offset
      ...Array.from(nameBytes),
    );
    offset += localHeader.length + nameBytes.length + entry.data.length;
  }

  const centralBytes = new Uint8Array(central);
  const end = new Uint8Array([
    ...u32(0x06054b50), // end of central directory
    ...u16(0), ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralBytes.length),
    ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...chunks, centralBytes, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ---- XLSX parts ---------------------------------------------------------------
function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Excel column letter for a 1-based index (1 -> A, 27 -> AA).
function colName(index: number): string {
  let s = '';
  let n = index;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows: XlsxRow[]): string {
  let maxOutline = 0;
  const body = rows
    .map((row, r) => {
      const isMeta = !Array.isArray(row);
      const cells: XlsxCell[] = isMeta ? row.cells : row;
      const outline = isMeta ? Math.min(7, Math.max(0, row.outlineLevel ?? 0)) : 0;
      const hidden = isMeta && !!row.hidden;
      if (outline > maxOutline) maxOutline = outline;

      const rendered = cells
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${colName(c + 1)}${r + 1}`;
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}"><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
        })
        .join('');

      const attrs = [`r="${r + 1}"`];
      if (outline > 0) attrs.push(`outlineLevel="${outline}"`);
      if (hidden) attrs.push('hidden="1"');
      return `<row ${attrs.join(' ')}>${rendered}</row>`;
    })
    .join('');

  // Outline declarations: summaryBelow puts the collapse control on the parent
  // (first) row of each group, matching the app's parent/child layout.
  const outlineBits =
    maxOutline > 0
      ? `<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>` +
        `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxOutline}"/>`
      : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${outlineBits}<sheetData>${body}</sheetData></worksheet>`
  );
}

// Sheet names: max 31 chars, cannot contain : \ / ? * [ ] — sanitize defensively.
function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

export function buildXlsx(sheets: XlsxSheet[]): Blob {
  const names = sheets.map((s, i) => safeSheetName(s.name, `Sheet${i + 1}`));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    names
      .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(s.rows)),
    })),
  ];

  return buildZip(entries);
}

export function downloadXlsx(filename: string, sheets: XlsxSheet[]): void {
  const blob = buildXlsx(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}