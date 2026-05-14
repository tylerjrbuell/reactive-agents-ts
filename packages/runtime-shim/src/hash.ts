import { createRequire } from "node:module";
import { isBun } from "./detect.js";

const require = createRequire(import.meta.url);

interface BunHashApi {
  hash(input: string | Uint8Array): bigint;
}

/**
 * 64-bit content hash. Returns bigint so `.toString(36)` produces compact cache keys.
 * Bun: uses Bun.hash (Wyhash, ~25 GB/s).
 * Node: uses crypto SHA-256, truncated to 64 bits (first 8 bytes big-endian).
 *
 * Note: hash values differ between Bun and Node — within a single process they're
 * deterministic and that's all consumers (embedding caches, semantic caches) need.
 */
export function hash(input: string | Uint8Array): bigint {
  if (isBun) {
    const Bun = (globalThis as { Bun?: BunHashApi }).Bun;
    if (!Bun) throw new Error("Bun runtime missing");
    return Bun.hash(input);
  }

  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const buf = createHash("sha256")
    .update(typeof input === "string" ? input : Buffer.from(input))
    .digest();

  // First 8 bytes as a big-endian bigint
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 8n) | BigInt(buf[i] ?? 0);
  }
  return result;
}
