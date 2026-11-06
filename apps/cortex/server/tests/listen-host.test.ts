// Run: bun test apps/cortex/server/tests/listen-host.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CORTEX_HOST, isLoopbackHost, resolveCortexHostname } from "../listen-host.js";

describe("resolveCortexHostname", () => {
  it("binds loopback by default", () => {
    expect(DEFAULT_CORTEX_HOST).toBe("127.0.0.1");
    expect(resolveCortexHostname(undefined, {})).toBe("127.0.0.1");
    expect(resolveCortexHostname("  ", { CORTEX_HOST: "" })).toBe("127.0.0.1");
  });

  it("CORTEX_HOST opts in to another interface", () => {
    expect(resolveCortexHostname(undefined, { CORTEX_HOST: " 0.0.0.0 " })).toBe("0.0.0.0");
  });

  it("an explicit config hostname wins over the env", () => {
    expect(resolveCortexHostname("192.168.1.5", { CORTEX_HOST: "0.0.0.0" })).toBe("192.168.1.5");
  });
});

describe("startCortexServer bind", () => {
  it("listens on 127.0.0.1 when neither config nor CORTEX_HOST opts in", async () => {
    const prev = process.env.CORTEX_HOST;
    delete process.env.CORTEX_HOST;
    const dir = mkdtempSync(join(tmpdir(), "cortex-bind-"));
    const { startCortexServer } = await import("../index.js");
    const server = await startCortexServer({ port: 0, dbPath: join(dir, "cortex.db"), openBrowser: false });
    try {
      expect(server.hostname).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/workspace/recent`);
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
      if (prev !== undefined) process.env.CORTEX_HOST = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("isLoopbackHost", () => {
  it("recognises loopback names and addresses", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["0.0.0.0", "::", "192.168.1.5", "example.com"]) expect(isLoopbackHost(h)).toBe(false);
  });
});
