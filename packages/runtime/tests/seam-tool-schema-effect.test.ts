/**
 * Seam pin: the tool definition's effect class reaches the kernel's `ToolSchema`.
 *
 * Plan recon (kernel `policy/plan-recon.ts`) runs only tools whose schema
 * `effect` is `read`. `toKernelToolSchema` is the one projection; cutting its
 * `effect: toolEffect(t)` line leaves every tool `effect`-less, so recon never
 * finds a callable tool in a live run (RED-on-cut).
 */
import { describe, it, expect } from "bun:test";
import type { ToolDefinition } from "@reactive-agents/tools";
import { toKernelToolSchema } from "../src/engine/phases/agent-loop/setup/tool-schemas.js";

const def = (name: string, extra: Partial<ToolDefinition>): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  parameters: [],
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  ...extra,
});

describe("toKernelToolSchema effect", () => {
  it("a declared read-only tool without approval is read", () => {
    expect(toKernelToolSchema(def("list", { mutatesExternalState: false })).effect).toBe("read");
  });

  it("a state-changing tool is write", () => {
    expect(toKernelToolSchema(def("delete", { mutatesExternalState: true })).effect).toBe("write");
  });

  it("an undeclared tool is unknown", () => {
    expect(toKernelToolSchema(def("mystery", {})).effect).toBe("unknown");
  });

  it("an approval-gated read-only tool stays unknown", () => {
    expect(
      toKernelToolSchema(def("gated-list", { mutatesExternalState: false, requiresApproval: true })).effect,
    ).toBe("unknown");
  });
});
