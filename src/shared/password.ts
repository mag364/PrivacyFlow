// -----------------------------------------------------------------------------
// Password utilities. SHA-256 hashing (salted per-user) consistent with the
// audit-chain crypto, plus a readable temporary-password generator.
// -----------------------------------------------------------------------------

export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto).subtle;
  const data = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPassword(username: string, password: string): Promise<string> {
  return sha256Hex(`privacyflow:${username.toLowerCase()}:${password}`);
}

const WORDS = [
  'ember', 'harbor', 'willow', 'falcon', 'marble', 'cinder', 'atlas', 'birch',
  'comet', 'delta', 'fjord', 'garnet', 'helix', 'iris', 'juniper', 'kestrel',
  'lumen', 'moss', 'north', 'onyx', 'prairie', 'quartz', 'rowan', 'summit',
  'tundra', 'umbra', 'violet', 'wren', 'yarrow', 'zephyr',
];

// Human-readable temporary password, e.g. "falcon-4821-quartz".
export function generateTempPassword(): string {
  const rand = (n: number) => Math.floor(Math.random() * n);
  const word = () => WORDS[rand(WORDS.length)];
  return `${word()}-${String(1000 + rand(9000))}-${word()}`;
}

export const PASSWORD_MIN_LENGTH = 8;