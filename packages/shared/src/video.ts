// Video links (done-check 02-editor.md, 2b): a YouTube or Vimeo URL becomes an
// embedded player URL; every other site gives null and is refused.
// YouTube embeds always use the privacy host youtube-nocookie.com.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/** "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> 0. */
function parseStart(v: string | null): number {
  if (!v) return 0;
  if (/^\d+s?$/.test(v)) return parseInt(v, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function youtube(u: URL): string | null {
  let id: string | undefined;
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname === 'youtu.be') {
    id = parts[0];
  } else if (YOUTUBE_HOSTS.has(u.hostname)) {
    if (parts[0] === 'watch' && parts.length === 1) id = u.searchParams.get('v') ?? undefined;
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1];
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const start = parseStart(u.searchParams.get('t') ?? u.searchParams.get('start'));
  return `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
}

function vimeo(u: URL): string | null {
  if (!VIMEO_HOSTS.has(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  let hash: string | undefined;
  if (u.hostname === 'player.vimeo.com') {
    if (parts[0] === 'video') [, id] = parts;
    hash = u.searchParams.get('h') ?? undefined;
  } else if (parts[0] === 'channels' && parts.length >= 3) {
    id = parts[2];
  } else {
    [id, hash] = parts;
  }
  if (!id || !VIMEO_ID.test(id)) return null;
  const query = new URLSearchParams({ dnt: '1' });
  if (hash && VIMEO_HASH.test(hash)) query.set('h', hash);
  return `https://player.vimeo.com/video/${id}?${query}`;
}

/**
 * The embeddable player URL for a YouTube or Vimeo link, or null for any
 * other site, a malformed URL, or a non-http(s) URL.
 */
export function videoEmbedUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  return youtube(u) ?? vimeo(u);
}
