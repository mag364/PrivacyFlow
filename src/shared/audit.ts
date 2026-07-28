// -----------------------------------------------------------------------------
// Tamper-evident audit chain. Each event stores prevHash + hash. hash =
// SHA-256(canonical JSON of the event without its own hash). Any alteration or
// deletion breaks the chain, which verifyChain() detects. Fully unit tested.
// -----------------------------------------------------------------------------

export const GENESIS_HASH = '0'.repeat(64);

// Deterministic, key-sorted serialization so hashes are reproducible.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto).subtle;
  const data = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashEvent(event: Record<string, unknown>): Promise<string> {
  return sha256Hex(stableStringify(event));
}

export async function verifyChain(
  events: Array<Record<string, any>>,
): Promise<{ ok: boolean; brokenAt?: number }> {
  let prev = GENESIS_HASH;
  for (const e of events) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    const { hash, ...rest } = e;
    const recomputed = await hashEvent(rest);
    if (recomputed !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true };
}