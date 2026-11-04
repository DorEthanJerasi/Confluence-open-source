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
  /** Largest accepted upload, in bytes (MAX_UPLOAD_MB, default 25). */
  maxUploadBytes: number;
  /** Where uploaded files are kept on disk (the compose uploads volume). */
  uploadDir: string;
  /** AI features (ARCHITECTURE.md §8). provider 'off' hides every AI control. */
  ai: AiConfig;
}

export type AiProviderName = 'anthropic' | 'stub' | 'off';

export interface AiConfig {
  provider: AiProviderName;
  /** Server-only secret. Never put it in a response, a header or a log line. */
  apiKey: string;
  model: string;
}

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v.trim() === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase());
}

function positive(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The AI switch (docs/done-checks/04-ai.md, Decisions). AI_PROVIDER unset or
 * empty: anthropic when a key is set, otherwise off. anthropic without a key,
 * or any unknown value, is off (aiSetupNote explains why in the log).
 */
export function loadAiConfig(e: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = e.ANTHROPIC_API_KEY?.trim() ?? '';
  const wanted = e.AI_PROVIDER?.trim().toLowerCase() ?? '';
  let provider: AiProviderName = 'off';
  if (wanted === '') provider = apiKey ? 'anthropic' : 'off';
  else if (wanted === 'anthropic') provider = apiKey ? 'anthropic' : 'off';
  else if (wanted === 'stub') provider = 'stub';
  return { provider, apiKey, model: e.AI_MODEL?.trim() || DEFAULT_AI_MODEL };
}

/** One plain line for the start-up log when the AI setting was not usable. Never holds the key. */
export function aiSetupNote(e: NodeJS.ProcessEnv = process.env): string | null {
  const wanted = e.AI_PROVIDER?.trim().toLowerCase() ?? '';
  if (wanted === 'anthropic' && !e.ANTHROPIC_API_KEY?.trim()) {
    return 'AI is off: AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is empty.';
  }
  if (wanted !== '' && !['anthropic', 'stub', 'off'].includes(wanted)) {
    return 'AI is off: AI_PROVIDER must be anthropic, stub or off.';
  }
  return null;
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
    maxUploadBytes: Math.round(positive(e.MAX_UPLOAD_MB, 25) * 1024 * 1024),
    uploadDir: e.UPLOAD_DIR?.trim() || '/data/uploads',
    ai: loadAiConfig(e),
  };
}

export const env = loadConfig();

export function requireDatabaseUrl(): string {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return env.databaseUrl;
}
