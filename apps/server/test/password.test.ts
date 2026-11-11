import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hash, parseOptions } from '@node-rs/argon2';
import {
  E2E_FAST_HASH_OPTIONS,
  NORMAL_HASH_OPTIONS,
  hashPassword,
  passwordHashOptions,
  usingE2eFastHash,
  verifyPassword,
} from '../src/auth/password.js';

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);

describe('password hash settings', () => {
  it('uses the normal argon2id settings when E2E_FAST_PASSWORD_HASH is not set', async () => {
    expect(passwordHashOptions({})).toBe(NORMAL_HASH_OPTIONS);
    // What a real install gets, read back from an actual hash: 19 MiB, t=2, p=1.
    const p = parseOptions(await hash('x', passwordHashOptions({})));
    expect([p.algorithm, p.memoryCost, p.timeCost, p.parallelism]).toEqual([2, 19456, 2, 1]);
  });

  it('keeps the normal settings for any value other than exactly 1', () => {
    for (const v of ['', ' ', '0', 'true', 'yes', 'on', '2']) {
      expect(passwordHashOptions({ E2E_FAST_PASSWORD_HASH: v })).toBe(NORMAL_HASH_OPTIONS);
    }
  });

  it('uses the cheap settings only when E2E_FAST_PASSWORD_HASH=1', () => {
    expect(passwordHashOptions({ E2E_FAST_PASSWORD_HASH: '1' })).toBe(E2E_FAST_HASH_OPTIONS);
  });

  it('is off in the unit test run, so these hashes are the real thing', async () => {
    expect(usingE2eFastHash).toBe(false);
    const stored = await hashPassword('correct horse');
    expect(parseOptions(stored).memoryCost).toBe(19456);
    expect(await verifyPassword(stored, 'correct horse')).toBe(true);
    expect(await verifyPassword(stored, 'wrong')).toBe(false);
  });

  it('still checks a password hashed with the cheap settings (verify reads them from the hash)', async () => {
    const stored = await hash('pw', E2E_FAST_HASH_OPTIONS);
    expect(await verifyPassword(stored, 'pw')).toBe(true);
    expect(await verifyPassword(stored, 'nope')).toBe(false);
  });

  it('is never set by compose, .env.example or the Dockerfile', () => {
    for (const f of ['docker-compose.yml', '.env.example', 'docker/Dockerfile']) {
      expect(readFileSync(repo(f), 'utf8'), f).not.toContain('E2E_FAST_PASSWORD_HASH');
    }
  });
});
