import type { M365Integration, User } from './types';

export function userOwnsM365Connection(
  m365: M365Integration,
  user: Pick<User, 'name' | 'email'>,
): boolean {
  const connectedBy = m365.connectedBy?.trim().toLowerCase();
  const accountEmail = m365.accountEmail?.trim().toLowerCase();
  return (!!connectedBy && connectedBy === user.name.trim().toLowerCase())
    || (!!user.email && !!accountEmail && accountEmail === user.email.trim().toLowerCase());
}
