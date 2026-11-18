// Run: bun test apps/cli/tests/cortex-argv.test.ts --timeout 15000
import { describe, expect, it, spyOn } from "bun:test";
import { parseCortexArgv, printCortexHelp } from "../src/commands/cortex.js";

describe("rax cortex --help", () => {
  it("says a non-loopback host requires CORTEX_TOKEN (Cortex refuses such binds without it)", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCortexHelp();
      const text = log.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(text).toContain("requires CORTEX_TOKEN");
      expect(text).toContain("CORTEX_TOKEN      Access token");
      expect(text).not.toContain("has no auth");
    } finally {
      log.mockRestore();
    }
  });
});

describe("rax cortex argv", () => {
  it("leaves host unset by default (server binds 127.0.0.1)", () => {
    expect(parseCortexArgv([]).host).toBeUndefined();
  });

  it("--host sets the listen address", () => {
    expect(parseCortexArgv(["--host", "0.0.0.0", "--port", "4400"])).toMatchObject({ host: "0.0.0.0", port: 4400 });
  });

  it("--host without a value is an error", () => {
    expect(() => parseCortexArgv(["--host"])).toThrow("--host requires a value");
    expect(() => parseCortexArgv(["--host", "--no-open"])).toThrow("--host requires a value");
  });
});
