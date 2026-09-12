export interface InlineEmailImage {
  name: string;
  contentId: string;
  contentType: string;
  contentBytes: string;
}
/** Convert embedded raster images to MIME content IDs for Outlook and Graph. */
export function prepareHtmlEmail(bodyHtml?: string): { html?: string; images: InlineEmailImage[] } {
  if (bodyHtml === undefined) return { images: [] };
  if (bodyHtml.length > 8 * 1024 * 1024) throw new Error('Email HTML and images must be under 8 MB.');
  const images: InlineEmailImage[] = [];
  const known = new Map<string, string>();
  const html = bodyHtml.replace(/\bsrc\s*=\s*(["'])(data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+))\1/gi,
    (_match, quote: string, uri: string, format: string, contentBytes: string) => {
      let contentId = known.get(uri);
      if (!contentId) {
        if (contentBytes.length > 2 * 1024 * 1024 * 4 / 3 + 4) throw new Error('Each embedded image must be under 2 MB.');
        const index = images.length + 1;
        contentId = `privacyflow-image-${index}@inline`;
        images.push({ name: `image-${index}.${format.toLowerCase()}`, contentId, contentType: `image/${format.toLowerCase()}`, contentBytes });
        known.set(uri, contentId);
      }
      return `src=${quote}cid:${contentId}${quote}`;
    });
  return { html, images };
}
