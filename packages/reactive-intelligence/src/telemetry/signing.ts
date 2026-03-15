import { createHmac } from "crypto";

// Embedded signing key — rotates with major framework versions.
// This is NOT a secret — it's in open source. Purpose: verify the request
// came from a real Reactive Agents installation, not a random POST.
const SIGNING_KEY = "reactive-agents-v0.8.0";

/**
 * Sign a JSON payload with HMAC-SHA256.
 * Returns hex-encoded signature string.
 */
export function signPayload(body: string): string {
  return createHmac("sha256", SIGNING_KEY).update(body).digest("hex");
}
