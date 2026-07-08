// run-contract.test.ts — RunContract compiler (meta-loop Phase 4a / B1).
//
// Property tests (the sweep's acceptance): every rw-1..9 + lh-1 prompt compiles
// to a NON-EMPTY contract; rw-8 compiles 3 artifact-produced requirements (the
// 1-of-3 partial-completion witness B2 scores); determinism (same input → same
// contract, deep-equal). Plus: PostCondition graft, freeze, amend seam, and the
// LLM-decomposition floor invariant.
import { describe, expect, it } from "bun:test";
import type { TaskContract } from "@reactive-agents/core";
import {
  amendContract,
  compileRunContract,
  mergeLlmRequirements,
  type TaskRequirement,
} from "../../../src/kernel/contract/run-contract.js";
import { shouldDecompose } from "../../../src/kernel/contract/decompose.js";

// ── Exact benchmark prompt fixtures (verbatim from packages/benchmarks) ────────
// reasoning must not depend on benchmarks (dependency direction), so the prompts
// are inlined here as the property-test corpus.
const RW_PROMPTS: Record<string, string> = {
  "rw-1": `Research the top 3 embedded or edge-deployable vector databases with TypeScript support available in 2025. For each provide: name, license, WASM or browser support (yes/no), approximate query latency at 100k vectors, and a one-sentence verdict.

Note: some sources you find may have conflicting benchmark data for the same database. Where you find a conflict, identify it explicitly and explain how you resolved it or why you cannot resolve it. Output the final answer as a JSON array. Use only databases you can verify actually exist.`,
  "rw-2": `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`,
  "rw-3": `Analyze employees.csv and write a report to report.md surfacing whatever you think is most actionable for leadership. Show your reasoning.`,
  "rw-4": `Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts by user ID 3, enrich each post with its comment count, and write a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const. The module must compile without errors.`,
  "rw-5": `Given the attached PostgreSQL schema in schema.sql, design a migration to support multi-tenancy via row-level security. The migration must be executable with zero downtime on a live database. Produce: (1) 5 specific risks with mitigations, (2) the complete ALTER TABLE and CREATE POLICY SQL statements in execution order, (3) a downtime estimate with justification.`,
  "rw-6": `Profile and optimize the attached sorting implementation in sort.ts for maximum performance. Provide specific improvements with before/after benchmarks.`,
  "rw-7": `The TypeScript package in your working directory has bugs in src/validator.ts, src/processor.ts, and src/pipeline.ts. No test suite is provided. Write tests to find the bugs, fix all of the bugs in place, and verify your tests pass. Keep the exported function names and signatures unchanged. Do not stop until \`bun test\` exits 0.`,
  "rw-8": `You are building a data processing pipeline in 5 phases. Phase 1 establishes the constraints that all subsequent phases must satisfy. Complete all 5 phases in order.

PHASE 1 CONSTRAINT (remember this for all phases):
- All monetary values must use integer cents, never floating-point dollars
- All timestamps must be Unix epoch milliseconds, never ISO strings
- All IDs must be prefixed with the entity type: "user_", "order_", "product_"

Now complete the following phases using these constraints:
Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product
Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type
Phase 4: Write a validator (validate.ts) that checks all constraints are met
Phase 5: Run the validator against the generated data and report results`,
  "rw-9": `Fetch today's cryptocurrency prices for BTC, ETH, and SOL from the price API at INJECT_MOCK_URL and write a summary to prices.md with current price, 24h change, and market cap. If the API is unavailable, check whether a fallback-prices.json file exists in your working directory.`,
  "lh-1": `You are conducting a multi-source research investigation into WebAssembly outside the browser (the WASI / component-model ecosystem). Answer ALL SIX questions below. Each question requires gathering and cross-checking information from MULTIPLE independent web sources — do not rely on a single page. This is a long task: plan your searches, work through the questions methodically, and keep every question in scope until all six are complete.

Research questions:
- Q1: What is WASI and what specific problem does it solve that core WebAssembly does not?
- Q2: What are the major server-side / standalone WebAssembly runtimes?
- Q3: What is the WASI Preview 2 "component model"?
- Q4: Which source languages can compile to WASI today?
- Q5: What are concrete production or near-production use cases?
- Q6: What are the main open technical challenges and documented criticisms?

Produce THREE deliverable files in your working directory. The exact filenames and formats are REQUIRED:

1. findings.json — a JSON array with exactly one object per question.
2. report.md — a Markdown report with one "## Q1", "## Q2", … "## Q6" section heading per question.
3. sources.md — a Markdown list of EVERY source URL you cited anywhere in findings.json.`,
};

const ALL_IDS = Object.keys(RW_PROMPTS);

describe("compileRunContract — non-empty for every rw-1..9 + lh-1 prompt", () => {
  for (const id of ALL_IDS) {
    it(`${id} compiles to a non-empty contract`, () => {
      const contract = compileRunContract(RW_PROMPTS[id]!);
      expect(contract.requirements.length).toBeGreaterThan(0);
      // Every contract has at least the question-answered floor.
      expect(contract.requirements.some((r) => r.id === "answer")).toBe(true);
    });
  }
});

describe("compileRunContract — rw-8 partial-completion witness", () => {
  it("compiles exactly 3 artifact-produced requirements", () => {
    const contract = compileRunContract(RW_PROMPTS["rw-8"]!);
    const artifacts = contract.requirements.filter((r) => r.kind === "artifact-produced");
    expect(artifacts.length).toBe(3);
    expect(artifacts.map((r) => r.id).sort()).toEqual([
      "artifact:./generate.ts",
      "artifact:./types.ts",
      "artifact:./validate.ts",
    ]);
    // Each is a deterministic ArtifactProduced graft + a receipt deliverable.
    for (const a of artifacts) {
      expect(a.spec.condition?.kind).toBe("ArtifactProduced");
      expect(a.spec.acceptance).toBe("deterministic");
    }
    expect(contract.deliverables.filter((d) => d.kind === "file").length).toBe(3);
  });
});

describe("compileRunContract — lh-1 multi-file deliverable", () => {
  it("compiles the three research files as artifact-produced requirements", () => {
    const contract = compileRunContract(RW_PROMPTS["lh-1"]!);
    const ids = contract.requirements
      .filter((r) => r.kind === "artifact-produced")
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual([
      "artifact:./findings.json",
      "artifact:./report.md",
      "artifact:./sources.md",
    ]);
    // lh-1 is a long-horizon task — the upward-gear axis picks it up.
    expect(contract.horizon).toBe("long");
  });
});

describe("compileRunContract — determinism", () => {
  for (const id of ALL_IDS) {
    it(`${id} compiles deep-equal on repeated calls`, () => {
      expect(compileRunContract(RW_PROMPTS[id]!)).toEqual(compileRunContract(RW_PROMPTS[id]!));
    });
  }
});

describe("compileRunContract — PostCondition graft + floor", () => {
  it("tool-coverage grafts onto ToolCalled; postConditions mirror requirement conditions", () => {
    const contract = compileRunContract("Search and answer.", {
      requiredTools: ["web-search", "recall"],
    });
    const toolReqs = contract.requirements.filter((r) => r.kind === "tool-coverage");
    expect(toolReqs.map((r) => r.spec.condition?.kind)).toEqual(["ToolCalled", "ToolCalled"]);
    // Every requirement condition is present in the deterministic floor.
    for (const r of contract.requirements) {
      if (r.spec.condition) {
        expect(contract.postConditions).toContainEqual(r.spec.condition);
      }
    }
  });

  it("consumes a declared TaskContract (required + forbidden tools, output shape)", () => {
    const tc: TaskContract = {
      prompt: "Read report.md and write a '## Summary'.",
      tools: [
        { kind: "required", name: "file-read" },
        { kind: "forbidden", name: "shell-execute" },
      ],
      success: { type: "regex", pattern: "## Summary" },
      outputShape: { format: "markdown", mustInclude: ["## Summary"] },
    };
    const contract = compileRunContract(tc.prompt, { taskContract: tc });
    expect(contract.requirements.some((r) => r.id === "tool:file-read")).toBe(true);
    expect(contract.constraints).toContainEqual({ kind: "forbidden-tool", tool: "shell-execute" });
    expect(contract.constraints).toContainEqual({ kind: "output-format", format: "markdown" });
    // mustInclude becomes a deterministic OutputContains question-answered req.
    const out = contract.requirements.find((r) => r.id === "output:## Summary");
    expect(out?.spec.condition?.kind).toBe("OutputContains");
  });
});

describe("compileRunContract — frozen post-compile", () => {
  it("deep-freezes the contract and its requirements", () => {
    const contract = compileRunContract(RW_PROMPTS["rw-8"]!);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.requirements)).toBe(true);
    expect(contract.requirements.every((r) => Object.isFrozen(r))).toBe(true);
    expect(() => {
      // @ts-expect-error — mutation must be rejected on a frozen contract.
      contract.requirements.push({});
    }).toThrow();
  });
});

describe("amendContract — the Phase-4b mutation seam", () => {
  it("returns a new frozen contract; the original is untouched", () => {
    const base = compileRunContract("Answer this question.");
    const before = base.requirements.length;
    const extra: TaskRequirement = {
      id: "llm:extra",
      kind: "question-answered",
      spec: { description: "cover the edge case", acceptance: "checker" },
      weight: 1,
    };
    const amended = amendContract(base, {
      requirement: extra,
      reason: "mid-run discovery",
      ledgerEntryId: "stub-4b",
    });
    expect(base.requirements.length).toBe(before); // original unchanged
    expect(amended.requirements.length).toBe(before + 1);
    expect(amended.requirements.some((r) => r.id === "llm:extra")).toBe(true);
    expect(Object.isFrozen(amended)).toBe(true);
  });
});

describe("LLM decomposition — floor invariant (deterministic core stands alone)", () => {
  it("shouldDecompose is closed unless opt-in AND structured-output capability", () => {
    expect(shouldDecompose({})).toBe(false);
    expect(shouldDecompose({ enableLlmDecomposition: true })).toBe(false);
    expect(
      shouldDecompose({
        enableLlmDecomposition: true,
        capabilities: {
          supportsToolCalling: false,
          supportsStreaming: true,
          supportsStructuredOutput: false,
          supportsLogprobs: false,
        },
      }),
    ).toBe(false);
    expect(
      shouldDecompose({
        enableLlmDecomposition: true,
        capabilities: {
          supportsToolCalling: false,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          supportsLogprobs: false,
        },
      }),
    ).toBe(true);
  });

  it("mergeLlmRequirements never drops the floor and de-dupes by id", () => {
    const floor = compileRunContract(RW_PROMPTS["rw-8"]!).requirements;
    const llm: TaskRequirement[] = [
      { id: "llm:new", kind: "question-answered", spec: { description: "new", acceptance: "checker" }, weight: 1 },
      { id: "answer", kind: "question-answered", spec: { description: "collides with floor", acceptance: "checker" }, weight: 9 },
    ];
    const merged = mergeLlmRequirements(floor, llm);
    // Floor preserved intact (same objects, same order at the front).
    expect(merged.slice(0, floor.length)).toEqual(floor);
    // New requirement added; colliding id dropped (floor wins).
    expect(merged.some((r) => r.id === "llm:new")).toBe(true);
    expect(merged.filter((r) => r.id === "answer").length).toBe(1);
    expect(merged.find((r) => r.id === "answer")).toEqual(floor.find((r) => r.id === "answer")!);
  });
});
