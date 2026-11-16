import { describe, it, expect } from "bun:test";
import { Either } from "effect";
import {
  planToMarkdown,
  planFromMarkdown,
  planToJSON,
  planFromJSON,
  planToHtml,
  PLAN_FORMAT_VERSION,
} from "../src/index.js";
import type { Plan, PlanStepStatus } from "../src/index.js";

// Deterministic PRNG (mulberry32) for the round-trip property test.
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ATOMS = [
  "a", "B", " ", "  ", "\t", "\n", "\r\n", "\\", "\\n", "\\u{41}", "<", ">", "&", '"', "'", "<script>alert(1)</script>",
  "*", "_", "`", "[", "]", "(", ")", "(tool: x)", "  (tool: y)", "<!--id:zzz-->", "-->", "- [x] ", "# ", "---",
  "é", "日本", "\u{1F600}", " ", " ", "1. ", "%", "",
];
const STATUSES: PlanStepStatus[] = ["pending", "in-progress", "done", "skipped"];

const randomPlan = (r: () => number): Plan => {
  const str = () => Array.from({ length: Math.floor(r() * 6) }, () => ATOMS[Math.floor(r() * ATOMS.length)]).join("");
  return {
    id: str() || "id",
    goal: str(),
    createdAt: Math.floor(r() * 2e12),
    source: (["model", "harness-derived", "user-edited"] as const)[Math.floor(r() * 3)]!,
    steps: Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({
      id: `${i}-${str()}`,
      title: str(),
      status: STATUSES[Math.floor(r() * 4)]!,
      ...(r() < 0.5 ? { tool: str() } : {}),
    })),
  };
};

const right = <A>(e: Either.Either<A, unknown>): A => {
  if (Either.isLeft(e)) throw new Error(`expected right: ${JSON.stringify(e.left)}`);
  return e.right;
};

describe("plan markdown", () => {
  it("round-trips random hostile plans losslessly", () => {
    const r = rng(42);
    for (let n = 0; n < 500; n++) {
      const plan = randomPlan(r);
      expect(right(planFromMarkdown(planToMarkdown(plan)))).toEqual(plan);
    }
  });

  it("writes a readable checklist", () => {
    const md = planToMarkdown({
      id: "p1",
      goal: "Ship it",
      createdAt: 5,
      source: "model",
      steps: [
        { id: "a", title: "Read", status: "done", tool: "file-read" },
        { id: "b", title: "Write", status: "in-progress" },
        { id: "c", title: "Skip", status: "skipped" },
        { id: "d", title: "Todo", status: "pending" },
      ],
    });
    expect(md).toContain("# Ship it");
    expect(md).toContain("- [x] Read  (tool: file-read)");
    expect(md).toContain("- [~] Write");
    expect(md).toContain("- [-] Skip");
    expect(md).toContain("- [ ] Todo");
    expect(md).toContain(`version: ${PLAN_FORMAT_VERSION}`);
  });

  it("parses hand-edited markdown tolerantly", () => {
    const plan = right(
      planFromMarkdown("---\nfoo: bar\n---\n# Goal\n\nnotes\n1. first\n- second\n* [X] third\n  - [ ] fourth\n"),
    );
    expect(plan.goal).toBe("Goal");
    expect(plan.source).toBe("user-edited");
    expect(plan.steps.map((s) => [s.title, s.status])).toEqual([
      ["first", "pending"],
      ["second", "pending"],
      ["third", "done"],
      ["fourth", "pending"],
    ]);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(4);
  });

  it("returns a typed failure, never throws, when there are no steps", () => {
    for (const bad of ["", "# only a goal", "---\nid: x\n---\n", "\u0000�"]) {
      const e = planFromMarkdown(bad);
      expect(Either.isLeft(e) && e.left.reason).toBe("no-steps");
    }
  });
});

describe("plan json", () => {
  const plan: Plan = { id: "p", goal: "g", createdAt: 1, source: "model", steps: [{ id: "s", title: "t", status: "done", tool: "x" }] };

  it("round-trips", () => {
    expect(right(planFromJSON(planToJSON(plan)))).toEqual(plan);
  });

  it("rejects unknown versions with a tagged value", () => {
    const e = planFromJSON(JSON.stringify({ kind: "reactive-agents.plan", version: 99, plan }));
    expect(Either.isLeft(e) && e.left).toMatchObject({ _tag: "PlanParseError", reason: "unsupported-version", version: 99 });
  });

  it("rejects bad json and bad shapes", () => {
    const a = planFromJSON("{nope");
    expect(Either.isLeft(a) && a.left.reason).toBe("invalid-json");
    const b = planFromJSON(JSON.stringify({ kind: "reactive-agents.plan", version: 1, plan: { id: 1 } }));
    expect(Either.isLeft(b) && b.left.reason).toBe("invalid-shape");
    const c = planFromJSON("null");
    expect(Either.isLeft(c) && c.left.reason).toBe("invalid-shape");
  });
});

describe("plan html", () => {
  const evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>\'';
  const html = planToHtml({
    id: evil,
    goal: evil,
    createdAt: 1,
    source: "model",
    steps: [{ id: "s", title: evil, status: "done", tool: evil }],
  });

  it("escapes every interpolated string", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=alert(2)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;");
  });

  it("is self-contained and themed", () => {
    expect(html).toContain("prefers-color-scheme");
    expect(html).toContain("@media print");
    const clean = planToHtml({ id: "i", goal: "g", createdAt: 1, source: "model", steps: [{ id: "s", title: "t", status: "done" }] });
    expect(clean).not.toMatch(/<link|<script|src=|@import|url\(/);
    expect(html).toContain("✔");
  });

  it("survives out-of-range createdAt", () => {
    expect(() => planToHtml({ id: "i", goal: "g", createdAt: 1e30, source: "model", steps: [] })).not.toThrow();
  });
});
