// All server configuration comes from the environment (see .env.example).

export interface Config {
  port: number;
  databaseUrl: string;
  publicUrl: string;
  allowSignup: boolean;
  /** Directory of the built web app to serve; empty = do not serve it. */
  webDist: string;
  /** Force the Secure flag on cookies (otherwise decided per request). */
  secureCookies: boolean;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v.trim() === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase());
}

export function loadConfig(e: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = e.PUBLIC_URL?.trim() || `http://localhost:${e.PORT ?? 3000}`;
  return {
    port: Number(e.PORT ?? 3000),
    databaseUrl: e.DATABASE_URL ?? '',
    publicUrl,
    allowSignup: bool(e.ALLOW_SIGNUP, true),
    webDist: e.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
    secureCookies: publicUrl.startsWith('https://'),
  };
}

export const env = loadConfig();

export function requireDatabaseUrl(): string {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return env.databaseUrl;
}
