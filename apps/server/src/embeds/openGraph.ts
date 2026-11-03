// Reads the Open Graph card fields out of a page's HTML, with the usual
// fallbacks (<title>, meta description). No HTML library: only <meta> tags and
// <title> matter, and the input is already capped at 1 MB.

export interface OpenGraph {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[ent.toLowerCase()] ?? whole;
  });
}

function clean(v: string | undefined, max: number): string | null {
  if (!v) return null;
  // Strip control characters and collapse whitespace.
  // eslint-disable-next-line no-control-regex
  const text = decodeEntities(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/** An absolute http(s) image URL, or null. Relative URLs resolve against the page. */
function imageUrl(v: string | undefined, pageUrl: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(decodeEntities(v.trim()), pageUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href.length <= 2048 ? u.href : null;
  } catch {
    return null;
  }
}

export function parseOpenGraph(html: string, pageUrl: string): OpenGraph {
  // Only the head matters; the body can be large.
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 300),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, 600),
    siteName: clean(meta['og:site_name'], 100),
    imageUrl: imageUrl(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'], pageUrl),
  };
}
