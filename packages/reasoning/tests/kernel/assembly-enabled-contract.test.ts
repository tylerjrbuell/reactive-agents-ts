import { describe, it, expect } from "bun:test";
import { assemblyEnabled } from "../../src/kernel/capabilities/reason/think-guards.js";

/**
 * Pins the RA_ASSEMBLY default-on/opt-out contract (flipped 2026-05-31 after the
 * hardened cross-tier grid: wiki/Research/Harness-Reports/assembly-ab-grid-hardened-
 * 2026-05-31.md). project() is now the DEFAULT reactive assembler; legacy curate()
 * is reachable ONLY via the RA_ASSEMBLY=0 killswitch (deletion deferred). This locks
 * that contract so a future env-handling change can't silently revert the flip.
 */
describe("assemblyEnabled — RA_ASSEMBLY default-on contract", () => {
  it("DEFAULT-ON: unset env → project() path", () => {
    expect(assemblyEnabled({})).toBe(true);
  });

  it("OPT-OUT: RA_ASSEMBLY=0 → legacy curate() killswitch", () => {
    expect(assemblyEnabled({ RA_ASSEMBLY: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("explicit on: RA_ASSEMBLY=1 → project()", () => {
    expect(assemblyEnabled({ RA_ASSEMBLY: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("any non-\"0\" value stays on (only \"0\" opts out)", () => {
    expect(assemblyEnabled({ RA_ASSEMBLY: "" } as NodeJS.ProcessEnv)).toBe(true);
    expect(assemblyEnabled({ RA_ASSEMBLY: "false" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
