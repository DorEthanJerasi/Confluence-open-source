import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (19 MiB, t=2, p=1), as OWASP recommends.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
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
  dummy ??= hash('stillwater-timing-equaliser');
  await verifyPassword(await dummy, password);
}
