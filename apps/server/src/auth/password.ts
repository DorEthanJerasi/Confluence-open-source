import { hash, verify, type Options } from '@node-rs/argon2';

// argon2id with the library defaults (19 MiB, t=2, p=1), as OWASP recommends.
// verify() reads the settings from the stored hash itself, so a hash made
// with any settings still checks correctly.
export const NORMAL_HASH_OPTIONS: Options = {};

// Test set-up only. The e2e stack (e2e/global-setup.ts) sets
// E2E_FAST_PASSWORD_HASH=1 on the servers it starts, so its many sign-ups and
// logins cost far less CPU on the busy test box. It is never set in
// docker-compose.yml, .env.example or the Dockerfile; a real install always
// gets the normal settings above (apps/server/test/password.test.ts).
export const E2E_FAST_HASH_OPTIONS: Options = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

export function passwordHashOptions(e: NodeJS.ProcessEnv = process.env): Options {
  return e.E2E_FAST_PASSWORD_HASH?.trim() === '1' ? E2E_FAST_HASH_OPTIONS : NORMAL_HASH_OPTIONS;
}

const options = passwordHashOptions();

/** True when this server was started by the e2e stack with the cheap hash (logged at start). */
export const usingE2eFastHash = options === E2E_FAST_HASH_OPTIONS;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used when the email is unknown, so a failed login costs the same time
// whether or not the account exists.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('stillwater-timing-equaliser');
  await verifyPassword(await dummy, password);
}
