/**
 * One validator for every URL the Cortex server fetches on a caller's say-so: the Ollama
 * endpoint (query parameter and saved setting) and the voice base URLs.
 *
 * A local desk legitimately talks to loopback and LAN hosts (a speech server, Ollama on
 * another box), so private ranges stay allowed. What is refused is what a request forgery
 * would aim at: non-http(s) schemes, embedded credentials, and link-local / cloud-metadata
 * hosts, both as literals and as DNS answers (a name that resolves to 169.254.169.254).
 * Redirects are never followed (see {@link noRedirect}); an upstream's body is never echoed.
 */
import { lookup } from "node:dns/promises";
import { isLoopbackHost } from "./listen-host.js";

/**
 * Link-local and cloud-metadata hosts: 169.254.0.0/16 (AWS/GCP/Azure metadata at
 * 169.254.169.254), fe80::/10, IPv4-mapped forms of those, and the GCP metadata names.
 * `URL` has already folded decimal/hex/octal IPv4 spellings into dotted form by the time
 * this runs.
 */
export function isBlockedAddress(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "metadata.google.internal" || h === "metadata" || h === "100.100.100.200" || h === "fd00:ec2::254") return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
  // ::ffff:a9fe:xxxx (the URL parser's compressed form of ::ffff:169.254.x.x)
  return /^::ffff:(169\.254\.|a9fe:)/.test(h);
}

/** Resolves a host name to every address it answers with. Injectable for tests. */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

/** The system resolver (all A and AAAA answers). */
export const systemResolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address);

const isIpLiteral = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");

/** The outcome of {@link checkOutboundUrl}. */
export type OutboundUrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string };

/**
 * Check a caller-supplied base URL. Refuses a non-http(s) scheme, embedded credentials,
 * a blocked literal host, and a host name that resolves to a blocked address. A name that
 * does not resolve is allowed through here (the fetch will fail on its own, and a LAN name
 * may resolve only later); loopback names skip the lookup.
 */
export async function checkOutboundUrl(raw: string, resolve: HostResolver = systemResolver): Promise<OutboundUrlCheck> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "only http(s) URLs are allowed" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "URLs with a username or password are not allowed" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedAddress(host)) return { ok: false, reason: "link-local and cloud-metadata addresses are not allowed" };
  if (isLoopbackHost(host) || isIpLiteral(host)) return { ok: true, url };
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: true, url };
  }
  if (addresses.some(isBlockedAddress)) return { ok: false, reason: "the host resolves to a link-local or cloud-metadata address" };
  return { ok: true, url };
}

/** A fetch that never follows a redirect (a 3xx comes back as the response; callers treat it as a failure). */
export function noRedirect(doFetch: typeof fetch): typeof fetch {
  const wrapped = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> =>
    doFetch(input, { ...init, redirect: "manual" });
  return Object.assign(wrapped, doFetch);
}
