import { describe, expect, it } from 'vitest';
import { prepareHtmlEmail } from './emailAttachments';
describe('HTML inline email attachments', () => {
  it('leaves legacy text and hosted image URLs alone', () => {
    expect(prepareHtmlEmail()).toEqual({ images: [] });
    expect(prepareHtmlEmail('<img src="https://example.test/logo.png">').images).toEqual([]);
  });
  it('replaces embedded images with matching content IDs and deduplicates them', () => {
    const result = prepareHtmlEmail('<img src="data:image/png;base64,aGVsbG8="><img src="data:image/png;base64,aGVsbG8=">');
    expect(result.images).toEqual([{ name: 'image-1.png', contentId: 'privacyflow-image-1@inline', contentType: 'image/png', contentBytes: 'aGVsbG8=' }]);
    expect(result.html).toBe('<img src="cid:privacyflow-image-1@inline"><img src="cid:privacyflow-image-1@inline">');
  });
  it('rejects oversized messages before creating attachments', () => {
    expect(() => prepareHtmlEmail('x'.repeat(8 * 1024 * 1024 + 1))).toThrow('8 MB');
    expect(() => prepareHtmlEmail('<img src="data:image/png;base64,' + 'a'.repeat(3 * 1024 * 1024) + '">')).toThrow('2 MB');
  });
});
