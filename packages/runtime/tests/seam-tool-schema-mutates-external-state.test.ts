/**
 * Seam pin: `ToolDefinition.mutatesExternalState` reaches the kernel tool schema.
 *
 * The kernel's iteration-0 satisfiability preflight needs to tell "only read-only tools are visible
 * for an action task" from "an action tool is visible". The runtime projects `ToolDefinition` into
 * the kernel `ToolSchema` in one place, `toKernelToolSchema`; dropping the field there leaves the
 * preflight blind.
 */
import { describe, it, expect } from "bun:test";
import type { ToolDefinition } from "@reactive-agents/tools";
import { toKernelToolSchema } from "../src/engine/phases/agent-loop/setup/tool-schemas.js";

const def = (mutates: boolean | undefined): ToolDefinition => ({
  name: "probe",
  description: "Probe",
  parameters: [],
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  ...(mutates !== undefined ? { mutatesExternalState: mutates } : {}),
});

describe("toKernelToolSchema mutatesExternalState", () => {
  it("carries false (declared read-only) and true", () => {
    expect(toKernelToolSchema(def(false)).mutatesExternalState).toBe(false);
    expect(toKernelToolSchema(def(true)).mutatesExternalState).toBe(true);
  });

  it("leaves it absent when the definition does not declare it (unknown stays unknown)", () => {
    expect("mutatesExternalState" in toKernelToolSchema(def(undefined))).toBe(false);
  });
});
