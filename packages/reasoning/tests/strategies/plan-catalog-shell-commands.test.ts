// Run: bun test packages/reasoning/tests/strategies/plan-catalog-shell-commands.test.ts --timeout 20000
//
// A planner that cannot see what the shell tool may run plans "gh --version" /
// "gh auth status" steps only to confirm access. The tool's `commandPolicy` is
// now rendered by the ONE catalog renderer (renderCatalog) and the plan-posture
// catalog line, with PATH availability, plus one rule against availability-check
// steps. A catalog with no command policy renders byte-identically to before.
import { describe, it, expect } from "bun:test";
import { renderCatalog, buildPlanProducerContext, renderPlanProducerContext } from "../../src/kernel/policy/plan-producer-context.js";
import { planToolCatalogLine } from "../../src/kernel/policy/plan-steps.js";
import { shellCommandsText, COMMANDS_LISTED_RULE } from "../../src/kernel/policy/shell-commands-text.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

// `sh` exists on every POSIX PATH; the other name does not exist anywhere.
const POLICY = { allowedCommands: ["sh", "zz-missing-cmd"], notEnabledCommands: ["curl"], sandbox: "host" as const, workingDirectory: "the project root" };

const SHELL: ToolSchema = {
  name: "shell-execute",
  description: "Run an allowed shell command.",
  parameters: [{ name: "command", type: "string", required: true }],
  effect: "write",
  commandPolicy: POLICY,
};
const ADD: ToolSchema = { name: "add", description: "Add two numbers", parameters: [{ name: "a", type: "number", required: true }, { name: "b", type: "number", required: true }], effect: "read" };

describe("shellCommandsText", () => {
  it("splits allowed commands by PATH presence and names the not-enabled ones", () => {
    expect(shellCommandsText(POLICY)).toBe("commands on PATH: sh; not installed: zz-missing-cmd; not enabled: curl");
  });
  it("skips the PATH split for a docker sandbox (the container's PATH is not ours)", () => {
    expect(shellCommandsText({ ...POLICY, sandbox: "docker" })).toBe("commands: sh, zz-missing-cmd; not enabled: curl");
  });
  it("is absent without a policy or with nothing to say", () => {
    expect(shellCommandsText(undefined)).toBeUndefined();
    expect(shellCommandsText({ ...POLICY, allowedCommands: [], notEnabledCommands: [] })).toBeUndefined();
  });
});

describe("renderCatalog (blueprint, plan-execute, patch, augment)", () => {
  it("adds one commands line under a tool that has a command policy", () => {
    const out = renderCatalog(buildPlanProducerContext({ schemas: [SHELL, ADD], now: new Date("2026-11-17T12:00:00Z"), timeZone: "UTC" }).tools);
    // The short description repeats the name ("shell"), so the blurb is elided (toolBlurb).
    expect(out).toContain("- shell-execute(command) [w]\n    commands on PATH: sh; not installed: zz-missing-cmd; not enabled: curl");
  });
  it("renders a catalog with no command policy exactly as before", () => {
    expect(renderCatalog(buildPlanProducerContext({ schemas: [ADD], now: new Date("2026-11-17T12:00:00Z"), timeZone: "UTC" }).tools)).toBe("- add(a, b) [r]");
  });
});

describe("planner rule against availability-check steps", () => {
  const ctxOf = (schemas: readonly ToolSchema[]) => buildPlanProducerContext({ schemas, now: new Date("2026-11-17T12:00:00Z"), timeZone: "UTC" });
  it("is told only when a tool lists its commands", () => {
    expect(renderPlanProducerContext(ctxOf([SHELL, ADD]))).toContain(COMMANDS_LISTED_RULE);
    expect(renderPlanProducerContext(ctxOf([ADD]))).not.toContain(COMMANDS_LISTED_RULE);
  });
});

describe("plan-posture catalog line", () => {
  it("lists shell-execute by name with its commands, still not callable in the plan turn", () => {
    const line = planToolCatalogLine([SHELL, ADD]);
    expect(line).toContain("shell-execute (Run an allowed shell command; commands on PATH: sh; not installed: zz-missing-cmd; not enabled: curl)");
    expect(line).toContain("You cannot call these now");
    expect(line).toContain(COMMANDS_LISTED_RULE);
  });
  it("is unchanged for tools without a command policy", () => {
    const line = planToolCatalogLine([ADD]);
    expect(line).toBe("Execute-phase tools: add (Add two numbers). You cannot call these now; reference them in steps as `tool: name`.");
  });
  it("reaches the posture through the shared context", () => {
    expect(buildPlanProducerContext({ schemas: [SHELL], now: new Date("2026-11-17T12:00:00Z"), timeZone: "UTC" }).catalogLine).toContain("shell-execute (");
  });
});
