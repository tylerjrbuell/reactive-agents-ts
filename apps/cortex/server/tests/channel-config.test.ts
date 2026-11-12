// Run: bun run repo test apps/cortex/server/tests/channel-config.test.ts
//
// Saved channel entries and the curated gateway block: what survives parsing, what is cut
// (credentials in a hand-edited config), and the access rule the overview states.
import { describe, expect, it } from "bun:test";
import { parseCortexChannels, parseCortexGatewayConfig, summarizeAccess } from "../services/channel-config.js";

describe("parseCortexChannels", () => {
  it("keeps known kinds with their settings and defaults enabled to true", () => {
    const out = parseCortexChannels([
      { id: "ch-aaaa1111", kind: "telegram", label: "Support bot" },
      { id: "ch-bbbb2222", kind: "signal", enabled: false, settings: { transport: "socket", host: "10.0.0.5", port: 7600 } },
      { id: "ch-cccc3333", kind: "webhook", settings: { route: "hooks/in", ingressPort: 7700, replyUrl: "https://example.com/reply" } },
    ]);
    expect(out).toEqual([
      { id: "ch-aaaa1111", kind: "telegram", label: "Support bot", enabled: true, settings: {} },
      { id: "ch-bbbb2222", kind: "signal", enabled: false, settings: { transport: "socket", host: "10.0.0.5", port: 7600 } },
      { id: "ch-cccc3333", kind: "webhook", enabled: true, settings: { route: "/hooks/in", ingressPort: 7700, replyUrl: "https://example.com/reply" } },
    ]);
  });

  it("drops credential-looking keys from settings so a hand-edited secret is never forwarded", () => {
    const [entry] = parseCortexChannels([
      { id: "ch-aaaa1111", kind: "telegram", token: "123:SECRET", settings: { token: "123:SECRET", secret: "x", account: "+1555" } },
    ]);
    expect(JSON.stringify(entry)).not.toContain("SECRET");
    expect(entry?.settings).toEqual({});
  });

  it("drops unknown kinds, malformed ids, duplicates and junk", () => {
    const out = parseCortexChannels([
      { id: "ch-aaaa1111", kind: "carrier-pigeon" },
      { id: "../etc", kind: "telegram" },
      { id: "ch-aaaa1111", kind: "telegram" },
      { id: "ch-aaaa1111", kind: "signal" },
      "nope",
      null,
    ]);
    expect(out.map((e) => `${e.id}:${e.kind}`)).toEqual(["ch-aaaa1111:telegram"]);
  });

  it("rejects out-of-range ports", () => {
    const [entry] = parseCortexChannels([{ id: "ch-aaaa1111", kind: "signal", settings: { port: 99999 } }]);
    expect(entry?.settings.port).toBeUndefined();
  });
});

describe("parseCortexGatewayConfig", () => {
  it("returns undefined when nothing is set", () => {
    expect(parseCortexGatewayConfig(undefined)).toBeUndefined();
    expect(parseCortexGatewayConfig({})).toBeUndefined();
    expect(parseCortexGatewayConfig({ accessControl: {}, queue: {}, crons: [] })).toBeUndefined();
  });

  it("keeps access control, queue and valid crons; trims and de-duplicates senders", () => {
    const g = parseCortexGatewayConfig({
      accessControl: { accessPolicy: "allowlist", allowedSenders: [" telegram:1 ", "telegram:1", ""], unknownSenderAction: "escalate", mode: "task" },
      queue: { capacity: 20, overflow: "drop-newest" },
      crons: [{ schedule: "0 9 * * 1", instruction: "Weekly digest", priority: "high" }, { schedule: "", instruction: "x" }, { schedule: "* * * * *" }],
    });
    expect(g?.accessControl).toEqual({ accessPolicy: "allowlist", allowedSenders: ["telegram:1"], unknownSenderAction: "escalate", mode: "task" });
    expect(g?.queue).toEqual({ capacity: 20, overflow: "drop-newest" });
    expect(g?.crons).toEqual([{ schedule: "0 9 * * 1", instruction: "Weekly digest", priority: "high" }]);
  });

  it("ignores values the framework schema would reject", () => {
    const g = parseCortexGatewayConfig({ accessControl: { accessPolicy: "everyone", sessionTtlDays: -3 }, queue: { capacity: 0 } });
    expect(g).toBeUndefined();
  });
});

describe("summarizeAccess (the framework's fail-closed rule)", () => {
  it("no access control at all denies everyone", () => {
    expect(summarizeAccess(undefined).mode).toBe("deny-all");
  });
  it("an empty allowlist denies everyone", () => {
    expect(summarizeAccess({ accessControl: { accessPolicy: "allowlist", allowedSenders: [] } }).mode).toBe("deny-all");
  });
  it("an allowlist with entries is an allowlist", () => {
    expect(summarizeAccess({ accessControl: { allowedSenders: ["telegram:1", "signal:+1555"] } })).toEqual({ mode: "allowlist", allowed: 2, blocked: 0 });
  });
  it("open is the only way to accept everyone", () => {
    expect(summarizeAccess({ accessControl: { accessPolicy: "open" } }).mode).toBe("open");
  });
  it("a blocklist is not deny-all when empty", () => {
    expect(summarizeAccess({ accessControl: { accessPolicy: "blocklist" } }).mode).toBe("blocklist");
  });
});
