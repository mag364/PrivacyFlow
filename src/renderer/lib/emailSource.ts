import type { SourceEmail } from '@shared/types';

function unfoldHeaders(headerText: string): string[] {
  return headerText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
}

function headerValue(headers: string[], name: string): string {
  const prefix = `${name.toLowerCase()}:`;
  const line = headers.find((h) => h.toLowerCase().startsWith(prefix));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_m, charset, encoding, encoded) => {
    try {
      if (!/^utf-?8$/i.test(charset)) return encoded;
      if (String(encoding).toUpperCase() === 'B') {
        return decodeURIComponent(
          Array.from(atob(encoded.replace(/\s/g, '')), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
        );
      }
      return decodeURIComponent(encoded.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, '%$1'));
    } catch {
      return encoded;
    }
  });
}

function parseAddress(value: string): { name?: string; email?: string } {
  const decoded = decodeMimeWords(value).trim();
  const match = decoded.match(/^(.*?)<([^>]+)>/);
  if (match) {
    return {
      name: match[1].replace(/^"|"$/g, '').trim() || undefined,
      email: match[2].trim(),
    };
  }
  const email = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return { name: decoded.replace(email ?? '', '').replace(/^"|"$/g, '').trim() || undefined, email };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeQuotedPrintable(value: string): string {
  try {
    return decodeURIComponent(value.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, '%$1'));
  } catch {
    return value.replace(/=\r?\n/g, '');
  }
}

function decodePart(body: string, headers: string[]): string {
  const transfer = headerValue(headers, 'Content-Transfer-Encoding').toLowerCase();
  if (transfer.includes('base64')) {
    try {
      return atob(body.replace(/\s/g, ''));
    } catch {
      return body;
    }
  }
  if (transfer.includes('quoted-printable')) return decodeQuotedPrintable(body);
  return body;
}

function extractBody(rawBody: string, headers: string[]): string {
  const contentType = headerValue(headers, 'Content-Type');
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    const parts = rawBody.split(`--${boundary}`).filter((part) => part.trim() && !part.includes(`--${boundary}--`));
    const parsed = parts.map((part) => {
      const [partHeaderText, ...bodyParts] = part.replace(/^\r?\n/, '').split(/\r?\n\r?\n/);
      const partHeaders = unfoldHeaders(partHeaderText);
      const partType = headerValue(partHeaders, 'Content-Type').toLowerCase();
      return { headers: partHeaders, type: partType, body: bodyParts.join('\n\n') };
    });
    const textPart = parsed.find((part) => part.type.includes('text/plain'));
    if (textPart) return decodePart(textPart.body, textPart.headers).trim();
    const htmlPart = parsed.find((part) => part.type.includes('text/html'));
    if (htmlPart) return htmlToText(decodePart(htmlPart.body, htmlPart.headers));
  }

  const decoded = decodePart(rawBody, headers);
  return contentType.toLowerCase().includes('text/html') ? htmlToText(decoded) : decoded.trim();
}

function firstSmtpAddress(value?: string): string | undefined {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

async function sourceEmailFromMsgFile(file: File): Promise<SourceEmail> {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const msg = new MsgReader(await file.arrayBuffer());
  const parsed = msg.getFileData();
  if (parsed.error) throw new Error(parsed.error);

  const headerLines = parsed.headers ? unfoldHeaders(parsed.headers) : [];
  const fromHeader = parseAddress(headerValue(headerLines, 'From'));
  const senderName = parsed.senderName || fromHeader.name;
  const senderEmail = firstSmtpAddress(parsed.senderEmail) ?? fromHeader.email;
  const to = headerValue(headerLines, 'To')
    || (parsed.recipients ?? [])
      .map((recipient) => recipient.email || recipient.name)
      .filter(Boolean)
      .join('; ');
  const subject = parsed.subject || decodeMimeWords(headerValue(headerLines, 'Subject')) || file.name;
  const date = headerValue(headerLines, 'Date')
    || parsed.clientSubmitTime
    || parsed.messageDeliveryTime
    || parsed.creationTime
    || undefined;

  return {
    filename: file.name,
    fromName: senderName || undefined,
    fromEmail: senderEmail,
    to: decodeMimeWords(to),
    subject,
    date,
    bodyText: (parsed.body || '').trim(),
    rawSizeBytes: file.size,
  };
}

async function sourceEmailFromEmlFile(file: File): Promise<SourceEmail> {
  const raw = await file.text();
  const [headerText, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const headers = unfoldHeaders(headerText);
  const from = parseAddress(headerValue(headers, 'From'));
  const subject = decodeMimeWords(headerValue(headers, 'Subject')) || file.name;
  return {
    filename: file.name,
    fromName: from.name,
    fromEmail: from.email,
    to: decodeMimeWords(headerValue(headers, 'To')),
    subject,
    date: headerValue(headers, 'Date') || undefined,
    bodyText: extractBody(bodyParts.join('\n\n'), headers),
    rawSizeBytes: file.size,
  };
}

export function isSupportedSourceEmailFile(file: File): boolean {
  return /\.(eml|msg)$/i.test(file.name);
}

export async function sourceEmailFromFile(file: File): Promise<SourceEmail> {
  if (/\.msg$/i.test(file.name)) return sourceEmailFromMsgFile(file);
  if (/\.eml$/i.test(file.name)) return sourceEmailFromEmlFile(file);
  throw new Error('Upload an Outlook .msg file or an .eml email file.');
}

export function sourceEmailSummary(email: SourceEmail): string {
  const lines = [
    `Uploaded source email: ${email.filename}`,
    email.fromEmail ? `From: ${email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}` : '',
    email.to ? `To: ${email.to}` : '',
    email.date ? `Date: ${email.date}` : '',
    '',
    email.bodyText,
  ].filter((line) => line !== '');
  return lines.join('\n');
}
