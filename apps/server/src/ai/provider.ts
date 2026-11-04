// The AI provider seam (ARCHITECTURE.md §8). Features (summarise, ask) are
// written against AiProvider only, so the host can swap Anthropic for the stub
// (or, later, another provider) without touching them.
import type { AiConfig } from '../env.js';
import { HttpError } from '../http.js';
import { AnthropicProvider } from './anthropic.js';
import { StubProvider } from './stub.js';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  readonly name: string;
  complete(req: { system: string; messages: AiMessage[]; maxTokens: number }): Promise<{ text: string }>;
}

/** The provider for this config, or null when AI is off. */
export function createProvider(ai: AiConfig): AiProvider | null {
  switch (ai.provider) {
    case 'anthropic':
      return ai.apiKey ? new AnthropicProvider({ apiKey: ai.apiKey, model: ai.model }) : null;
    case 'stub':
      return new StubProvider();
    default:
      return null;
  }
}

/** 502 with a calm message. It carries no provider error text, so it can never hold the key. */
export class AiUnavailableError extends HttpError {
  constructor() {
    super(502, 'ai_unavailable', 'The AI helper is not available right now. Please try again in a little while.');
  }
}

/** Every AI route answers this when AI is off, as if the route did not exist. */
export const aiOff = () => new HttpError(404, 'ai_off', 'Not found');

type WarnLog = { warn: (obj: object, msg: string) => void };

/**
 * Wraps a provider so any failure (timeout, bad key, rate limit, network)
 * becomes AiUnavailableError. The log line names only the error type and HTTP
 * status, never the provider's message (which could echo the key).
 */
export function guardProvider(provider: AiProvider, log: WarnLog): AiProvider {
  return {
    name: provider.name,
    async complete(req) {
      try {
        return await provider.complete(req);
      } catch (err) {
        if (err instanceof AiUnavailableError) throw err;
        const e = err as { name?: unknown; status?: unknown };
        log.warn(
          {
            provider: provider.name,
            errorType: typeof e?.name === 'string' ? e.name.slice(0, 60) : 'Error',
            status: typeof e?.status === 'number' ? e.status : undefined,
          },
          'AI provider call failed',
        );
        throw new AiUnavailableError();
      }
    },
  };
}
