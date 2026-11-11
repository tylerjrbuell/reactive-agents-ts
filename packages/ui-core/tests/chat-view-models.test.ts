import { describe, expect, test } from "bun:test";
import {
  argHint,
  buildTurnSteps,
  findSubAgentGroup,
  finishTurnTrace,
  formatTurnDuration,
  foldTurnTrace,
  goalSummaryOf,
  initialTurnTrace,
  isImplicitRequirement,
  subAgentCardOf,
  subAgentRollup,
  toolBadgesOf,
  turnStrategiesOf,
  type ChecklistGroupWire,
  type ChecklistRowWire,
  type StepCall,
  type UiStreamEvent,
} from "../src/index.js";

const c = (id: string, name: string, iteration: number, status: StepCall["status"] = "done"): StepCall => ({ id, name, iteration, status });
const steps = (calls: StepCall[]) => buildTurnSteps({ iterations: [], calls });

describe("toolBadgesOf", () => {
  test("one badge per tool with counts; a fixed failure is fixed, not failed", () => {
    const b = toolBadgesOf(
      steps([c("1", "web-search", 1), c("2", "web-search", 1), c("3", "fetch", 2, "failed"), c("4", "fetch", 3), c("5", "srv/get_price", 3)]),
    );
    expect(b.badges.map((x) => [x.name, x.count, x.tone])).toEqual([
      ["web-search", 2, "ok"],
      ["fetch", 2, "fixed"],
      ["get_price", 1, "ok"],
    ]);
    expect(b.unfixed).toBe(0);
    expect(b.tone).toBe("fixed");
    expect(b.badges[1]!.label).toBe("fetch ×2 · 1 failed, 1 fixed");
  });

  test("an unfixed failure colours the group and never hides behind the overflow", () => {
    const b = toolBadgesOf(steps([c("1", "a", 1), c("2", "b", 1), c("3", "c", 1), c("4", "d", 1, "failed")]), { max: 2 });
    expect(b.badges.map((x) => x.name)).toEqual(["a", "d"]);
    expect(b.badges.find((x) => x.name === "d")!.tone).toBe("failed");
    expect(b.overflow).toBe(2);
    expect(b.overflowNames).toEqual(["b", "c"]);
    expect(b.unfixed).toBe(1);
    expect(b.tone).toBe("failed");
  });

  test("running call marks badge and group running", () => {
    const b = toolBadgesOf(steps([c("1", "a", 1, "running")]));
    expect(b.badges[0]!.running).toBe(true);
    expect(b.tone).toBe("running");
  });
});

const row = (id: string, status: ChecklistRowWire["status"], kind: ChecklistRowWire["kind"] = "requirement"): ChecklistRowWire => ({
  id,
  kind,
  title: id,
  status,
});

describe("goalSummaryOf (implicit floor requirement)", () => {
  test("only the floor requirement: nothing to show", () => {
    const g = goalSummaryOf({ rows: [row("answer", "done")] }, { ended: true });
    expect(isImplicitRequirement(row("answer", "pending"))).toBe(true);
    expect(g).toMatchObject({ show: false, status: "none", label: "", total: 0 });
  });

  test("a blocked floor requirement shows", () => {
    const g = goalSummaryOf({ rows: [row("answer", "blocked")] });
    expect(g).toMatchObject({ show: true, status: "unmet", label: "Goal check failed" });
  });

  test("explicit goals count; the floor never does", () => {
    const rows = [row("answer", "done"), row("req-tool-web-search", "done"), row("artifact-1", "pending"), row("todo", "pending", "advisory")];
    expect(goalSummaryOf({ rows })).toMatchObject({ show: true, done: 1, total: 2, status: "pending", label: "Goals 1/2" });
    expect(goalSummaryOf({ rows }, { ended: true }).status).toBe("unmet");
    expect(goalSummaryOf({ rows: rows.map((r) => ({ ...r, status: "done" as const })) }).status).toBe("met");
  });
});

const group = (key: string, label: string, children: ChecklistGroupWire[] = []): ChecklistGroupWire => ({
  key,
  label,
  rows: [],
  requirements: { done: 0, total: 0 },
  advisory: { done: 0, total: 0 },
  activeAdvisoryIds: [],
  children,
});

describe("findSubAgentGroup", () => {
  test("matches the live key suffix, then a unique name, at any depth", () => {
    const root = group("root", "root", [
      group("sub-agent:btc#t1", "btc"),
      group("sub-agent:eth#t2", "eth", [group("sub-agent:eth#t2/sub-agent:deep", "deep")]),
      group("sub-agent:btc#t3", "btc"),
    ]);
    expect(findSubAgentGroup(root, { key: "t3", name: "btc" })?.key).toBe("sub-agent:btc#t3");
    expect(findSubAgentGroup(root, { key: "x", name: "deep" })?.label).toBe("deep");
    expect(findSubAgentGroup(root, { key: "x", name: "btc" })).toBeUndefined();
  });
});

describe("subAgentCardOf", () => {
  const call = (id: string, name: string, status: StepCall["status"], args?: unknown) => ({ id, name, status, iteration: 1, args });

  test("running: the running call with a short hint, never JSON", () => {
    const card = subAgentCardOf(
      { name: "btc", status: "running", startedAt: 1000, calls: [call("1", "web-search", "running", { query: "bitcoin price today", limit: 5 })] },
      13_000,
    );
    expect(card.activity).toBe("web-search “bitcoin price today”");
    expect(card.activity).not.toContain("{");
    expect(card.meta).toBe("1 tool · 12s");
    expect(card.state).toBe("running");
  });

  test("done: first output line, markdown stripped; cost and goals carried", () => {
    const card = subAgentCardOf(
      { name: "eth", status: "done", startedAt: 1000, endedAt: 65_000, costUsd: 0.0042, calls: [call("1", "a", "done"), call("2", "a", "failed")], output: "\n## **ETH** at $3,100\nmore", goals: "met" },
      0,
    );
    expect(card).toMatchObject({ activity: "ETH at $3,100", durationLabel: "1m 04s", costLabel: "$0.004", failedCalls: 1, goals: "met" });
  });

  test("abstained reads as abstained with its reason", () => {
    const card = subAgentCardOf({ name: "x", status: "failed", ending: "abstained", startedAt: 0, calls: [], reason: "No source for the price" }, 0);
    expect(card.state).toBe("abstained");
    expect(card.activity).toBe("No source for the price");
    expect(card.durationLabel).toBe("");
  });

  test("failed with no reported reason: the last failed call says why", () => {
    const card = subAgentCardOf(
      { name: "sol", status: "failed", startedAt: 0, calls: [{ id: "1", name: "http-get", status: "failed", error: "[Tool error: 429 Too Many Requests]" }] },
      0,
    );
    expect(card.activity).toBe("http-get: 429 Too Many Requests");
  });

  test("argHint: string args, JSON strings, unknown shapes", () => {
    expect(argHint('{"url":"https://example.com"}')).toBe("“https://example.com”");
    expect(argHint("plain text")).toBe("“plain text”");
    expect(argHint({ n: 3 })).toBe("");
    expect(argHint(["a"])).toBe("");
  });

  test("rollup", () => {
    expect(subAgentRollup([{ state: "running" }, { state: "done" }, { state: "failed" }, { state: "running" }]).label).toBe("4 agents · 2 running · 1 failed");
    expect(subAgentRollup([{ state: "done" }]).label).toBe("1 agent");
  });
});

describe("turn strategy", () => {
  const completed = (strategyUsed?: string): UiStreamEvent => ({
    _tag: "StreamCompleted",
    output: "ok",
    metadata: { duration: 1, ...(strategyUsed ? { strategyUsed } : {}) },
  });

  test("the fold records the reported strategy and persists it", () => {
    const s = foldTurnTrace(initialTurnTrace(), completed("plan-execute-reflect"));
    expect(s.strategy).toBe("plan-execute-reflect");
    expect(finishTurnTrace(s)?.strategy).toBe("plan-execute-reflect");
    expect(foldTurnTrace(initialTurnTrace(), completed()).strategy).toBeUndefined();
  });

  test("the fold records the reported duration and persists it", () => {
    const s = foldTurnTrace(initialTurnTrace(), { _tag: "StreamCompleted", output: "ok", metadata: { duration: 42_000 } });
    expect(s.durationMs).toBe(42_000);
    expect(finishTurnTrace(s)?.durationMs).toBe(42_000);
  });

  test("formatTurnDuration: 12s, 2m 05s, 1h 02m", () => {
    expect(formatTurnDuration(12_400)).toBe("12s");
    expect(formatTurnDuration(125_000)).toBe("2m 05s");
    expect(formatTurnDuration(3_720_000)).toBe("1h 02m");
    expect(formatTurnDuration(-5)).toBe("0s");
    expect(formatTurnDuration(Number.NaN)).toBe("0s");
  });

  test("turnStrategiesOf: main plus distinct delegated strategies at any depth", () => {
    type N = { strategy?: string; kids: N[] };
    const t: N = { strategy: "reactive", kids: [{ strategy: "reactive", kids: [{ strategy: "reflexion", kids: [] }] }, { strategy: "plan-execute", kids: [] }, { kids: [] }] };
    expect(turnStrategiesOf(t, (n) => n.kids)).toEqual({ main: "reactive", delegated: ["reflexion", "plan-execute"] });
  });
});
