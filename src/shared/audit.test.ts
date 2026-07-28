import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvent, verifyChain } from './audit';

async function buildChain() {
  const events: any[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= 4; seq++) {
    const base = { id: `e${seq}`, seq, summary: `event ${seq}`, prevHash };
    const hash = await hashEvent(base);
    events.push({ ...base, hash });
    prevHash = hash;
  }
  return events;
}

describe('audit hash chain', () => {
  it('produces deterministic hashes regardless of key order', async () => {
    const a = await hashEvent({ seq: 1, summary: 'x', prevHash: GENESIS_HASH });
    const b = await hashEvent({ prevHash: GENESIS_HASH, summary: 'x', seq: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('verifies an intact chain', async () => {
    const events = await buildChain();
    const result = await verifyChain(events);
    expect(result.ok).toBe(true);
  });

  it('detects tampering with an event payload', async () => {
    const events = await buildChain();
    events[1] = { ...events[1], summary: 'TAMPERED' };
    const result = await verifyChain(events);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects a deleted event (broken link)', async () => {
    const events = await buildChain();
    events.splice(1, 1); // remove seq 2
    const result = await verifyChain(events);
    expect(result.ok).toBe(false);
  });
});