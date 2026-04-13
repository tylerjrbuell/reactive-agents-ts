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
      skills: { paths: ["./x"], evolution: { mode: "auto" } },
    });
    expect(out.skills).toEqual({ paths: ["./x"], evolution: { mode: "auto" } });
  });

  test("normalizes agentTools and dynamicSubAgents", () => {
    const out = normalizeCortexAgentConfig({
      agentTools: [
        { kind: "local", toolName: "a", agent: { name: "A", maxIterations: 4, tools: ["web-search"] } },
        { kind: "remote", toolName: "r", remoteUrl: "http://x" },
      ],
      dynamicSubAgents: { enabled: true, maxIterations: 3 },
    });
    expect(out.agentTools).toHaveLength(2);
    expect((out.agentTools as Array<{ kind: string }>)[0]!.kind).toBe("local");
    expect(out.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 3 });
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

  test("includes evolution when present", () => {
    const sk = parseCortexSkillsConfig({
      paths: ["./s"],
      evolution: { mode: "suggest", refinementThreshold: 5, rollbackOnRegression: true },
    });
    expect(sk?.evolution?.mode).toBe("suggest");
    expect(sk?.evolution?.refinementThreshold).toBe(5);
    expect(sk?.evolution?.rollbackOnRegression).toBe(true);
  });
});

describe("mergeCortexAllowedTools", () => {
  test("adds kernel completion tools to user selection", () => {
    const merged = mergeCortexAllowedTools(["web-search"], undefined);
    expect(merged).toEqual(
      expect.arrayContaining([
        "web-search",
        "final-answer",
        "task-complete",
        "context-status",
      ]),
    );
    expect(merged).toHaveLength(4);
  });

  test("includes conductor tools when metaTools enabled and flagged", () => {
    const merged = mergeCortexAllowedTools(["file-read"], {
      enabled: true,
      recall: true,
      find: true,
      brief: false,
      pulse: false,
    });
    expect(merged).toEqual(
      expect.arrayContaining(["file-read", "recall", "find", "final-answer"]),
    );
    expect(merged).not.toContain("brief");
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
