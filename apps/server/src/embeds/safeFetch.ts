// Fetches a web page for a link preview without letting the URL reach inside
// the network (done-check 02-editor.md, 2b): 5 s for the whole fetch, at most
// 1 MB read, at most 3 redirects, and every address checked after DNS lookup —
// on the first request and again on each redirect. The socket connects to the
// exact address that was checked, so a second DNS answer cannot slip past.
import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isBlockedAddress } from './addressGuard.js';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Hostname -> every address it resolves to. Default: the system resolver. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * Test hook only: where to open the socket once `checked` has passed the
   * guard. Lets tests point "public" test hostnames at a local stub server
   * while the real guard still judges the address the name resolved to.
   */
  dial?: (checked: ResolvedAddress) => ResolvedAddress;
}

export interface FetchedPage {
  /** The URL after redirects. */
  url: string;
  contentType: string;
  /** The body, cut at maxBytes; null when the response is not HTML. */
  html: string | null;
}

/** The URL or an address on the way was refused by the guard. */
export class FetchRefused extends Error {}

export const LIMITS = { timeoutMs: 5_000, maxBytes: 1024 * 1024, maxRedirects: 3 } as const;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const systemResolve = async (hostname: string): Promise<ResolvedAddress[]> =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** Only plain http(s) URLs with no user:password part are fetched. */
export function checkUrlShape(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchRefused('Only http and https links');
  if (u.username || u.password) throw new FetchRefused('Links with a user name or password are not fetched');
}

function guardedLookup(opts: SafeFetchOptions): LookupFunction {
  const resolve = opts.resolve ?? systemResolve;
  return ((hostname: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    resolve(hostname)
      .then((addrs) => {
        if (addrs.length === 0) throw new Error(`No address for ${hostname}`);
        // Every answer must be safe, not just the first one.
        const bad = addrs.find((a) => isBlockedAddress(a.address));
        if (bad) throw new FetchRefused(`${hostname} resolves to a blocked address`);
        const chosen = addrs.map((a) => opts.dial?.(a) ?? a);
        if (options?.all) cb(null, chosen);
        else cb(null, chosen[0]!.address, chosen[0]!.family);
      })
      .catch((err) => cb(err));
  }) as LookupFunction;
}

function request(u: URL, opts: SafeFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  const host = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
  // An IP literal never goes through `lookup`, so it is judged here.
  if (isIP(host) && isBlockedAddress(host)) throw new FetchRefused(`${host} is a blocked address`);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        host,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: {
          'user-agent': 'StillwaterLinkPreview/1.0',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-encoding': 'identity',
        },
        lookup: guardedLookup(opts),
        signal,
        agent: false,
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

function readCapped(res: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks, size));
    };
    const onAbort = () => {
      res.destroy();
      finish(new Error('Timed out'));
    };
    signal.addEventListener('abort', onAbort);
    res.on('data', (chunk: Buffer) => {
      const room = maxBytes - size;
      if (chunk.length >= room) {
        // The cap is reached: keep what fits and stop reading.
        chunks.push(chunk.subarray(0, room));
        size += room;
        res.destroy();
        finish();
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    res.on('end', () => finish());
    res.on('error', (err) => finish(err));
    res.on('close', () => finish(res.complete ? undefined : new Error('Connection closed early')));
  });
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * GETs `url` with the SSRF guard and limits. Throws FetchRefused when the
 * guard says no, and a plain Error for timeouts, bad statuses and the like.
 */
export async function safeFetchPage(url: string, opts: SafeFetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? LIMITS.timeoutMs;
  const maxBytes = opts.maxBytes ?? LIMITS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? LIMITS.maxRedirects;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timed out')), timeoutMs);
  const timedOut = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(new Error('Timed out'))),
  );
  timedOut.catch(() => {});

  const run = async (): Promise<FetchedPage> => {
    let current = new URL(url);
    for (let hop = 0; ; hop++) {
      checkUrlShape(current);
      const res = await request(current, opts, controller.signal);
      const status = res.statusCode ?? 0;
      if (REDIRECTS.has(status)) {
        res.destroy();
        const location = res.headers.location;
        if (!location) throw new Error(`Redirect ${status} without a Location`);
        if (hop >= maxRedirects) throw new FetchRefused(`More than ${maxRedirects} redirects`);
        current = new URL(location, current);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        throw new Error(`The site answered ${status}`);
      }
      const contentType = String(res.headers['content-type'] ?? '');
      if (!/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        res.destroy();
        return { url: current.href, contentType, html: null };
      }
      const body = await readCapped(res, maxBytes, controller.signal);
      return { url: current.href, contentType, html: decode(body, contentType) };
    }
  };

  try {
    return await Promise.race([run(), timedOut]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
