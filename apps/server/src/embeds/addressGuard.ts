// SSRF guard for the link-preview fetch (done-check 02-editor.md, 2b): the
// server must never be talked into fetching from itself, the private network,
// link-local or cloud metadata addresses. Checked on resolved IPs, IPv4 and IPv6.
import { isIP } from 'node:net';

type Range4 = [number, number]; // [network as uint32, prefix length]

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

const r4 = (net: string, bits: number): Range4 => [v4ToInt(net), bits];

const BLOCKED_V4: Range4[] = [
  r4('0.0.0.0', 8), // "this network"
  r4('10.0.0.0', 8), // private
  r4('100.64.0.0', 10), // carrier-grade NAT (also Alibaba metadata 100.100.100.200)
  r4('127.0.0.0', 8), // loopback
  r4('169.254.0.0', 16), // link-local, incl. 169.254.169.254 metadata
  r4('172.16.0.0', 12), // private
  r4('192.0.0.0', 24), // IETF protocol assignments (incl. 192.0.0.192 Oracle metadata)
  r4('192.0.2.0', 24), // documentation
  r4('192.88.99.0', 24), // 6to4 relay anycast
  r4('192.168.0.0', 16), // private
  r4('198.18.0.0', 15), // benchmarking
  r4('198.51.100.0', 24), // documentation
  r4('203.0.113.0', 24), // documentation
  r4('224.0.0.0', 4), // multicast
  r4('240.0.0.0', 4), // reserved, incl. 255.255.255.255
];

function blocked4(ip: string): boolean {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([net, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= net && n < net + size;
  });
}

/** Expands an IPv6 address (any valid form, incl. trailing dotted IPv4) to 16 bytes. */
function v6ToBytes(ip: string): number[] {
  let s = ip.split('%')[0]!.toLowerCase(); // drop a zone id
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    tail.push(...dotted[1]!.split('.').map(Number));
    s = s.slice(0, -dotted[1]!.length) + '0:0'; // placeholder, replaced below
  }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, undefined];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) => parseInt(g || '0', 16));
  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function blocked6(ip: string): boolean {
  const b = v6ToBytes(ip);
  const allZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const embedded4 = (from: number) => b.slice(from, from + 4).join('.');

  if (allZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d -> judge the IPv4 part.
  if (allZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return blocked4(embedded4(12));
  if (allZero(0, 8) && b[8] === 0xff && b[9] === 0xff && allZero(10, 12)) return blocked4(embedded4(12));
  // Deprecated IPv4-compatible ::a.b.c.d
  if (allZero(0, 12)) return blocked4(embedded4(12));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 can reach the IPv4 inside.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (allZero(4, 12)) return blocked4(embedded4(12));
    if (b[4] === 0 && b[5] === 1) return true;
  }
  // 6to4 2002::/16 carries an IPv4 address in bytes 2-5.
  if (b[0] === 0x20 && b[1] === 0x02) return blocked4(embedded4(2));
  // Teredo 2001:0::/32: the client IPv4 is obfuscated; refuse the whole range.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if ((b[0]! & 0xfe) === 0xfc) return true; // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // old site-local fec0::/10
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x01 && allZero(1, 8)) return true; // discard-only 100::/64
  return false;
}

/**
 * true when the fetcher must not connect to `ip`: loopback, private,
 * link-local, metadata, multicast, reserved, or not an IP address at all.
 */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const family = isIP(bare.split('%')[0]!);
  if (family === 4) return blocked4(bare);
  if (family === 6) return blocked6(bare);
  return true;
}
