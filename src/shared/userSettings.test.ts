import { describe, expect, it } from 'vitest';
import type { M365Integration } from './types';
import { userOwnsM365Connection } from './userSettings';

const connection: M365Integration = {
  connected: true,
  mode: 'outlook',
  accountEmail: 'michael@example.com',
  connectedBy: 'Michael Gutierrez',
};

describe('userOwnsM365Connection', () => {
  it('recognizes the user who connected the integration', () => {
    expect(userOwnsM365Connection(connection, { name: 'Michael Gutierrez' })).toBe(true);
  });

  it('recognizes a matching mailbox when older connection metadata lacks a name', () => {
    expect(userOwnsM365Connection(
      { ...connection, connectedBy: undefined },
      { name: 'Michael', email: 'MICHAEL@example.com' },
    )).toBe(true);
  });

  it('does not transfer one user\'s integration to another user', () => {
    expect(userOwnsM365Connection(
      connection,
      { name: 'Another User', email: 'another@example.com' },
    )).toBe(false);
  });
});
