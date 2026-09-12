import DOMPurify from 'dompurify';
import { replacePlaceholders } from '@shared/placeholders';

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function plainTextToHtml(text: string): string {
  return `<p>${escapeEmailHtml(text).replace(/\r?\n/g, '<br>')}</p>`;
}

export function sanitizeEmailHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ol', 'ul', 'li', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'width', 'height', 'class', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const element of doc.body.querySelectorAll<HTMLElement>('*')) {
    // Keep email formatting only; prevent pasted CSS from affecting the application.
    const style = element.style;
    const allowed = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'margin-left']);
    for (const property of Array.from(style)) {
      if (!allowed.has(property) || /url\s*\(|expression\s*\(/i.test(style.getPropertyValue(property))) style.removeProperty(property);
    }
    for (const name of Array.from(element.classList)) {
      if (/^ql-align-(center|right|justify)$/.test(name)) style.textAlign = name.slice(9);
      if (/^ql-indent-[1-8]$/.test(name)) style.marginLeft = `${Number(name.slice(-1)) * 24}px`;
    }
    element.removeAttribute('class');
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) element.removeAttribute('href');
    }
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      if (!/^https:\/\//i.test(src) && !/^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(src)) { element.remove(); continue; }
      const width = Number(element.getAttribute('width'));
      element.setAttribute('width', String(width > 0 ? Math.min(width, 1000) : 400));
      style.maxWidth = '100%';
      style.height = 'auto';
    }
  }
  return doc.body.innerHTML;
}

export function emailHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeEmailHtml(html), 'text/html');
  doc.body.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  doc.body.querySelectorAll('img').forEach(el => el.replaceWith(`[${el.getAttribute('alt') || 'Image'}]`));
  doc.body.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href')!;
    if (el.textContent !== href) el.append(` (${href})`);
  });
  doc.body.querySelectorAll('p,div,h1,h2,h3,h4,li,blockquote,tr').forEach(el => el.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderEmailHtml(html: string, values: Record<string, string | undefined>, originalText = ''): string {
  const escaped = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeEmailHtml(value ?? '').replace(/\r?\n/g, '<br>')]));
  const rendered = replacePlaceholders(sanitizeEmailHtml(html), escaped);
  const content = rendered + (originalText ? `<hr>${plainTextToHtml(originalText)}` : '');
  return sanitizeEmailHtml(`<div style="font-family: Arial, sans-serif; font-size: 15px; color: #111827">${content}</div>`);
}
