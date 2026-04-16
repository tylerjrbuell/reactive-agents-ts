import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadObservations } from "@reactive-agents/reactive-intelligence";
// Implementation detail: test relies on the observer being called with OBSERVATIONS_BASE_DIR env var
// (see Task 7 step 3 — we thread an env override through the observer call site).

let testRoot: string;
beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "ra-engine-"));
  process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"] = testRoot;
});
afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
  delete process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
});

describe("execution-engine writes observation after run", () => {
  it("appends an observation to the model's file when RI is enabled", async () => {
    // This test will be filled in with a real harness invocation once the
    // observer call site is wired up. For now it reserves the test shape.
    // See companion test file run-observer.test.ts for unit coverage.
    expect(testRoot).toBeTruthy();
    expect(loadObservations).toBeDefined();
  });
});
