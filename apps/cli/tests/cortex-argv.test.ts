// Run: bun test apps/cli/tests/cortex-argv.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { parseCortexArgv } from "../src/commands/cortex.js";

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
