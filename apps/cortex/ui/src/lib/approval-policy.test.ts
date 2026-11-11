import { describe, expect, it } from "bun:test";
import {
  addRule,
  approvalPolicyBody,
  approvalPolicyFrom,
  approvalSummary,
  autoGatedTools,
  defaultApprovalPolicy,
  gateableTools,
  hasFullShell,
  removeRule,
  ruleMatchesNothing,
  toggleGatedTool,
} from "./approval-policy.js";
import { hydrateAgentConfig } from "./types/agent-config.js";

describe("command rules", () => {
  it("normalizes on add and refuses duplicates and empties", () => {
    expect(addRule([], "  git   push ")).toEqual(["git push"]);
    expect(addRule(["git push"], "git push")).toEqual(["git push"]);
    expect(addRule(["git push"], "   ")).toEqual(["git push"]);
    expect(removeRule(["git push", "gh pr create"], "git push")).toEqual(["gh pr create"]);
  });
  it("a bare * (or a rule that is only *) matches nothing; a trailing * is harmless", () => {
    expect(ruleMatchesNothing("*")).toBe(true);
    expect(ruleMatchesNothing(" * ")).toBe(true);
    expect(ruleMatchesNothing("git push *")).toBe(false);
    expect(ruleMatchesNothing("git push")).toBe(false);
  });
});

describe("gateableTools / hasFullShell", () => {
  const presets = { git: ["git", "gh"] };
  it("shows a shell toolset pick as shell-execute, once", () => {
    expect(gateableTools(["web-search", "git"], false, presets)).toEqual(["web-search", "shell-execute"]);
    expect(gateableTools(["shell-execute", "git"], true, presets)).toEqual(["shell-execute"]);
    expect(gateableTools(["file-read"], false, presets)).toEqual(["file-read"]);
  });
  it("the full shell is the host-shell switch or a bare shell-execute pick", () => {
    expect(hasFullShell(["git"], false)).toBe(false);
    expect(hasFullShell(["git"], true)).toBe(true);
    expect(hasFullShell(["shell-execute"], false)).toBe(true);
  });
});

describe("autoGatedTools", () => {
  const required = ["file-write", "file-edit", "code-execute", "shell-execute"];
  it("is empty while nothing is gated (no policy, nothing folded)", () => {
    expect(autoGatedTools(defaultApprovalPolicy(), ["file-write"], true, required)).toEqual([]);
  });
  it("names the selected requiresApproval tools, and the full shell when it is on", () => {
    const p = { tools: [], commands: ["git commit"] };
    expect(autoGatedTools(p, ["file-write", "web-search"], false, required)).toEqual(["file-write"]);
    expect(autoGatedTools(p, ["git"], true, required)).toEqual(["shell-execute"]);
    expect(autoGatedTools(p, ["git"], false, required)).toEqual([]);
  });
});

describe("approvalPolicyBody", () => {
  it("sends only a gate that gates something, with an explicit mode and only matchable rules", () => {
    expect(approvalPolicyBody(defaultApprovalPolicy())).toBeUndefined();
    expect(approvalPolicyBody({ mode: "detach", tools: [], commands: ["*"] })).toBeUndefined();
    expect(approvalPolicyBody({ mode: "block", tools: ["file-write"], commands: [] })).toEqual({ mode: "block", tools: ["file-write"] });
    expect(approvalPolicyBody({ mode: "detach", tools: [], commands: ["git commit", "*"] })).toEqual({ mode: "detach", commands: ["git commit"] });
  });
});

describe("approvalPolicyFrom / hydrate (old saves migrate)", () => {
  it("reads the top-level shape", () => {
    expect(approvalPolicyFrom({ approvalPolicy: { mode: "block", tools: ["x"], commands: ["git push"] } }))
      .toEqual({ mode: "block", tools: ["x"], commands: ["git push"] });
  });
  it("reads the old Lab shape and the old server shape under enabled durableRuns", () => {
    expect(approvalPolicyFrom({ durableRuns: { enabled: true, approvalTools: ["file-write"], approvalMode: "block" } }))
      .toEqual({ mode: "block", tools: ["file-write"], commands: [] });
    expect(approvalPolicyFrom({ durableRuns: { enabled: true, approvalPolicy: { tools: ["y"], mode: "detach" } } }))
      .toEqual({ mode: "detach", tools: ["y"], commands: [] });
    expect(approvalPolicyFrom({ durableRuns: { enabled: false, approvalTools: ["z"] } })).toEqual(defaultApprovalPolicy());
  });
  it("hydrateAgentConfig carries the policy and leaves durableRuns as the on switch only", () => {
    const cfg = hydrateAgentConfig({ durableRuns: { enabled: true, approvalTools: ["file-write"] } });
    expect(cfg.durableRuns).toEqual({ enabled: true });
    expect(cfg.approvalPolicy).toEqual({ mode: "detach", tools: ["file-write"], commands: [] });
  });
});

describe("toggleGatedTool / approvalSummary", () => {
  it("toggles and summarizes", () => {
    expect(toggleGatedTool(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleGatedTool(["a", "b"], "a")).toEqual(["b"]);
    expect(approvalSummary(defaultApprovalPolicy())).toBe("off");
    expect(approvalSummary({ mode: "detach", tools: ["a"], commands: ["git push", "gh pr create"] })).toBe("1 tool · 2 commands · pause");
    expect(approvalSummary({ mode: "block", tools: [], commands: ["git push"] })).toBe("1 command · refuse");
  });
});
