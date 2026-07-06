/**
 * Optional Ed25519 provenance signature for {@link TrustReceipt} (Arc 1 Task 9).
 *
 * HONEST-CLAIMS SCOPE (binding): a signature certifies "this receipt, this
 * run, untampered" — that these exact receipt bytes were produced by the
 * holder of the embedded public key and have not been altered since
 * signing. It NEVER certifies the correctness of the agent's answer, and it
 * does not change what `verdict` means — `TrustReceipt.verdict` was already
 * only an evidence-trail grade (see `@reactive-agents/core`'s TrustReceipt
 * JSDoc), not a truth claim, and signing adds nothing to that meaning.
 *
 * Mechanism mirrors the Ed25519 key handling in
 * `packages/identity/src/auth/certificate-auth.ts:140-209` — WebCrypto
 * `crypto.subtle` with the `"Ed25519"` algorithm name, confirmed working
 * keyless (no external deps, no native bindings) under the pinned Bun
 * 1.3.10. This module is runtime-local (does NOT import `@reactive-agents/identity`)
 * to avoid a hard dependency from `runtime` on `identity` for an optional,
 * additive feature. Unlike certificate-auth.ts (which exchanges raw+base64
 * public keys over a cert payload string), this module uses JWK export/import
 * throughout so a private key can round-trip through builder options or the
 * `RA_RECEIPT_KEY` env var as plain JSON.
 */
import type { TrustReceipt } from "@reactive-agents/core";

// ─── Canonical bytes ───

/**
 * Deterministic JSON serialization (object keys sorted recursively).
 *
 * Local copy of `packages/replay/src/stable-stringify.ts`'s algorithm —
 * NOT imported from `@reactive-agents/replay`, which would be a layering
 * violation (runtime must not depend on replay). Keep the two in sync if
 * the canonicalization algorithm ever changes.
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/**
 * Canonical bytes signed/verified: UTF-8 of the receipt's stable-stringified
 * JSON with `signature` excluded — the field being computed/checked can't be
 * part of its own input.
 *
 * Returns `ArrayBuffer` (not `Uint8Array`) to match `crypto.subtle.sign`/
 * `.verify`'s `BufferSource` parameter — mirrors `certPayload`'s cast in
 * certificate-auth.ts.
 */
function canonicalReceiptBytes(receipt: TrustReceipt): ArrayBuffer {
  const { signature: _signature, ...unsigned } = receipt;
  const encoded = new TextEncoder().encode(stableStringify(unsigned));
  return encoded.buffer as ArrayBuffer;
}

// ─── base64url helpers ───

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): ArrayBuffer {
  const normalized = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

// ─── Key handling ───

/** Derive the public JWK from an Ed25519 private JWK: same `x` (public key
 * component), `d` (private scalar) dropped, `key_ops` narrowed to verify. */
function publicJwkFromPrivate(privateKeyJwk: JsonWebKey): JsonWebKey {
  return {
    kty: privateKeyJwk.kty,
    crv: privateKeyJwk.crv,
    x: privateKeyJwk.x,
    ext: true,
    key_ops: ["verify"],
  };
}

/** Loose structural check that a value looks like an Ed25519 JWK (public or
 * private) — enough to guard against obviously-wrong config/env values
 * without importing a full JWK validation library. */
function isJsonWebKeyLike(value: unknown): value is JsonWebKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kty?: unknown }).kty === "string" &&
    typeof (value as { crv?: unknown }).crv === "string" &&
    typeof (value as { x?: unknown }).x === "string"
  );
}

/**
 * Generate a fresh Ed25519 key pair for receipt signing, exported as JWKs so
 * the private key can be stored/transmitted as plain JSON (builder option or
 * `RA_RECEIPT_KEY` env var).
 */
export async function generateReceiptKeyPair(): Promise<{
  readonly privateKeyJwk: JsonWebKey;
  readonly publicKeyJwk: JsonWebKey;
}> {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const [privateKeyJwk, publicKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
  ]);
  return { privateKeyJwk, publicKeyJwk };
}

/**
 * Resolve the receipt-signing private key: an explicitly configured key
 * (from `.withReceiptSigning()`) wins; otherwise falls back to the
 * `RA_RECEIPT_KEY` env var (JWK JSON). Absent/malformed either way →
 * `undefined` → the caller leaves the receipt unsigned (normal default,
 * zero overhead).
 */
export function resolveReceiptSigningKey(configuredKey: unknown): JsonWebKey | undefined {
  if (isJsonWebKeyLike(configuredKey)) return configuredKey;
  const envValue = typeof process !== "undefined" ? process.env?.["RA_RECEIPT_KEY"] : undefined;
  if (!envValue) return undefined;
  try {
    const parsed: unknown = JSON.parse(envValue);
    return isJsonWebKeyLike(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ─── Sign / verify ───

/**
 * Sign a {@link TrustReceipt}'s canonical bytes with an Ed25519 private key
 * (JWK). Returns the receipt with `signature` attached.
 *
 * Certifies provenance/integrity ONLY — see this module's honest-claims
 * note. Never a claim about the answer's correctness.
 */
export async function signReceipt(
  receipt: TrustReceipt,
  privateKeyJwk: JsonWebKey,
): Promise<TrustReceipt> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    "Ed25519",
    true,
    ["sign"],
  );
  const bytes = canonicalReceiptBytes(receipt);
  const sigBuf = await crypto.subtle.sign("Ed25519", privateKey, bytes);
  const publicKeyJwk = publicJwkFromPrivate(privateKeyJwk);
  return {
    ...receipt,
    signature: {
      alg: "ed25519",
      publicKey: JSON.stringify(publicKeyJwk),
      sig: toBase64Url(sigBuf),
    },
  };
}

/**
 * Verify a {@link TrustReceipt}'s embedded Ed25519 signature.
 *
 * Returns `true` only when the signature validates against the receipt's
 * OWN canonical bytes using the OWN embedded public key — this is a
 * self-contained check (no external trust anchor), so it certifies
 * "unaltered since signing", not "signed by someone you should trust".
 * Never throws: any malformed/tampered input resolves to `false`.
 */
export async function verifyReceipt(receipt: TrustReceipt): Promise<boolean> {
  try {
    const signature = receipt.signature;
    if (!signature || signature.alg !== "ed25519") return false;
    const publicKeyJwk = JSON.parse(signature.publicKey) as JsonWebKey;
    if (!isJsonWebKeyLike(publicKeyJwk)) return false;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      "Ed25519",
      true,
      ["verify"],
    );
    const bytes = canonicalReceiptBytes(receipt);
    const sigBuf = fromBase64Url(signature.sig);
    return await crypto.subtle.verify("Ed25519", publicKey, sigBuf, bytes);
  } catch {
    return false;
  }
}
