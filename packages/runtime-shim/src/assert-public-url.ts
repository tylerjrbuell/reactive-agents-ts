import { lookup } from "node:dns/promises";

/** Cloud-metadata hostnames — never a legitimate target, blocked even when allowPrivate. */
const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata"]);

/**
 * True if `ip` is link-local / cloud-metadata (169.254.0.0/16, fe80::/10). These
 * are never a legitimate destination and are blocked even under `allowPrivate`.
 */
export function isMetadataOrLinkLocalIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) return Number(v4[1]) === 169 && Number(v4[2]) === 254;
  const low = ip.toLowerCase();
  if (low.startsWith("::ffff:")) return isMetadataOrLinkLocalIp(low.slice(7));
  return low.startsWith("fe80");
}

/**
 * True if `ip` is a loopback, link-local, private, CGNAT, or otherwise
 * non-public/reserved address (IPv4 or IPv6). Pure and synchronous.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
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

  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true; // loopback / unspecified
  if (low.startsWith("::ffff:")) return isPrivateOrReservedIp(low.slice(7)); // v4-mapped
  if (low.startsWith("fe80")) return true; // link-local
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local fc00::/7
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
  if (!allowPrivate && host === "localhost") {
    throw new Error(`assertPublicUrl: blocked loopback host "${host}"`);
  }

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
