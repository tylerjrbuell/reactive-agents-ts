// Run: bun run repo test apps/cortex/server/tests/approval-policy.test.ts
//
// approvalPolicyOf is the one reader of the approval gate (framework
// AgentConfig.approvalPolicy: mode, tools, commands) across chat, desk runs and
// gateway agents, including the legacy shapes stored under durableRuns.
import { describe, expect, it } from "bun:test";
import { approvalPolicyOf, asksBeforeRiskyTools, effectiveApprovalPolicy } from "../services/approval-policy.js";
import { approvalRequiredToolNames } from "../services/tool-catalog.js";

describe("approvalPolicyOf", () => {
  it("reads the top-level framework shape; mode defaults to detach", () => {
    expect(approvalPolicyOf({ approvalPolicy: { tools: ["file-write"], commands: ["git push"] } }))
      .toEqual({ mode: "detach", tools: ["file-write"], commands: ["git push"] });
    expect(approvalPolicyOf({ approvalPolicy: { mode: "block", commands: ["gh pr create"] } }))
      .toEqual({ mode: "block", commands: ["gh pr create"] });
  });

  it("trims, collapses spaces, drops empties and duplicates", () => {
    expect(approvalPolicyOf({ approvalPolicy: { commands: ["  git   push ", "", "git push", 3] } }))
      .toEqual({ mode: "detach", commands: ["git push"] });
  });

  it("is undefined when nothing is gated", () => {
    expect(approvalPolicyOf({})).toBeUndefined();
    expect(approvalPolicyOf({ approvalPolicy: { mode: "detach", tools: [], commands: [] } })).toBeUndefined();
  });

  it("reads the legacy durableRuns shapes only while durable runs are on", () => {
    expect(approvalPolicyOf({ durableRuns: { enabled: true, approvalTools: ["x"], approvalMode: "block" } }))
      .toEqual({ mode: "block", tools: ["x"] });
    expect(approvalPolicyOf({ durableRuns: { enabled: true, approvalPolicy: { tools: ["y"] } } }))
      .toEqual({ mode: "detach", tools: ["y"] });
    expect(approvalPolicyOf({ durableRuns: { enabled: false, approvalTools: ["x"] } })).toBeUndefined();
  });

  it("the top-level policy wins over a legacy one, even when it clears the gate", () => {
    const legacy = { enabled: true, approvalTools: ["x"] };
    expect(approvalPolicyOf({ approvalPolicy: { commands: ["git commit"] }, durableRuns: legacy }))
      .toEqual({ mode: "detach", commands: ["git commit"] });
    expect(approvalPolicyOf({ approvalPolicy: { tools: [] }, durableRuns: legacy })).toBeUndefined();
  });
});

describe("approvalRequiredToolNames", () => {
  it("lists the framework tools flagged requiresApproval, the full shell included", () => {
    const names = approvalRequiredToolNames();
    expect(names).toEqual(expect.arrayContaining(["file-write", "shell-execute"]));
    expect(names).not.toContain("web-search");
  });
});

describe("effectiveApprovalPolicy (Cortex asks before risky tools by default)", () => {
  it("an empty config gets a rule-less detach policy: the framework then gates every requiresApproval tool", () => {
    expect(effectiveApprovalPolicy({})).toEqual({ mode: "detach" });
    expect(effectiveApprovalPolicy({ askBeforeRiskyTools: true })).toEqual({ mode: "detach" });
  });

  it("only a literal false opts out", () => {
    expect(effectiveApprovalPolicy({ askBeforeRiskyTools: false })).toBeUndefined();
    expect(effectiveApprovalPolicy({ askBeforeRiskyTools: "false" })).toEqual({ mode: "detach" });
    expect(asksBeforeRiskyTools({ askBeforeRiskyTools: false })).toBe(false);
    expect(asksBeforeRiskyTools({})).toBe(true);
  });

  it("a headless surface (gateway) blocks instead of waiting for a person who is not there", () => {
    expect(effectiveApprovalPolicy({}, { headless: true })).toEqual({ mode: "block" });
    expect(effectiveApprovalPolicy({ askBeforeRiskyTools: false }, { headless: true })).toBeUndefined();
  });

  it("an explicit policy wins over the default, whatever the surface", () => {
    const cfg = { approvalPolicy: { mode: "detach", commands: ["git push"] } };
    expect(effectiveApprovalPolicy(cfg, { headless: true })).toEqual({ mode: "detach", commands: ["git push"] });
    expect(effectiveApprovalPolicy({ ...cfg, askBeforeRiskyTools: false })).toEqual({ mode: "detach", commands: ["git push"] });
  });
});
