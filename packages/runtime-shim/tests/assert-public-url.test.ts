// Run: bun test packages/runtime-shim/tests/assert-public-url.test.ts --timeout 15000
//
// F6 — the http-get builtin (and every other fetch site) took a model-controlled
// URL with no egress guard, so a prompt-injected agent could hit cloud metadata
// (169.254.169.254) or internal services (10.x/admin). assertPublicUrl blocks
// loopback / link-local / private / metadata targets — including hostnames that
// RESOLVE to a private address (DNS rebinding) — and non-http schemes.
import { describe, test, expect } from "bun:test";
import { assertPublicUrl, isPrivateOrReservedIp } from "../src/assert-public-url.js";

// Deterministic resolver so tests never touch real DNS.
const resolveTo = (addrs: string[]) => async () => addrs;

describe("F6 — isPrivateOrReservedIp", () => {
  test.each([
    ["10.0.0.1", true],
    ["172.16.5.4", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["fe80::1", true],
    ["fd00::1", true],
    ["::ffff:127.0.0.1", true],
    ["8.8.8.8", false],
    ["93.184.216.34", false],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
  ])("%s → %p", (ip, expected) => {
    expect(isPrivateOrReservedIp(ip as string)).toBe(expected);
  });
});

describe("F6 — assertPublicUrl", () => {
  test("blocks the cloud metadata IP", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  }, 15000);

  test("blocks a private RFC-1918 target", async () => {
    await expect(assertPublicUrl("http://10.0.0.1/admin")).rejects.toThrow();
  }, 15000);

  test("blocks loopback by name and by IP", async () => {
    await expect(assertPublicUrl("http://localhost:8080/")).rejects.toThrow();
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow();
  }, 15000);

  test("blocks the GCE metadata hostname and .internal", async () => {
    await expect(assertPublicUrl("http://metadata.google.internal/")).rejects.toThrow();
    await expect(assertPublicUrl("http://foo.internal/")).rejects.toThrow();
  }, 15000);

  test("blocks non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("ftp://example.com/")).rejects.toThrow();
  }, 15000);

  test("blocks a hostname that resolves to a private address (DNS rebinding)", async () => {
    await expect(
      assertPublicUrl("http://evil.example.com/", { resolve: resolveTo(["10.0.0.5"]) }),
    ).rejects.toThrow();
  }, 15000);

  test("allows a hostname that resolves to a public address", async () => {
    const url = await assertPublicUrl("https://api.example.com/v1", {
      resolve: resolveTo(["93.184.216.34"]),
    });
    expect(url.hostname).toBe("api.example.com");
  }, 15000);

  test("allows a public IP literal without any DNS lookup", async () => {
    const url = await assertPublicUrl("https://8.8.8.8/");
    expect(url.hostname).toBe("8.8.8.8");
  }, 15000);

  // allowPrivate: permit RFC-1918/loopback peers, but NEVER metadata/link-local.
  describe("allowPrivate (operator-configured local peers)", () => {
    test("permits loopback and RFC-1918 when allowPrivate is set", async () => {
      const a = await assertPublicUrl("http://127.0.0.1:8080/", { allowPrivate: true });
      expect(a.hostname).toBe("127.0.0.1");
      const b = await assertPublicUrl("http://10.0.0.5:3000/", { allowPrivate: true });
      expect(b.hostname).toBe("10.0.0.5");
    }, 15000);

    test("still blocks the cloud metadata IP even with allowPrivate", async () => {
      await expect(
        assertPublicUrl("http://169.254.169.254/", { allowPrivate: true }),
      ).rejects.toThrow(/metadata|link-local/i);
    }, 15000);

    test("still blocks the metadata hostname even with allowPrivate", async () => {
      await expect(
        assertPublicUrl("http://metadata.google.internal/", { allowPrivate: true }),
      ).rejects.toThrow();
    }, 15000);

    test("still blocks a host that resolves to metadata even with allowPrivate", async () => {
      await expect(
        assertPublicUrl("http://sneaky.example.com/", {
          allowPrivate: true,
          resolve: resolveTo(["169.254.169.254"]),
        }),
      ).rejects.toThrow(/metadata|link-local/i);
    }, 15000);
  });
});
