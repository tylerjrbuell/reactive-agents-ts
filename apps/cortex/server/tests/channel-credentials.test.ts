// Run: bun run repo test apps/cortex/server/tests/channel-credentials.test.ts
//
// Channel credentials are write-only: sealed at rest, masked on every read, bound to their
// channel, invisible to the Providers list, and never in an API response or a probe result.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelCredentials } from "../services/channel-credentials.js";
import { PROVIDER_KEYS_FILE, ProviderKeyStore } from "../services/provider-key-store.js";

const TOKEN = "123456789:AAFakeTelegramBotToken_abcdefgh";
const CH = "ch-aaaa1111";
let dir: string;
let store: ProviderKeyStore;
let creds: ChannelCredentials;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-chan-"));
  store = new ProviderKeyStore({ dir, env: {}, now: () => 5_000 });
  creds = new ChannelCredentials(store);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ChannelCredentials", () => {
  it("round-trips a token, keeping only ciphertext on disk", () => {
    expect(creds.set(CH, "telegram", "token", TOKEN).ok).toBe(true);
    expect(creds.value(CH, "token")).toBe(TOKEN);
    const raw = readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8");
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(TOKEN.slice(-12));
  });

  it("status carries a mask and a time, never the value", () => {
    creds.set(CH, "telegram", "token", TOKEN);
    const [field] = creds.status(CH, "telegram");
    expect(field).toEqual({ field: "token", masked: `••••${TOKEN.slice(-4)}`, updatedAt: 5_000 });
    expect(JSON.stringify(creds.status(CH, "telegram"))).not.toContain(TOKEN);
  });

  it("reports an unsaved field as null, not an error", () => {
    expect(creds.status(CH, "signal")).toEqual([{ field: "account", masked: null, updatedAt: null }]);
  });

  it("rejects a field the kind does not have and a malformed channel id", () => {
    expect(creds.set(CH, "telegram", "secret", "x".repeat(10)).ok).toBe(false);
    expect(creds.set("../../etc", "telegram", "token", TOKEN).ok).toBe(false);
    expect(creds.value("../../etc", "token")).toBeUndefined();
  });

  it("is bound to its channel: the same value under another channel is a different entry", () => {
    creds.set(CH, "telegram", "token", TOKEN);
    expect(creds.value("ch-bbbb2222", "token")).toBeUndefined();
  });

  it("never shows up in the Providers key list or reaches an agent as a provider key", () => {
    creds.set(CH, "telegram", "token", TOKEN);
    const list = store.list();
    expect(list.ok).toBe(true);
    if (list.ok) expect(JSON.stringify(list.value)).not.toContain("channel:");
    expect(store.keyForAgent(`channel:${CH}:token`)).toBeUndefined();
    expect(store.storedKey(`channel:${CH}:token`)).toBeUndefined();
  });

  it("remove and removeAll delete the sealed entries", () => {
    creds.set(CH, "telegram", "token", TOKEN);
    expect(creds.remove(CH, "telegram", "token").ok).toBe(true);
    expect(creds.value(CH, "token")).toBeUndefined();
    creds.set(CH, "webhook", "secret", "whsec_0123456789");
    creds.removeAll(CH);
    expect(creds.value(CH, "secret")).toBeUndefined();
  });

  it("an empty value is refused", () => {
    expect(creds.set(CH, "telegram", "token", "   ").ok).toBe(false);
  });
});
