// Stage 2b link previews (docs/done-checks/02-editor.md): the SSRF guard, the
// fetch limits and GET /api/link-preview. Every fetch goes to a local stub
// server started by this file — no test touches the internet.
//
// Test hostnames such as `site.test` "resolve" (through the injected resolver)
// to a public-looking address, which the real guard judges; only after it
// passes is the socket pointed at the stub on 127.0.0.1.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { isBlockedAddress } from '../src/embeds/addressGuard.js';
import { safeFetchPage, FetchRefused, LIMITS, type ResolvedAddress, type SafeFetchOptions } from '../src/embeds/safeFetch.js';
import { fetchLinkPreview, getLinkPreview, normalizePreviewUrl } from '../src/embeds/linkPreviews.js';
import { parseOpenGraph } from '../src/embeds/openGraph.js';
import { createDb } from '../src/db/client.js';
import { linkPreviews } from '../src/db/schema.js';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

// ---------- the local stub server ----------

const OG_PAGE = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Fallback title</title>
<meta property="og:title" content="Quiet Gardens &amp; Ponds">
<meta property="og:description" content='A calm guide to &quot;still water&quot;.'>
<meta property="og:site_name" content="Garden Notes">
<meta property="og:image" content="/img/pond.png">
</head><body><p>Hello</p></body></html>`;

let stub: Server;
let port = 0;
const hits: string[] = [];

function stubHandler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const path = req.url ?? '/';
  hits.push(path);
  const redirect = (to: string) => {
    res.writeHead(302, { location: to });
    res.end();
  };
  const chain = /^\/chain\/(\d+)$/.exec(path);
  if (chain) {
    const n = Number(chain[1]);
    return redirect(n === 0 ? '/og' : `/chain/${n - 1}`);
  }
  switch (path) {
    case '/og':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(OG_PAGE);
    case '/title-only':
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><head><title> Just a title </title><meta name="description" content="Plain page"></head></html>');
    case '/image':
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(Buffer.alloc(100));
    case '/missing':
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<title>Not here</title>');
    case '/redirect-ok':
      return redirect('/og');
    case '/redirect-loopback':
      return redirect(`http://127.0.0.1:${port}/og`);
    case '/redirect-private-name':
      return redirect(`http://intranet.test:${port}/og`);
    case '/redirect-metadata':
      return redirect('http://169.254.169.254/latest/meta-data/');
    case '/redirect-ftp':
      return redirect('ftp://site.test/file');
    case '/slow-headers':
      return; // never answers
    case '/slow-body':
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html><head><title>Slow');
      return; // never finishes
    case '/huge': {
      // og:title first, then 2 MB of padding, then og:description that lies past the 1 MB cap.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html><head><meta property="og:title" content="Big page">');
      const pad = `<!-- ${'x'.repeat(64 * 1024)} -->`;
      let sent = 0;
      const pump = () => {
        while (sent < 2 * 1024 * 1024) {
          sent += pad.length;
          if (!res.write(pad)) return res.once('drain', pump);
        }
        res.end('<meta property="og:description" content="Past the cap"></head></html>');
      };
      res.on('error', () => {});
      return pump();
    }
    default:
      res.writeHead(404);
      return res.end();
  }
}

// ---------- the test resolver ----------

const PUBLIC_IP = '93.184.215.14';
const NAMES: Record<string, ResolvedAddress[]> = {
  'site.test': [{ address: PUBLIC_IP, family: 4 }],
  'site6.test': [{ address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 }],
  'intranet.test': [{ address: '10.1.2.3', family: 4 }],
  'home.test': [{ address: '192.168.1.20', family: 4 }],
  'metadata.test': [{ address: '169.254.169.254', family: 4 }],
  'loop6.test': [{ address: '::1', family: 6 }],
  'ula.test': [{ address: 'fd00:ec2::254', family: 6 }],
  'mapped.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
  // One good answer and one bad one: refused, because a later connect could use either.
  'mixed.test': [
    { address: PUBLIC_IP, family: 4 },
    { address: '172.16.5.5', family: 4 },
  ],
};

const resolvedNames: string[] = [];
const testFetch: SafeFetchOptions = {
  resolve: async (hostname) => {
    resolvedNames.push(hostname);
    const known = NAMES[hostname];
    if (!known) throw new Error(`test resolver: unknown host ${hostname}`);
    return known;
  },
  // The address passed the guard; now actually connect to the stub.
  dial: () => ({ address: '127.0.0.1', family: 4 }),
};

const at = (host: string, path: string) => `http://${host}:${port}${path}`;

beforeAll(async () => {
  stub = createServer(stubHandler);
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  port = (stub.address() as AddressInfo).port;
});
afterAll(async () => {
  stub.closeAllConnections();
  await new Promise((r) => stub.close(r));
});

async function refusedReason(url: string, opts: SafeFetchOptions = testFetch): Promise<string> {
  try {
    await safeFetchPage(url, opts);
  } catch (err) {
    if (err instanceof FetchRefused) return err.message;
    throw new Error(`expected a refusal, got: ${(err as Error).message}`);
  }
  throw new Error(`expected a refusal, but ${url} was fetched`);
}

// ---------- the address guard ----------

describe('address guard', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.169.254',
    '169.254.1.1',
    '100.64.0.1',
    '100.100.100.200',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:7f00:1::',
    '2002:c0a8:101::1',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'fe80::1%eth0',
    'febf:ffff::1',
    'ff02::1',
    'not-an-ip',
    '',
  ])('refuses %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '93.184.215.14',
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '2002:808:808::1',
  ])('allows the public address %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

// ---------- the guarded fetch ----------

describe('guarded fetch', () => {
  it('has the agreed limits: 5 s, 1 MB, 3 redirects', () => {
    expect(LIMITS).toEqual({ timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 3 });
  });

  it('fetches a public page and reads its Open Graph card', async () => {
    const { preview, outcome } = await fetchLinkPreview(at('site.test', '/og'), testFetch);
    expect(outcome).toBe('fetched');
    expect(preview).toEqual({
      url: at('site.test', '/og'),
      title: 'Quiet Gardens & Ponds',
      description: 'A calm guide to "still water".',
      siteName: 'Garden Notes',
      imageUrl: at('site.test', '/img/pond.png'),
    });
  });

  it('works for a host that resolves to a public IPv6 address', async () => {
    const page = await safeFetchPage(at('site6.test', '/og'), testFetch);
    expect(page.html).toContain('og:title');
  });

  it.each([
    ['127.0.0.1', `http://127.0.0.1:PORT/og`],
    ['10.x', 'http://10.0.0.1/'],
    ['192.168.x', 'http://192.168.1.1/'],
    ['metadata 169.254.169.254', 'http://169.254.169.254/latest/meta-data/'],
    ['[::1]', `http://[::1]:PORT/og`],
    ['IPv4-mapped IPv6 loopback', `http://[::ffff:127.0.0.1]:PORT/og`],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['127.0.0.1 written as a number', `http://2130706433:PORT/og`],
    ['127.0.0.1 written in hex', `http://0x7f.0.0.1:PORT/og`],
  ])('refuses an IP literal: %s', async (_name, url) => {
    const before = hits.length;
    expect(await refusedReason(url.replace('PORT', String(port)))).toMatch(/blocked address/);
    expect(hits.length).toBe(before); // nothing ever reached the stub
  });

  it.each(['intranet.test', 'home.test', 'metadata.test', 'loop6.test', 'ula.test', 'mapped.test', 'mixed.test'])(
    'refuses %s, a hostname that resolves to a private address',
    async (host) => {
      const before = hits.length;
      expect(await refusedReason(at(host, '/og'))).toMatch(/resolves to a blocked address/);
      expect(hits.length).toBe(before);
    },
  );

  it('refuses localhost through the real system resolver (no test resolver)', async () => {
    const before = hits.length;
    expect(await refusedReason(`http://localhost:${port}/og`, {})).toMatch(/blocked address/);
    expect(hits.length).toBe(before);
  });

  it('follows a redirect to a public page and checks the new host again', async () => {
    resolvedNames.length = 0;
    const page = await safeFetchPage(at('site.test', '/redirect-ok'), testFetch);
    expect(page.url).toBe(at('site.test', '/og'));
    expect(resolvedNames).toEqual(['site.test', 'site.test']); // looked up on each hop
  });

  it.each([
    ['a loopback IP', '/redirect-loopback', /blocked address/],
    ['a hostname that resolves to a private address', '/redirect-private-name', /resolves to a blocked address/],
    ['the metadata address', '/redirect-metadata', /blocked address/],
    ['a non-web scheme', '/redirect-ftp', /Only http and https/],
  ])('refuses a redirect to %s', async (_name, path, reason) => {
    const before = hits.length;
    expect(await refusedReason(at('site.test', path))).toMatch(reason);
    expect(hits.slice(before)).toEqual([path]); // the target page was never requested
  });

  it('follows at most 3 redirects', async () => {
    const ok = await safeFetchPage(at('site.test', '/chain/2'), testFetch); // 3 redirects
    expect(ok.url).toBe(at('site.test', '/og'));
    expect(await refusedReason(at('site.test', '/chain/3'))).toMatch(/More than 3 redirects/); // 4 redirects
  });

  it('stops reading at the size cap', async () => {
    const page = await safeFetchPage(at('site.test', '/huge'), testFetch);
    expect(Buffer.byteLength(page.html!)).toBeLessThanOrEqual(LIMITS.maxBytes);
    expect(Buffer.byteLength(page.html!)).toBeGreaterThan(LIMITS.maxBytes - 1024);
    const card = parseOpenGraph(page.html!, page.url);
    expect(card.title).toBe('Big page');
    expect(card.description).toBeNull(); // it was past the cap
  });

  it('gives up when the headers do not come in time', async () => {
    const start = Date.now();
    await expect(safeFetchPage(at('site.test', '/slow-headers'), { ...testFetch, timeoutMs: 300 })).rejects.toThrow(
      /Timed out|abort/i,
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('gives up when the body does not finish in time', async () => {
    const start = Date.now();
    await expect(safeFetchPage(at('site.test', '/slow-body'), { ...testFetch, timeoutMs: 300 })).rejects.toThrow(
      /Timed out|abort/i,
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('a page that is not HTML, a 404, or a refusal gives a plain card, not an error', async () => {
    for (const [url, outcome] of [
      [at('site.test', '/image'), 'fetched'],
      [at('site.test', '/missing'), 'failed'],
      [at('intranet.test', '/og'), 'refused'],
    ] as const) {
      const res = await fetchLinkPreview(url, testFetch);
      expect(res.outcome).toBe(outcome);
      expect(res.preview).toEqual({ url, title: null, description: null, siteName: null, imageUrl: null });
    }
  });
});

describe('Open Graph parsing', () => {
  it('falls back to <title> and meta description', () => {
    const card = parseOpenGraph(
      '<html><head><title> Just a title </title><meta name="description" content="Plain page"></head></html>',
      'https://example.org/a',
    );
    expect(card).toEqual({ title: 'Just a title', description: 'Plain page', siteName: null, imageUrl: null });
  });

  it('drops images that are not web links', () => {
    const card = parseOpenGraph('<meta property="og:image" content="javascript:alert(1)">', 'https://example.org/');
    expect(card.imageUrl).toBeNull();
    const data = parseOpenGraph('<meta property="og:image" content="data:image/png;base64,AAAA">', 'https://example.org/');
    expect(data.imageUrl).toBeNull();
  });

  it('keeps long text short', () => {
    const card = parseOpenGraph(`<meta property="og:title" content="${'a'.repeat(1000)}">`, 'https://example.org/');
    expect(card.title!.length).toBeLessThanOrEqual(300);
  });
});

// ---------- the endpoint and the cache ----------

describe('GET /api/link-preview', () => {
  let ctx: TestCtx;
  let member: Client;
  const { db, pool } = createDb(inject('databaseUrl'));

  beforeAll(async () => {
    ctx = await setupApp({}, { linkPreviewFetch: testFetch });
    await ctx.reset();
    await db.delete(linkPreviews);
    member = (await signup(ctx.app, 'Lin')).client;
  });
  afterAll(async () => {
    await ctx.close();
    await pool.end();
  });

  const ask = (c: Client, url: string) => c.get(`/api/link-preview?url=${encodeURIComponent(url)}`);

  it('needs a signed-in user', async () => {
    expect((await ask(new Client(ctx.app), at('site.test', '/og'))).status).toBe(401);
  });

  it.each(['', 'not a url', 'javascript:alert(1)', 'ftp://site.test/x', 'file:///etc/passwd', 'http://user:pw@site.test/'])(
    'answers 400 for %j',
    async (url) => {
      expect((await ask(member, url)).status).toBe(400);
    },
  );

  it('returns the card, saves it in link_previews, and serves the next ask from there', async () => {
    const url = at('site.test', '/og');
    const before = hits.length;
    const first = await ask(member, `${url}#section`); // the #fragment is not part of the key
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ url, title: 'Quiet Gardens & Ponds', siteName: 'Garden Notes' });
    expect(hits.length).toBe(before + 1);

    const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url));
    expect(row).toMatchObject({ title: 'Quiet Gardens & Ponds', description: 'A calm guide to "still water".' });

    const second = await ask(member, url);
    expect(second.body).toEqual(first.body);
    expect(hits.length).toBe(before + 1); // not fetched again
  });

  it('a refused URL gives 200 with a plain card (url only)', async () => {
    const url = at('metadata.test', '/latest/meta-data/');
    const res = await ask(member, url);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url, title: null, description: null, siteName: null, imageUrl: null });
  });

  it('fetches a stale card again', async () => {
    const url = at('site.test', '/title-only');
    const before = hits.length;
    await getLinkPreview(db, url, testFetch, Date.now() - 8 * 24 * 3600_000);
    const res = await getLinkPreview(db, url, testFetch);
    expect(res.outcome).toBe('fetched');
    expect(hits.length).toBe(before + 2);
    expect(res.preview.title).toBe('Just a title');
  });

  it('normalizePreviewUrl keeps the address and drops the fragment', () => {
    expect(normalizePreviewUrl(' https://Example.org/a?b=1#c ')).toBe('https://example.org/a?b=1');
  });
});
