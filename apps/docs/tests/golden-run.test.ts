import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { goldenRunProblems, MAX_MINORS_BEHIND } from "../scripts/golden-run-freshness";
import {
  buildTimelineSkeleton,
  exitDenialsFromTrace,
  toolStartsFromTrace,
  type HookEntry,
} from "../scripts/golden-run-timeline";
import { builderSnippet, highlightLine } from "../src/components/highlight-builder";

const cap = (frameworkVersion: string, capturedAt = "2026-11-17") => ({ capture: { frameworkVersion, capturedAt } });

describe("golden-run freshness guard", () => {
  it("passes when captured on the current minor", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), "0.18.0")).toEqual([]);
  });

  it("passes at exactly the allowed lag", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), `0.${18 + MAX_MINORS_BEHIND}.0`)).toEqual([]);
  });

  it("fails when a simulated newer version is more than two minors ahead", () => {
    const problems = goldenRunProblems("g", cap("0.18.0"), "0.21.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("3 minors behind");
  });

  it("fails on a major bump", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), "1.0.0")[0]).toContain("major differs");
  });

  it("fails when the capture block or date is missing", () => {
    expect(goldenRunProblems("g", {}, "0.18.0")[0]).toContain("capturedAt");
    expect(goldenRunProblems("g", cap("0.18.0", ""), "0.18.0")[0]).toContain("capturedAt");
    expect(goldenRunProblems("g", { capture: { capturedAt: "2026-11-17" } }, "0.18.0")[0]).toContain("frameworkVersion");
  });

  it("the committed data files carry capture provenance and are fresh against VERSION", () => {
    const dir = resolve(import.meta.dir, "../src/data");
    const version = readFileSync(resolve(import.meta.dir, "../../../VERSION"), "utf-8").trim();
    for (const f of ["golden-run.json", "golden-run-failed.json"]) {
      const data = JSON.parse(readFileSync(resolve(dir, f), "utf-8"));
      expect(goldenRunProblems(f, data, version)).toEqual([]);
    }
  });
});

describe("golden-run builder snippet", () => {
  it("highlights keyword, method, string and comment, and escapes markup", () => {
    expect(highlightLine(`const agent = await ReactiveAgents.create()`)).toBe(
      `<span class="rk">const</span> agent = <span class="rk">await</span> ReactiveAgents.<span class="rm">create</span>()`,
    );
    expect(highlightLine(`  .withModel("gemma4:e4b")`)).toBe(`  .<span class="rm">withModel</span>(<span class="rs">"gemma4:e4b"</span>)`);
    expect(highlightLine(`a < b // c`)).toBe(`a &lt; b <span class="rc">// c</span>`);
  });

  it("is derived from the captured lines, not hand-copied", () => {
    const data = JSON.parse(readFileSync(resolve(import.meta.dir, "../src/data/golden-run.json"), "utf-8"));
    const html = builderSnippet(data.capture.builderLines, data.task.prompt).join("\n");
    for (const line of data.capture.builderLines as string[]) {
      expect(html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<")).toContain(line);
    }
  });

  it("RunReplay no longer carries a hand-copied builder constant", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/components/RunReplay.astro"), "utf-8");
    expect(src).not.toContain("AGENT_CODE");
    expect(src).not.toContain('"gemma4:e4b"');
  });
});

describe("golden-run timeline pairing (tool name + time, not hook index)", () => {
  const dir = resolve(import.meta.dir, "../../../wiki/Research/Harness-Reports/golden-run-2026-11-17");
  const run = JSON.parse(readFileSync(resolve(dir, "run.json"), "utf-8"));
  const starts = toolStartsFromTrace(readFileSync(resolve(dir, "success-trace.jsonl"), "utf-8"));
  const names: string[] = run.result.metadata.toolCalls.map((t: { name: string }) => t.name);
  const t0 = run.hookLog.find((h: HookEntry) => h.timing === "before").t as number;

  it("puts each tool row at its real call time, not the N-th act hook", () => {
    const rows = buildTimelineSkeleton(run.hookLog, names, starts);
    const toolRows = rows.filter((r) => r.toolIndex !== null);
    expect(toolRows.map((r) => names[r.toolIndex!])).toEqual(["web-search", "file-write", "file-write"]);
    toolRows.forEach((r, i) => expect(Math.abs(r.atMs - (starts[i]!.t - t0))).toBeLessThanOrEqual(5));
    // report.md (2nd call) is its own turn, ~8 s after the search, not the same ms as the search observe.
    expect(toolRows[1]!.atMs - toolRows[0]!.atMs).toBeGreaterThan(7000);
  });

  it("leaves no bare act rows, one observe per tool turn, and nothing after the final deliverable", () => {
    const rows = buildTimelineSkeleton(run.hookLog, names, starts);
    expect(rows.filter((r) => r.phase === "act" && r.toolIndex === null)).toEqual([]);
    expect(rows.filter((r) => r.phase === "observe")).toHaveLength(3);
    const lastObserve = rows.map((r) => r.phase).lastIndexOf("observe");
    expect(rows.slice(lastObserve + 1).some((r) => r.phase === "act" || r.phase === "observe")).toBe(false);
  });

  it("falls back to one call per think-turn when no trace is available", () => {
    const rows = buildTimelineSkeleton(run.hookLog, names, undefined);
    expect(rows.filter((r) => r.toolIndex !== null)).toHaveLength(3);
    expect(rows.filter((r) => r.phase === "act" && r.toolIndex === null)).toEqual([]);
  });

  it("is robust to 3 act-before hooks per call (synthetic trace)", () => {
    const hooks: HookEntry[] = [];
    for (const t of [1000, 5000]) {
      hooks.push({ phase: "think", timing: "before", t: t - 900 }, { phase: "think", timing: "after", t: t - 10 });
      hooks.push({ phase: "act", timing: "before", t: t - 1 }); // real: just before execution
      hooks.push({ phase: "act", timing: "before", t: t + 300 }, { phase: "act", timing: "before", t: t + 301 });
      hooks.push({ phase: "observe", timing: "before", t: t + 302 }, { phase: "observe", timing: "before", t: t + 303 });
    }
    const rows = buildTimelineSkeleton(hooks, ["web-search", "file-write"], [
      { name: "web-search", t: 1000 },
      { name: "file-write", t: 5000 },
    ]);
    // first hook is at t=100, so rows are offset by 100
    expect(rows.filter((r) => r.phase === "act").map((r) => r.atMs)).toEqual([899, 4899]);
    expect(rows.filter((r) => r.phase === "act" && r.toolIndex === null)).toHaveLength(0);
    expect(rows.filter((r) => r.phase === "observe")).toHaveLength(2);
  });

  it("places a call at its start time when no act hook is near it", () => {
    const hooks: HookEntry[] = [
      { phase: "think", timing: "before", t: 0 },
      { phase: "think", timing: "before", t: 90000 },
    ];
    const rows = buildTimelineSkeleton(hooks, ["a"], [{ name: "a", t: 45000 }]);
    expect(rows.map((r) => r.phase)).toEqual(["think", "act", "think"]);
    expect(rows[1]!.toolIndex).toBe(0);
  });

  it("committed data matches: tool rows equal tool calls, no bare act rows, honest field name", () => {
    const d = JSON.parse(readFileSync(resolve(import.meta.dir, "../src/data/golden-run.json"), "utf-8"));
    expect(d.timeline.filter((e: { kind: string }) => e.kind === "tool")).toHaveLength(d.toolCalls.length);
    expect(d.timeline.filter((e: { phase: string; kind: string }) => e.phase === "act" && e.kind !== "tool")).toEqual([]);
    // Compare against the capture the committed data was generated from (named in `_source`).
    const srcDir = /wiki\/Research\/Harness-Reports\/(golden-run-[^/]+)\//.exec(d._source)?.[1];
    expect(srcDir).toBeDefined();
    const srcRun = JSON.parse(
      readFileSync(resolve(import.meta.dir, `../../../wiki/Research/Harness-Reports/${srcDir}/run.json`), "utf-8"),
    );
    expect(d.run.reasoningSteps).toBe(srcRun.result.metadata.stepsCount);
    expect(d.run.iterations).toBeUndefined();
  });
});

describe("golden-run exit-gate denials", () => {
  const line = (o: object): string => JSON.stringify(o);

  it("reads only exit_gate deny decisions, not a cap-forced handoff or other guards", () => {
    const jsonl = [
      line({ kind: "guard-fired", guard: "exit_gate", timestamp: 10, metadata: { gateDecision: "deny", outstanding: ["write the file ./report.md"] } }),
      line({ kind: "guard-fired", guard: "exit_gate", timestamp: 20, metadata: { gateDecision: "accept", outstanding: [] } }),
      line({ kind: "guard-fired", guard: "exit_gate", timestamp: 30, metadata: { gateDecision: "handoff", outstanding: ["x"] } }),
      line({ kind: "guard-fired", guard: "loop_detector", timestamp: 40, metadata: { gateDecision: "deny" } }),
      "not json",
    ].join("\n");
    expect(exitDenialsFromTrace(jsonl)).toEqual([{ t: 10, outstanding: ["write the file ./report.md"] }]);
  });

  it("committed data: a think row with no thought renders as a plain tick, and a denial sits on a no-tool pass", () => {
    const d = JSON.parse(readFileSync(resolve(import.meta.dir, "../src/data/golden-run.json"), "utf-8"));
    type Row = { phase: string; detail: { thought?: string | null; leadsToTool?: string | null; exitDenied?: { outstanding: string[] } } | null };
    const thinks = (d.timeline as Row[]).filter((e) => e.phase === "think" && e.detail && "thought" in e.detail);
    for (const t of thinks.filter((t) => t.detail!.exitDenied)) {
      expect(t.detail!.leadsToTool).toBeNull();
      expect(t.detail!.exitDenied!.outstanding.length).toBeGreaterThan(0);
    }
    const src = readFileSync(resolve(import.meta.dir, "../src/components/RunReplay.astro"), "utf-8");
    expect(src).not.toContain("the model emitted no thought text");
    expect(src).toContain("ra-replay-gate");
  });
});
