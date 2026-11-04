// AnthropicProvider: the default provider, on the official SDK. The key comes
// from the host's ANTHROPIC_API_KEY and stays on the server.
import Anthropic from '@anthropic-ai/sdk';
import type { AiMessage, AiProvider } from './provider.js';

/** Every call gives up after this long; the route then answers 502 ai_unavailable. */
export const AI_TIMEOUT_MS = 60_000;

/** The one SDK method we use. Tests inject a fake with this shape, so they never build a real client. */
export interface MessagesClient {
  messages: {
    create(
      params: { model: string; max_tokens: number; system: string; messages: AiMessage[] },
      options?: { timeout?: number },
    ): Promise<{ content: ReadonlyArray<{ type: string; text?: string }> }>;
  };
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Injected in tests; built from apiKey otherwise. */
  client?: MessagesClient;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: MessagesClient;
  private readonly model: string;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.client =
      opts.client ?? (new Anthropic({ apiKey: opts.apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 }) as unknown as MessagesClient);
  }

  async complete(req: { system: string; messages: AiMessage[]; maxTokens: number }): Promise<{ text: string }> {
    const res = await this.client.messages.create(
      { model: this.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages },
      { timeout: AI_TIMEOUT_MS },
    );
    const text = res.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    return { text };
  }
}
