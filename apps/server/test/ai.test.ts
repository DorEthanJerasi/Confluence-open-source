// Stage 4a: the AI provider switch (docs/done-checks/04-ai.md, 4a).
// Runs under `npm run test:ai`. Nothing here reaches the network: fetch is
// replaced by a trap, and Anthropic is only ever driven through a fake client.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { aiStatusReply } from '@stillwater/shared';
import { aiSetupNote, DEFAULT_AI_MODEL, loadAiConfig, loadConfig } from '../src/env.js';
import { AiUnavailableError, createProvider, guardProvider, type AiProvider } from '../src/ai/provider.js';
import { AI_TIMEOUT_MS, AnthropicProvider, type MessagesClient } from '../src/ai/anthropic.js';
import { STUB_NOTHING_FOUND, StubProvider } from '../src/ai/stub.js';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

const SECRET = 'sk-test-DO-NOT-LEAK';

// ---------- No network ----------

const realFetch = globalThis.fetch;
const fetchCalls: string[] = [];
beforeAll(() => {
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error('ai.test.ts: network is not allowed in tests');
  }) as typeof fetch;
});
afterEach(() => {
  expect(fetchCalls, 'a test called fetch').toEqual([]);
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------- The switch ----------

describe('AI switch (AI_PROVIDER x ANTHROPIC_API_KEY)', () => {
  const table: [provider: string | undefined, key: string, expected: 'anthropic' | 'stub' | 'off'][] = [
    [undefined, 'sk-x', 'anthropic'],
    [undefined, '', 'off'],
    ['', 'sk-x', 'anthropic'],
    ['', '', 'off'],
    ['anthropic', 'sk-x', 'anthropic'],
    ['anthropic', '', 'off'],
    ['stub', 'sk-x', 'stub'],
    ['stub', '', 'stub'],
    ['off', 'sk-x', 'off'],
    ['off', '', 'off'],
    ['nonsense', 'sk-x', 'off'],
    ['nonsense', '', 'off'],
  ];

  it.each(table)('AI_PROVIDER=%j with key %j -> %s', (provider, key, expected) => {
    const env: Record<string, string> = { ANTHROPIC_API_KEY: key };
    if (provider !== undefined) env.AI_PROVIDER = provider;
    const ai = loadAiConfig(env);
    expect(ai.provider).toBe(expected);
    expect(loadConfig(env).ai).toEqual(ai);
    const made = createProvider(ai);
    expect(made?.name ?? 'off').toBe(expected);
  });

  it('treats a key of only spaces as no key, and reads values loosely', () => {
    expect(loadAiConfig({ ANTHROPIC_API_KEY: '   ' }).provider).toBe('off');
    expect(loadAiConfig({ AI_PROVIDER: ' Stub ' }).provider).toBe('stub');
  });

  it('defaults the model and lets the host pick another', () => {
    expect(DEFAULT_AI_MODEL).toBe('claude-opus-5-5');
    expect(loadAiConfig({}).model).toBe('claude-opus-5-5');
    expect(loadAiConfig({ AI_MODEL: '' }).model).toBe('claude-opus-5-5');
    expect(loadAiConfig({ AI_MODEL: 'claude-haiku-5-5' }).model).toBe('claude-haiku-5-5');
  });

  it('writes one plain start-up line when the setting is not usable, never with the key', () => {
    expect(aiSetupNote({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' })).toMatch(/AI is off/);
    expect(aiSetupNote({ AI_PROVIDER: SECRET, ANTHROPIC_API_KEY: SECRET })).toMatch(/AI is off/);
    expect(aiSetupNote({ AI_PROVIDER: SECRET, ANTHROPIC_API_KEY: SECRET })).not.toContain(SECRET);
    expect(aiSetupNote({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: SECRET })).toBeNull();
    expect(aiSetupNote({ AI_PROVIDER: 'stub' })).toBeNull();
    expect(aiSetupNote({ AI_PROVIDER: 'off' })).toBeNull();
    expect(aiSetupNote({})).toBeNull();
  });
});

// ---------- Status route and key safety ----------

describe('GET /api/ai/status', () => {
  let ctx: TestCtx | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  async function signedIn(env: Record<string, string>, aiProvider?: AiProvider | null) {
    ctx = await setupApp(env, aiProvider === undefined ? {} : { aiProvider });
    await ctx.reset();
    return (await signup(ctx.app, 'Ada')).client;
  }

  it('is { enabled: true } with the stub', async () => {
    const c = await signedIn({ AI_PROVIDER: 'stub' });
    const res = await c.get('/api/ai/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
    expect(aiStatusReply.safeParse(res.body).success).toBe(true);
  });

  it('is { enabled: false } when off, including anthropic with no key', async () => {
    const envs: Record<string, string>[] = [{ AI_PROVIDER: 'off' }, { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' }, {}];
    for (const env of envs) {
      const c = await signedIn(env);
      expect((await c.get('/api/ai/status')).body).toEqual({ enabled: false });
      await ctx!.close();
      ctx = undefined;
    }
  });

  it('follows an injected provider over the config', async () => {
    const c = await signedIn({ AI_PROVIDER: 'stub' }, null);
    expect((await c.get('/api/ai/status')).body).toEqual({ enabled: false });
  });

  it('answers 401 when signed out', async () => {
    ctx = await setupApp({ AI_PROVIDER: 'stub' });
    const res = await new Client(ctx.app).get('/api/ai/status');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('enabled');
  });

  it('never shows the key, the provider or the model, even with a real key configured', async () => {
    const c = await signedIn({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: SECRET, AI_MODEL: 'claude-opus-5-5' });
    const res = await c.get('/api/ai/status');
    expect(res.body).toEqual({ enabled: true });
    const all = res.raw.payload + JSON.stringify(res.raw.headers);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('anthropic');
    expect(all).not.toContain('claude');
  });

  it('turns a provider failure into 502 ai_unavailable without the error text or the key', async () => {
    const failing: AiProvider = {
      name: 'fake',
      async complete() {
        const err = new Error(`401 invalid x-api-key: ${SECRET}`) as Error & { status: number };
        err.status = 401;
        throw err;
      },
    };
    ctx = await setupApp({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: SECRET }, { aiProvider: failing });
    // A probe route standing in for 4b/4c's AI routes, which all call app.ai.
    ctx.app.get('/api/ai/probe', async () => ctx!.app.ai!.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }));
    const res = await new Client(ctx.app).get('/api/ai/probe');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'ai_unavailable', message: new AiUnavailableError().message });
    const all = res.raw.payload + JSON.stringify(res.raw.headers);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('invalid x-api-key');
  });
});

describe('guardProvider', () => {
  it('logs only the error type and status, never the message or the key', async () => {
    const lines: string[] = [];
    const log = { warn: (obj: object, msg: string) => lines.push(JSON.stringify(obj) + ' ' + msg) };
    const guarded = guardProvider(
      {
        name: 'anthropic',
        async complete() {
          throw Object.assign(new Error(`rate limited for key ${SECRET}`), { name: 'RateLimitError', status: 429 });
        },
      },
      log,
    );
    await expect(guarded.complete({ system: '', messages: [], maxTokens: 1 })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('RateLimitError');
    expect(lines[0]).toContain('429');
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).not.toContain('rate limited');
  });

  it('passes a good answer through unchanged', async () => {
    const guarded = guardProvider(new StubProvider(), { warn: () => {} });
    expect(guarded.name).toBe('stub');
    expect(await guarded.complete({ system: '', messages: [{ role: 'user', content: 'One. Two. Three.' }], maxTokens: 50 })).toEqual({
      text: 'One. Two.',
    });
  });
});

// ---------- AnthropicProvider with a fake client ----------

describe('AnthropicProvider', () => {
  it('sends the configured model, max_tokens, system and messages, and joins the text blocks', async () => {
    const calls: { params: unknown; options: unknown }[] = [];
    const client: MessagesClient = {
      messages: {
        async create(params, options) {
          calls.push({ params, options });
          return {
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'thinking' },
              { type: 'text', text: 'there [1].' },
            ],
          };
        },
      },
    };
    const p = new AnthropicProvider({ apiKey: SECRET, model: 'claude-sonnet-5-5', client });
    expect(p.name).toBe('anthropic');
    const messages = [{ role: 'user' as const, content: 'Summarise this.' }];
    const out = await p.complete({ system: 'Be brief.', messages, maxTokens: 400 });
    expect(out).toEqual({ text: 'Hello there [1].' });
    expect(calls).toEqual([
      {
        params: { model: 'claude-sonnet-5-5', max_tokens: 400, system: 'Be brief.', messages },
        options: { timeout: AI_TIMEOUT_MS },
      },
    ]);
    expect(AI_TIMEOUT_MS).toBe(60_000);
  });

  it('builds a real SDK client from the key without calling anything', () => {
    const p = createProvider(loadAiConfig({ ANTHROPIC_API_KEY: SECRET }));
    expect(p).toBeInstanceOf(AnthropicProvider);
  });
});

// ---------- Stub ----------

describe('StubProvider', () => {
  const stub = new StubProvider();
  const ask = (sources: string) => ({
    system: 'Answer only from the sources.',
    messages: [{ role: 'user' as const, content: `<question>How do I deploy?</question>\n${sources}` }],
    maxTokens: 600,
  });

  it('summarises with the first two sentences of the page text', async () => {
    const req = {
      system: 'Summarise.',
      messages: [{ role: 'user' as const, content: '<page title="Runbook">Deploys run at noon.  Ask Bea first!\nRoll back with care? Yes.</page>' }],
      maxTokens: 400,
    };
    expect(await stub.complete(req)).toEqual({ text: 'Deploys run at noon. Ask Bea first!' });
  });

  it('answers by quoting the first sentence of source 1 and citing it', async () => {
    const out = await stub.complete(
      ask('<source n="1" title="Deploys">Run make deploy from main. Then watch the logs.</source>\n<source n="2" title="Other">Nope.</source>'),
    );
    expect(out).toEqual({ text: '"Run make deploy from main." [1]' });
  });

  it('says it found nothing when there are no sources', async () => {
    expect(await stub.complete(ask(''))).toEqual({ text: STUB_NOTHING_FOUND });
  });

  it('gives the same output twice for the same input', async () => {
    const req = ask('<source n="1" title="A">Same every time. Really.</source>');
    expect(await stub.complete(req)).toEqual(await stub.complete(req));
    const sum = { system: '', messages: [{ role: 'user' as const, content: '<page>A. B. C.</page>' }], maxTokens: 10 };
    expect(await stub.complete(sum)).toEqual(await stub.complete(sum));
  });
});
