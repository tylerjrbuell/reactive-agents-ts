import { describe, expect, test } from "bun:test";
import {
  mergeCortexAllowedTools,
  normalizeCortexAgentConfig,
  parseCortexSkillsConfig,
} from "../services/cortex-agent-config.js";

describe("normalizeCortexAgentConfig", () => {
  test("coerces numeric fields from strings", () => {
    const out = normalizeCortexAgentConfig({
      temperature: "0",
      maxTokens: "4096",
      maxIterations: "12",
      timeout: "30000",
    });
    expect(out.temperature).toBe(0);
    expect(out.maxTokens).toBe(4096);
    expect(out.maxIterations).toBe(12);
    expect(out.timeout).toBe(30000);
  });

  test("preserves temperature 0 (not treated as missing)", () => {
    const out = normalizeCortexAgentConfig({ temperature: 0 });
    expect(out.temperature).toBe(0);
  });

  test("normalizes tools to string array", () => {
    const out = normalizeCortexAgentConfig({
      tools: ["web-search", "", "file-read"],
    });
    expect(out.tools).toEqual(["web-search", "file-read"]);
  });

  test("maps strategy alias react → reactive (framework registry name)", () => {
    const out = normalizeCortexAgentConfig({ strategy: "react" });
    expect(out.strategy).toBe("reactive");
  });

  test("normalizes retryPolicy numbers and enabled flag", () => {
    const out = normalizeCortexAgentConfig({
      retryPolicy: { enabled: true, maxRetries: "3", backoffMs: "500" },
    });
    expect(out.retryPolicy).toEqual({
      enabled: true,
      maxRetries: 3,
      backoffMs: 500,
    });
  });

  test("coerces taskContext to string record and drops empty", () => {
    const out = normalizeCortexAgentConfig({
      taskContext: { project: "acme", count: 3 as unknown as string },
    });
    expect(out.taskContext).toEqual({ project: "acme", count: "3" });
    const empty = normalizeCortexAgentConfig({ taskContext: {} });
    expect(empty.taskContext).toBeUndefined();
  });

  test("preserves healthCheck when true", () => {
    expect(normalizeCortexAgentConfig({ healthCheck: true }).healthCheck).toBe(true);
    expect(normalizeCortexAgentConfig({ healthCheck: false }).healthCheck).toBeUndefined();
  });

  test("normalizeCortexAgentConfig parses skills", () => {
    const out = normalizeCortexAgentConfig({
      skills: { paths: ["./x"], activate: ["my-skill"] },
    });
    expect(out.skills).toEqual({ paths: ["./x"], activate: ["my-skill"] });
  });

  test("normalizeCortexAgentConfig never forwards a removed 'evolution' skills key (withSkills throws on it, v0.14 P0-10)", () => {
    const out = normalizeCortexAgentConfig({
      skills: { paths: ["./x"], evolution: { mode: "auto" } },
    });
    expect(out.skills).toEqual({ paths: ["./x"] });
  });

  test("normalizes agentTools and dynamicSubAgents", () => {
    const out = normalizeCortexAgentConfig({
      agentTools: [
        { kind: "local", toolName: "a", agent: { name: "A", maxIterations: 4, tools: ["web-search"] } },
        { kind: "remote", toolName: "r", remoteUrl: "http://x" },
      ],
      dynamicSubAgents: { enabled: true, maxIterations: 3, maxRecursionDepth: 2 },
    });
    expect(out.agentTools).toHaveLength(2);
    expect((out.agentTools as Array<{ kind: string }>)[0]!.kind).toBe("local");
    expect(out.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 3, maxRecursionDepth: 2 });
    // No depth set = children cannot spawn their own (framework default): nothing sent.
    expect(normalizeCortexAgentConfig({ dynamicSubAgents: { enabled: true, maxRecursionDepth: 0 } }).dynamicSubAgents).toEqual({ enabled: true });
  });

  test("preserves strategySwitching only when explicitly provided", () => {
    const absent = normalizeCortexAgentConfig({ provider: "test" });
    expect(absent.strategySwitching).toBeUndefined();

    const on = normalizeCortexAgentConfig({ strategySwitching: true });
    expect(on.strategySwitching).toBe(true);

    const off = normalizeCortexAgentConfig({ strategySwitching: false });
    expect(off.strategySwitching).toBe(false);
  });

  test("preserves streamReasoningSteps only when explicitly provided", () => {
    const absent = normalizeCortexAgentConfig({ provider: "test" });
    expect(absent.streamReasoningSteps).toBeUndefined();

    const on = normalizeCortexAgentConfig({ streamReasoningSteps: true });
    expect(on.streamReasoningSteps).toBe(true);

    const off = normalizeCortexAgentConfig({ streamReasoningSteps: false });
    expect(off.streamReasoningSteps).toBe(false);
  });
});

describe("parseCortexSkillsConfig", () => {
  test("requires non-empty paths", () => {
    expect(parseCortexSkillsConfig(null)).toBeUndefined();
    expect(parseCortexSkillsConfig({ paths: [] })).toBeUndefined();
    expect(parseCortexSkillsConfig({ paths: [" ./a ", "b"] })?.paths).toEqual(["./a", "b"]);
  });

  test("includes activate when present", () => {
    const sk = parseCortexSkillsConfig({ paths: ["./s"], activate: ["a", "b"] });
    expect(sk?.activate).toEqual(["a", "b"]);
  });

  test("drops a removed 'evolution' key rather than forwarding it (withSkills throws on it, v0.14 P0-10)", () => {
    const sk = parseCortexSkillsConfig({
      paths: ["./s"],
      evolution: { mode: "suggest", refinementThreshold: 5, rollbackOnRegression: true },
    });
    expect(sk).toEqual({ paths: ["./s"] });
  });
});

describe("mergeCortexAllowedTools", () => {
  test("whitelists exactly the user selection plus kernel completion tools", () => {
    const merged = mergeCortexAllowedTools(["web-search"], undefined);
    expect([...merged].sort()).toEqual(
      ["context-status", "final-answer", "task-complete", "web-search"].sort(),
    );
  });

  test("never adds capability builtins the user did not select", () => {
    const merged = mergeCortexAllowedTools(["web-search"], undefined);
    // `git` is a shell toolset (scoped shell-execute; `workspace` was one, now retired); like the shell, never implicit.
    for (const t of ["file-write", "code-execute", "http-get", "shell-execute", "git", "workspace", "crypto-price"]) {
      expect(merged).not.toContain(t);
    }
  });

  test("adds conductor meta-tools only when enabled and individually switched on", () => {
    const merged = mergeCortexAllowedTools(["file-read"], {
      enabled: true,
      recall: true,
      find: true,
      brief: false,
      pulse: false,
    });
    expect(merged).toEqual(expect.arrayContaining(["file-read", "recall", "find"]));
    expect(merged).not.toContain("brief");
    expect(merged).not.toContain("pulse");
    expect(mergeCortexAllowedTools(["file-read"], { enabled: false, recall: true })).not.toContain("recall");
  });

  test("deduplicates user tool names", () => {
    const merged = mergeCortexAllowedTools(["web-search", "web-search"], undefined);
    expect(merged.filter((n) => n === "web-search")).toHaveLength(1);
  });

  test("adds spawn-agent and static sub-agent tool names via extras", () => {
    const merged = mergeCortexAllowedTools(["web-search"], undefined, {
      spawnAgent: true,
      agentToolNames: ["researcher"],
    });
    expect(merged).toEqual(expect.arrayContaining(["spawn-agent", "researcher", "final-answer"]));
  });
});

describe("normalizeCortexAgentConfig — v0.12 fields (saved-agent durable/structured)", () => {
  type Normalized = { durableRuns?: Record<string, unknown>; approvalPolicy?: unknown };
  test("migrates the old Lab shape durableRuns.approvalTools → top-level approvalPolicy", () => {
    const out = normalizeCortexAgentConfig({
      provider: "ollama",
      durableRuns: { enabled: true, approvalTools: ["file-read", "shell-execute"] },
    }) as Normalized;
    expect(out.durableRuns).toEqual({ enabled: true });
    expect(out.approvalPolicy).toEqual({ mode: "detach", tools: ["file-read", "shell-execute"] });
  });
  test("migrates the old build shape durableRuns.approvalPolicy too", () => {
    const out = normalizeCortexAgentConfig({
      provider: "ollama",
      durableRuns: { enabled: true, approvalPolicy: { tools: ["x"], mode: "block" } },
    }) as Normalized;
    expect(out.durableRuns).toEqual({ enabled: true });
    expect(out.approvalPolicy).toEqual({ mode: "block", tools: ["x"] });
  });
  test("an old gate under disabled durableRuns stays off (it never applied)", () => {
    const out = normalizeCortexAgentConfig({
      provider: "ollama",
      durableRuns: { enabled: false, approvalTools: ["file-write"] },
    }) as Normalized;
    expect(out.approvalPolicy).toBeUndefined();
  });
  test("askBeforeRiskyTools keeps only a literal false; true or junk is dropped (the default is on)", () => {
    expect((normalizeCortexAgentConfig({ provider: "ollama", askBeforeRiskyTools: false }) as { askBeforeRiskyTools?: unknown }).askBeforeRiskyTools).toBe(false);
    for (const v of [true, "false", 0, null]) {
      expect("askBeforeRiskyTools" in normalizeCortexAgentConfig({ provider: "ollama", askBeforeRiskyTools: v })).toBe(false);
    }
  });
  test("round-trips approvalPolicy with command rules; the top level wins over a legacy gate", () => {
    const saved = {
      provider: "ollama",
      approvalPolicy: { mode: "detach", tools: ["file-write"], commands: ["git commit", "gh pr create"] },
      durableRuns: { enabled: true, approvalTools: ["web-search"] },
    };
    const once = normalizeCortexAgentConfig(saved) as Normalized;
    expect(once.approvalPolicy).toEqual({ mode: "detach", tools: ["file-write"], commands: ["git commit", "gh pr create"] });
    // Stored then read back: unchanged.
    expect((normalizeCortexAgentConfig(JSON.parse(JSON.stringify(once)) as Record<string, unknown>) as Normalized).approvalPolicy)
      .toEqual(once.approvalPolicy);
  });
  test("an approvalPolicy with no tools and no rules is dropped (any policy also gates requiresApproval tools)", () => {
    const out = normalizeCortexAgentConfig({ provider: "ollama", approvalPolicy: { mode: "block", tools: [], commands: ["  "] } }) as Normalized;
    expect(out.approvalPolicy).toBeUndefined();
  });
  test("keeps an explicit durableRuns off (durable is the default)", () => {
    const out = normalizeCortexAgentConfig({ provider: "ollama", durableRuns: { enabled: false } }) as { durableRuns?: unknown };
    expect(out.durableRuns).toEqual({ enabled: false });
  });
  test("persists outputSchema", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const out = normalizeCortexAgentConfig({ provider: "ollama", outputSchema: schema }) as { outputSchema?: unknown };
    expect(out.outputSchema).toEqual(schema);
  });
});

describe("normalizeCortexAgentConfig — budget 0 = unset (regression: budget_exceeded@0)", () => {
  test("drops budget when both limits are 0 (UI default)", () => {
    const out = normalizeCortexAgentConfig({ provider: "ollama", budget: { tokenLimit: 0, costLimit: 0 } }) as { budget?: unknown };
    expect(out.budget).toBeUndefined();
  });
  test("keeps only the positive limit", () => {
    const out = normalizeCortexAgentConfig({ provider: "ollama", budget: { tokenLimit: 5000, costLimit: 0 } }) as { budget?: { tokenLimit?: number; costLimit?: number } };
    expect(out.budget?.tokenLimit).toBe(5000);
    expect(out.budget?.costLimit).toBeUndefined();
  });
})
