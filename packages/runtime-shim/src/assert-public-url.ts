import { lookup } from "node:dns/promises";

/** Cloud-metadata hostnames — never a legitimate target, blocked even when allowPrivate. */
const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata"]);

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Parse an IPv6 literal (no brackets; optional `%zone`; optional dotted-quad
 * tail) into 16 bytes. Returns null when `ip` is not a valid IPv6 address.
 */
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (!s.includes(":")) return null;

  // Fold a dotted-quad tail into two hextets.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const m = V4_RE.exec(tail);
    if (!m) return null;
    const o = [m[1], m[2], m[3], m[4]].map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${s.slice(0, lastColon + 1)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const h of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

/**
 * If the 16 IPv6 bytes carry an embedded IPv4 address (IPv4-mapped `::ffff:0:0/96`,
 * IPv4-compatible `::/96`, SIIT `::ffff:0:0:0/96`, NAT64 `64:ff9b::/96`, 6to4
 * `2002::/16`), return it as dotted-quad; otherwise null.
 */
function embeddedIPv4(b: number[]): string | null {
  const zero = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);
  const dotted = (at: number): string => b.slice(at, at + 4).join(".");
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return dotted(12); // mapped
  if (zero(0, 12)) return dotted(12); // compatible (also ::, ::1 -> 0.0.0.x, private)
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return dotted(12); // SIIT
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return dotted(12); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return dotted(2); // 6to4
  return null;
}

/**
 * True if `ip` is link-local / cloud-metadata (169.254.0.0/16, fe80::/10, plus
 * the Alibaba and AWS-IPv6 metadata addresses), including when an IPv4 address is
 * embedded in an IPv6 form. Never a legitimate destination: blocked even under
 * `allowPrivate`.
 */
export function isMetadataOrLinkLocalIp(ip: string): boolean {
  const v4 = V4_RE.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (a === 169 && b === 254) || ip === "100.100.100.200";
  }
  const bytes = parseIPv6(ip);
  if (!bytes) return false;
  const emb = embeddedIPv4(bytes);
  if (emb) return isMetadataOrLinkLocalIp(emb);
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10
  // fd00:ec2::254 (AWS IMDS over IPv6)
  return (
    bytes[0] === 0xfd && bytes[1] === 0x00 && bytes[2] === 0x0e && bytes[3] === 0xc2 &&
    bytes.slice(4, 14).every((x) => x === 0) && bytes[14] === 0x02 && bytes[15] === 0x54
  );
}

/**
 * True if `ip` is a loopback, link-local, private, CGNAT, or otherwise
 * non-public/reserved address (IPv4 or IPv6, incl. IPv4 embedded in mapped,
 * compatible, NAT64 and 6to4 forms). Pure and synchronous. An unparseable
 * IPv6-looking string fails closed (true).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = V4_RE.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return true; // "this" network / 0.0.0.0
    if (a === 10) return true; // RFC 1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (!ip.includes(":")) return false; // not an IP literal
  const bytes = parseIPv6(ip);
  if (!bytes) return true; // fail closed
  const emb = embeddedIPv4(bytes);
  if (emb) return isPrivateOrReservedIp(emb);
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // unique-local fc00::/7
  if (bytes[0] === 0xff) return true; // multicast
  return false;
}

/** True if `host` is a bare IP literal (v4 or bracketless v6). */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export interface AssertPublicUrlOptions {
  /** Injectable DNS resolver (all addresses). Defaults to node:dns lookup. Enables hermetic tests. */
  readonly resolve?: (hostname: string) => Promise<string[]>;
  /** Allowed URL schemes. Defaults to http/https. */
  readonly allowedSchemes?: ReadonlyArray<string>;
  /**
   * Explicit opt-in to permit loopback / private / reserved targets (e.g. a
   * trusted local dev API). Scheme validation still applies. Defaults to false —
   * the guard blocks private targets so a model-controlled URL cannot reach
   * internal services or cloud metadata.
   */
  readonly allowPrivate?: boolean;
}

/**
 * Egress guard (F6). Validates that `rawUrl` points at a public destination and
 * returns the parsed URL, or throws. Blocks non-http(s) schemes, loopback /
 * link-local / private / CGNAT / metadata targets by IP literal or hostname,
 * and hostnames that *resolve* to such an address (DNS-rebinding). Apply at
 * every fetch site; re-validate each redirect hop via `redirect: "manual"`.
 */
export async function assertPublicUrl(
  rawUrl: string,
  opts: AssertPublicUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`assertPublicUrl: invalid URL "${rawUrl}"`);
  }

  const schemes = opts.allowedSchemes ?? ["http:", "https:"];
  if (!schemes.includes(url.protocol)) {
    throw new Error(`assertPublicUrl: blocked URL scheme "${url.protocol}"`);
  }

  const allowPrivate = opts.allowPrivate === true;

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // ipv6 brackets
  host = host.replace(/\.+$/, ""); // "localhost." / "metadata.google.internal." are the same host

  // Cloud-metadata hostnames are never legitimate — blocked even under allowPrivate.
  if (METADATA_HOSTNAMES.has(host) || host.endsWith(".internal")) {
    throw new Error(`assertPublicUrl: blocked metadata host "${host}"`);
  }

  if (isIpLiteral(host)) {
    if (isMetadataOrLinkLocalIp(host)) {
      throw new Error(`assertPublicUrl: blocked metadata/link-local address "${host}"`);
    }
    if (!allowPrivate && isPrivateOrReservedIp(host)) {
      throw new Error(`assertPublicUrl: blocked private/reserved address "${host}"`);
    }
    return url;
  }

  // localhost is a valid local peer only when private targets are allowed.
  if (!allowPrivate && (host === "localhost" || host.endsWith(".localhost"))) {
    throw new Error(`assertPublicUrl: blocked loopback host "${host}"`);
  }

  // Residual risk (DNS rebinding / TOCTOU): DNS is resolved here, then the caller's
  // fetch() resolves the hostname again independently. A rebinding server can
  // answer public now and private later. This guard does not pin the address;
  // callers needing a hard guarantee must connect to a validated IP themselves.
  const resolve =
    opts.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
  const addresses = await resolve(host);
  if (addresses.length === 0) {
    throw new Error(`assertPublicUrl: could not resolve host "${host}"`);
  }
  for (const addr of addresses) {
    if (isMetadataOrLinkLocalIp(addr)) {
      throw new Error(`assertPublicUrl: host "${host}" resolves to metadata/link-local "${addr}"`);
    }
    if (!allowPrivate && isPrivateOrReservedIp(addr)) {
      throw new Error(`assertPublicUrl: host "${host}" resolves to private address "${addr}"`);
    }
  }

  return url;
}
