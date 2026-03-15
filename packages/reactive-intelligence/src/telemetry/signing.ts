import { createHmac } from "crypto";

// Embedded signing key — rotates with major framework versions.
// This is NOT a secret — it's in open source. Purpose: verify the request
// came from a real Reactive Agents installation, not a random POST.
const SIGNING_KEY = "b2c9a6d071c8f2069fa5863e5027c91096b9b07758dcbba45706f14fde2d4d6f";

/**
 * Sign a JSON payload with HMAC-SHA256.
 * Returns hex-encoded signature string.
 */
export function signPayload(body: string): string {
  return createHmac("sha256", SIGNING_KEY).update(body).digest("hex");
}
