import { describe, expect, it } from 'vitest';
import { appendProjectComment } from './projectComments';

describe('data notification comments', () => {
  it('creates the first attributed comment', () => {
    expect(appendProjectComment(undefined, 'Reviewed.', 'Alex', '4 Aug 2026, 17:30')).toBe(
      '[4 Aug 2026, 17:30] Alex\nReviewed.',
    );
  });

  it('appends without replacing existing comments', () => {
    expect(appendProjectComment('Original note', 'Follow-up note', 'Alex', '4 Aug 2026, 17:31')).toBe(
      'Original note\n\n[4 Aug 2026, 17:31] Alex\nFollow-up note',
    );
  });
});
