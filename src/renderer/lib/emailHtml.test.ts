// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emailHtmlToText, plainTextToHtml, renderEmailHtml, sanitizeEmailHtml } from './emailHtml';

describe('rich email HTML', () => {
  it('preserves literal legacy text and line breaks when entering rich editing', () => {
    const html = plainTextToHtml('Hello <team> & friends\n{{requester.lastName}}');
    expect(html).toContain('&lt;team&gt; &amp; friends<br>');
    expect(emailHtmlToText(html)).toBe('Hello <team> & friends\n{{requester.lastName}}');
  });
  it('preserves formatting, links, image data and inline styles', () => {
    const html = sanitizeEmailHtml('<p style="color: red; font-size:18px"><strong>Hello</strong> <a href="https://example.test">link</a></p><img src="data:image/png;base64,aGVsbG8=" width="200">');
    expect(html).toContain('<strong>Hello</strong>');
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('p')!.style.fontSize).toBe('18px');
    expect(html).toContain('data:image/png;base64,aGVsbG8=');
    expect(html).toContain('width="200"');
  });
  it('removes active markup, local files, unsafe URLs and layout CSS', () => {
    const html = sanitizeEmailHtml('<script>alert(1)</script><iframe src="https://example.test"></iframe><p style="position:fixed;background-image:url(https://example.test);color:red" onclick="alert(1)">text</p><a href="javascript:alert(1)">link</a><img src="file:///secret"><img src="data:image/svg+xml;base64,aGVsbG8=">');
    expect(html).not.toMatch(/script|iframe|onclick|javascript:|file:|svg|position|background-image/);
    expect(html).toContain('color: red');
  });
  it('escapes placeholder values and original messages while retaining template formatting', () => {
    const html = renderEmailHtml('<p>Hello <b>{{requester.lastName}}</b></p>', { 'requester.lastName': '<img src=x onerror=alert(1)>' }, 'From: A <a@example.test>\nOriginal <body>');
    expect(html).toContain('<b>&lt;img');
    expect(html).toContain('&lt;a@example.test&gt;');
    expect(html).not.toContain('<img');
    expect(emailHtmlToText(html)).toContain('Original <body>');
  });
  it('keeps links and image descriptions in the plain-text fallback', () => {
    expect(emailHtmlToText('<p><a href="https://example.test">Website</a></p><img src="data:image/png;base64,aGVsbG8=" alt="Logo">'))
      .toContain('Website (https://example.test)\n[Logo]');
  });
});
