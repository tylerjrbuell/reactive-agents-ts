# Phase 0 — Frozen Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `2026-05-03-v1-master-roadmap.md` §3 Phase 0
> **Prior context:** Stage 5 W9 already shipped `JudgeLLMService` Tag in `packages/eval/src/services/judge-llm-service.ts`. **The bench harness in `packages/benchmarks/src/judge.ts` does NOT yet consume it** — it constructs a fresh agent per call. This plan completes the wiring + adds containerization + reproducibility metadata.

**Goal:** Ship a containerized, model-pinned, code-SHA-pinned judge service consumed via HTTP RPC by `packages/benchmarks/src/judge.ts`, so that bench scores are reproducible across harness changes.

**Architecture:** A `judge-server/` package exposes an HTTP server bound to a single pinned `JudgeLLMService` Layer. A Dockerfile rebuilds it deterministically. The bench harness calls the server via `fetch` (no inline agent construction). Reproducibility metadata (judge model SHA, judge code SHA, run ID, replay command) is recorded in every `SessionReport`.

**Tech Stack:** Bun, Effect-TS (existing), Docker (new), HTTP (Bun.serve, no extra deps).

---

## Mandatory TDD compliance

**All test code in this plan is a sketch.** The authoritative discipline lives at `.agents/skills/agent-tdd/SKILL.md` (project-specific, Effect-TS-aware). Where the example code in this plan conflicts with that skill, the skill wins. Every implementer subagent MUST consult the skill before writing tests.

Concrete requirements applied to every test in this plan:

1. **File header (mandatory):** `// Run: bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000`
2. **Timeout per test (mandatory):** every `it(…)` ends with `, 15000)` (or `, 30000)` for multi-turn / docker / bench tests).
3. **--timeout 15000 in every bun test command.** Never omit.
4. **Error-path tests use `Effect.flip`** (not try/catch) — Effect errors don't throw.
5. **Server teardown (mandatory):** `afterAll(async () => { await server?.stop(true); })` for any `Bun.serve()` test. The `true` force-closes connections.
6. **Layer isolation:** factory function (`makeTestLayer()`), never a shared mutable layer between tests.
7. **Mocks for `LLMService`:** prefer `@reactive-agents/testing` mocks (`makeMockLLM`); never use a real LLMService in tests.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/judge-server/package.json` | Create | New workspace package with bun + effect deps |
| `packages/judge-server/src/index.ts` | Create | Bun.serve HTTP entry; routes `POST /judge` to handler |
| `packages/judge-server/src/handler.ts` | Create | Effect.gen handler that invokes JudgeLLMService.judge() |
| `packages/judge-server/src/contract.ts` | Create | Effect Schema for request/response shapes (single source of truth) |
| `packages/judge-server/Dockerfile` | Create | Pinned bun + bun.lock + judge model SHA env |
| `packages/judge-server/tests/handler.test.ts` | Create | Tests for handler logic + contract validation |
| `packages/judge-server/tests/server.test.ts` | Create | Tests for HTTP server (request/response round-trip) |
| `packages/benchmarks/src/judge.ts` | Modify (full rewrite) | Replace inline agent construction with `fetch(judge.url, ...)` |
| `packages/benchmarks/src/types.ts` | Modify | Add `reproducibility: { judgeModelSha, judgeCodeSha, runId, replayCommand }` to SessionReport |
| `packages/benchmarks/src/runner.ts` | Modify | Populate reproducibility fields; enforce Rule-4 guard |
| `packages/benchmarks/tests/judge-rpc.test.ts` | Create | Tests for the new fetch-based judge call |
| `packages/benchmarks/tests/rule4-guard.test.ts` | Create | Tests that bench rejects judge.model === sut.model |
| `packages/benchmarks/tests/reproducibility.test.ts` | Create | Tests reproducibility metadata is populated |
| `scripts/run-frozen-judge-regression.sh` | Create | Runs the same task suite twice 24hr apart and diffs scores |
| `harness-reports/phase-0-frozen-judge-baseline.json` | Create | Pre-implementation bench (current state, for diff comparison) |
| `harness-reports/phase-0-frozen-judge-postimpl.json` | Create | Post-implementation bench (proves reproducibility ≤±0.5%) |
| `harness-reports/phase-0-frozen-judge-2026-MM-DD.md` | Create | Final phase artifact: methodology, gate result, sign-off |

---

### Task 1: Capture baseline (pre-implementation state)

**Files:**
- Create: `harness-reports/phase-0-frozen-judge-baseline.json`

- [ ] **Step 1.1: Read current judge implementation state**

Read these three files in full to confirm the audit's claims about current state:
- `packages/eval/src/services/judge-llm-service.ts` (W9 added this; verify shape)
- `packages/benchmarks/src/judge.ts` (the inline agent construction we're replacing)
- `packages/benchmarks/src/runner.ts` (where SessionReport is built)

Document findings in `harness-reports/phase-0-frozen-judge-baseline.json`:

```json
{
  "phase": 0,
  "captured_at": "<ISO timestamp at time of capture>",
  "judge_llm_service_exists": true,
  "judge_llm_service_path": "packages/eval/src/services/judge-llm-service.ts",
  "bench_judge_path": "packages/benchmarks/src/judge.ts",
  "bench_judge_constructs_agent_inline": "<verify: true | false>",
  "bench_judge_loc": "<wc -l count>",
  "session_report_has_reproducibility_field": "<verify: true | false>",
  "rule4_guard_present_in_bench": "<verify: true | false>",
  "current_bench_command": "<the actual command to run the regression-gate session>",
  "prior_bench_evidence": {
    "path": "<path to most recent regression-gate bench JSON in harness-reports/, or null>",
    "ran_at": "<date from file or git log>",
    "sut_model": "<from file>",
    "aggregate_score": "<from file>",
    "notes": "<any caveats; e.g. 'pre-W22 fix, scores not directly comparable'>"
  }
}
```

- [ ] **Step 1.2: Locate prior bench evidence (no fresh runs)**

**Revised scope (2026-05-03):** the original plan ran the bench twice in Task 1 for baseline variance AND twice again in Task 11 for the regression test — 4 expensive runs to validate one ±0.5% claim. Task 11's bench-twice already establishes reproducibility against itself. Task 1 just needs:

1. Find the most recent bench JSON in `harness-reports/` (or `packages/benchmarks/`) that ran the regression-gate session. Look for files like `bench-*.json`, `regression-gate-*.json`, or any session report.
2. Record its path, date, SUT model, and aggregate score in the baseline JSON under `prior_bench_evidence`.
3. If no such file exists, record `prior_bench_evidence: null` with a `notes` entry explaining — Task 11 will then be the first run.

Do **not** execute any bench runs in Task 1. Task 11 owns all bench execution for this phase.

- [ ] **Step 1.3: Commit baseline**

```bash
git add harness-reports/phase-0-frozen-judge-baseline.json
git commit -m "chore(bench): capture phase-0 baseline before frozen-judge work"
```

---

### Task 2: Create the judge-server workspace package

**Files:**
- Create: `packages/judge-server/package.json`
- Create: `packages/judge-server/tsconfig.json`
- Modify: workspace root `package.json` (workspaces field — verify it auto-includes `packages/*`)

- [ ] **Step 2.1: Write the failing test** (verify package is installable)

Create `packages/judge-server/tests/package-shape.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import pkg from "../package.json" with { type: "json" };

describe("judge-server package shape", () => {
  it("declares the @reactive-agents/judge-server name", () => {
    expect(pkg.name).toBe("@reactive-agents/judge-server");
  });
  it("declares engines.bun >=1.1.0 (consistent with workspace)", () => {
    expect(pkg.engines?.bun).toMatch(/^>=1\.1/);
  });
  it("depends on @reactive-agents/eval (judge service source)", () => {
    expect(pkg.dependencies).toHaveProperty("@reactive-agents/eval");
  });
  it("depends on effect (Effect-TS)", () => {
    expect(pkg.dependencies).toHaveProperty("effect");
  });
  it("has a 'start' script that runs src/index.ts", () => {
    expect(pkg.scripts?.start).toMatch(/bun (run )?src\/index\.ts/);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/package-shape.test.ts
```

Expected: FAIL — `package.json` does not exist.

- [ ] **Step 2.3: Create package.json**

```json
{
  "name": "@reactive-agents/judge-server",
  "version": "0.10.0",
  "private": true,
  "type": "module",
  "engines": { "bun": ">=1.1.0" },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@reactive-agents/eval": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/core": "workspace:*",
    "effect": "*"
  },
  "peerDependencies": {
    "effect": "*"
  }
}
```

- [ ] **Step 2.4: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*", "tests/**/*"],
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./"
  }
}
```

- [ ] **Step 2.5: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/package-shape.test.ts
```

Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add packages/judge-server/package.json packages/judge-server/tsconfig.json packages/judge-server/tests/package-shape.test.ts
git commit -m "feat(judge-server): scaffold workspace package with shape test"
```

---

### Task 3: Define the RPC contract (Effect Schema)

**Files:**
- Create: `packages/judge-server/src/contract.ts`
- Create: `packages/judge-server/tests/contract.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/judge-server/tests/contract.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { JudgeRequest, JudgeResponse } from "../src/contract.js";

describe("judge RPC contract", () => {
  it("parses a valid JudgeRequest", () => {
    const valid = {
      taskId: "t-001",
      sutResponse: "Paris is the capital of France.",
      taskInput: { question: "What is the capital of France?" },
      sutModel: "claude-sonnet-4-6",
      runId: "run-abc-123",
    };
    const result = Schema.decodeUnknownSync(JudgeRequest)(valid);
    expect(result.taskId).toBe("t-001");
  });

  it("rejects a JudgeRequest missing sutModel (Rule-4 enforcement requires it)", () => {
    const invalid = {
      taskId: "t-001",
      sutResponse: "x",
      taskInput: {},
      runId: "r",
    };
    expect(() => Schema.decodeUnknownSync(JudgeRequest)(invalid)).toThrow();
  });

  it("parses a valid JudgeResponse with required reproducibility metadata", () => {
    const valid = {
      taskId: "t-001",
      passed: true,
      overallScore: 0.92,
      recommendation: "accept" as const,
      layerResults: [],
      reproducibility: {
        judgeModelSha: "abc123",
        judgeCodeSha: "def456",
      },
    };
    const result = Schema.decodeUnknownSync(JudgeResponse)(valid);
    expect(result.reproducibility.judgeModelSha).toBe("abc123");
  });

  it("rejects a JudgeResponse missing reproducibility (Rule 4 demands it)", () => {
    const invalid = {
      taskId: "t-001",
      passed: true,
      overallScore: 0.92,
      recommendation: "accept",
      layerResults: [],
    };
    expect(() => Schema.decodeUnknownSync(JudgeResponse)(invalid)).toThrow();
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/contract.test.ts
```

Expected: FAIL — `contract.ts` does not exist.

- [ ] **Step 3.3: Implement contract.ts**

Create `packages/judge-server/src/contract.ts`:

```ts
import { Schema } from "effect";

export const JudgeRequest = Schema.Struct({
  taskId: Schema.String,
  sutResponse: Schema.String,
  taskInput: Schema.Unknown,
  sutModel: Schema.String,
  runId: Schema.String,
  taskCriteria: Schema.optional(Schema.String),
});
export type JudgeRequest = Schema.Schema.Type<typeof JudgeRequest>;

export const ReproducibilityMetadata = Schema.Struct({
  judgeModelSha: Schema.String,
  judgeCodeSha: Schema.String,
});
export type ReproducibilityMetadata = Schema.Schema.Type<typeof ReproducibilityMetadata>;

export const JudgeLayerResult = Schema.Struct({
  layerName: Schema.String,
  score: Schema.Number,
  passed: Schema.Boolean,
  details: Schema.optional(Schema.String),
});
export type JudgeLayerResult = Schema.Schema.Type<typeof JudgeLayerResult>;

export const JudgeResponse = Schema.Struct({
  taskId: Schema.String,
  passed: Schema.Boolean,
  overallScore: Schema.Number,
  recommendation: Schema.Literal("accept", "review", "reject"),
  layerResults: Schema.Array(JudgeLayerResult),
  reproducibility: ReproducibilityMetadata,
});
export type JudgeResponse = Schema.Schema.Type<typeof JudgeResponse>;
```

- [ ] **Step 3.4: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/contract.test.ts
```

Expected: PASS (4/4 expects).

- [ ] **Step 3.5: Commit**

```bash
git add packages/judge-server/src/contract.ts packages/judge-server/tests/contract.test.ts
git commit -m "feat(judge-server): RPC contract with Rule-4 reproducibility enforcement"
```

---

### Task 4: Implement the judge handler (pure Effect, no HTTP)

**Files:**
- Create: `packages/judge-server/src/handler.ts`
- Create: `packages/judge-server/tests/handler.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `packages/judge-server/tests/handler.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { handleJudgeRequest } from "../src/handler.js";
import type { JudgeRequest } from "../src/contract.js";

const StubJudgeLLMService = Context.GenericTag<{
  judge: (req: { response: string; input: unknown; sutModel: string }) => Effect.Effect<{
    overallScore: number;
    passed: boolean;
    recommendation: "accept" | "review" | "reject";
    layerResults: Array<{ layerName: string; score: number; passed: boolean; details?: string }>;
  }>;
}>("JudgeLLMService");

describe("judge handler", () => {
  it("calls JudgeLLMService.judge and returns a JudgeResponse with reproducibility metadata", async () => {
    const stubLayer = Layer.succeed(StubJudgeLLMService, {
      judge: () => Effect.succeed({
        overallScore: 0.95,
        passed: true,
        recommendation: "accept" as const,
        layerResults: [{ layerName: "factuality", score: 0.95, passed: true }],
      }),
    });

    const req: JudgeRequest = {
      taskId: "t-001",
      sutResponse: "Paris.",
      taskInput: { question: "Capital of France?" },
      sutModel: "claude-sonnet-4-6",
      runId: "r-1",
    };

    const result = await Effect.runPromise(
      handleJudgeRequest(req, { judgeModelSha: "judge-sha", judgeCodeSha: "code-sha" }).pipe(
        Effect.provide(stubLayer)
      )
    );

    expect(result.taskId).toBe("t-001");
    expect(result.passed).toBe(true);
    expect(result.overallScore).toBe(0.95);
    expect(result.recommendation).toBe("accept");
    expect(result.reproducibility.judgeModelSha).toBe("judge-sha");
    expect(result.reproducibility.judgeCodeSha).toBe("code-sha");
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/handler.test.ts
```

Expected: FAIL — `handler.ts` does not exist.

- [ ] **Step 4.3: Implement handler.ts**

Create `packages/judge-server/src/handler.ts`:

```ts
import { Effect, Context } from "effect";
import type { JudgeRequest, JudgeResponse, ReproducibilityMetadata } from "./contract.js";

const JudgeLLMService = Context.GenericTag<{
  judge: (req: { response: string; input: unknown; sutModel: string }) => Effect.Effect<{
    overallScore: number;
    passed: boolean;
    recommendation: "accept" | "review" | "reject";
    layerResults: Array<{ layerName: string; score: number; passed: boolean; details?: string }>;
  }>;
}>("JudgeLLMService");

export const handleJudgeRequest = (
  req: JudgeRequest,
  reproducibility: ReproducibilityMetadata,
): Effect.Effect<JudgeResponse, never, typeof JudgeLLMService.Identifier> =>
  Effect.gen(function* () {
    const judge = yield* JudgeLLMService;
    const verdict = yield* judge.judge({
      response: req.sutResponse,
      input: req.taskInput,
      sutModel: req.sutModel,
    });
    return {
      taskId: req.taskId,
      passed: verdict.passed,
      overallScore: verdict.overallScore,
      recommendation: verdict.recommendation,
      layerResults: verdict.layerResults,
      reproducibility,
    };
  });
```

- [ ] **Step 4.4: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/handler.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add packages/judge-server/src/handler.ts packages/judge-server/tests/handler.test.ts
git commit -m "feat(judge-server): pure Effect judge handler with reproducibility metadata"
```

---

### Task 5: Implement the HTTP server (Bun.serve)

**Files:**
- Create: `packages/judge-server/src/index.ts`
- Create: `packages/judge-server/tests/server.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `packages/judge-server/tests/server.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void; port: number };

beforeAll(async () => {
  // Start the server with a stub judge layer; capture the port
  const mod = await import("../src/index.js");
  server = await mod.startServer({
    port: 0, // OS-assigned
    judgeModelSha: "test-judge-sha",
    judgeCodeSha: "test-code-sha",
    judgeLayer: "stub", // signals to use built-in stub for tests
  });
});

afterAll(() => server?.stop());

describe("judge HTTP server", () => {
  it("returns 200 + JudgeResponse on POST /judge with a valid request", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "t-001",
        sutResponse: "Paris.",
        taskInput: { question: "Capital of France?" },
        sutModel: "claude-sonnet-4-6",
        runId: "r-1",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toBe("t-001");
    expect(body.reproducibility.judgeModelSha).toBe("test-judge-sha");
    expect(body.reproducibility.judgeCodeSha).toBe("test-code-sha");
  });

  it("returns 400 on POST /judge with an invalid request shape", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broken: true }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 + judge metadata on GET /version", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/version`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.judgeModelSha).toBe("test-judge-sha");
    expect(body.judgeCodeSha).toBe("test-code-sha");
  });

  it("returns 405 on GET /judge (POST only)", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/judge`);
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/server.test.ts
```

Expected: FAIL — `index.ts` does not exist or doesn't export `startServer`.

- [ ] **Step 5.3: Implement index.ts**

Create `packages/judge-server/src/index.ts`:

```ts
import { Effect, Layer, Schema, Context } from "effect";
import { JudgeRequest, type ReproducibilityMetadata } from "./contract.js";
import { handleJudgeRequest } from "./handler.js";

const JudgeLLMService = Context.GenericTag<{
  judge: (req: { response: string; input: unknown; sutModel: string }) => Effect.Effect<{
    overallScore: number;
    passed: boolean;
    recommendation: "accept" | "review" | "reject";
    layerResults: Array<{ layerName: string; score: number; passed: boolean; details?: string }>;
  }>;
}>("JudgeLLMService");

const StubJudgeLayer = Layer.succeed(JudgeLLMService, {
  judge: () => Effect.succeed({
    overallScore: 0.95,
    passed: true,
    recommendation: "accept" as const,
    layerResults: [{ layerName: "stub", score: 0.95, passed: true }],
  }),
});

export interface ServerConfig {
  port: number;
  judgeModelSha: string;
  judgeCodeSha: string;
  judgeLayer: "stub" | "live";
}

export const startServer = async (config: ServerConfig) => {
  const reproducibility: ReproducibilityMetadata = {
    judgeModelSha: config.judgeModelSha,
    judgeCodeSha: config.judgeCodeSha,
  };
  const layer = config.judgeLayer === "stub" ? StubJudgeLayer : StubJudgeLayer; // live layer wired in Task 6

  const server = Bun.serve({
    port: config.port,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/version" && req.method === "GET") {
        return Response.json({
          judgeModelSha: config.judgeModelSha,
          judgeCodeSha: config.judgeCodeSha,
        });
      }

      if (url.pathname === "/judge") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        const raw = await req.json().catch(() => null);
        const decoded = Schema.decodeUnknownEither(JudgeRequest)(raw);
        if (decoded._tag === "Left") {
          return Response.json({ error: "Invalid request shape", detail: String(decoded.left) }, { status: 400 });
        }
        const result = await Effect.runPromise(
          handleJudgeRequest(decoded.right, reproducibility).pipe(Effect.provide(layer)),
        );
        return Response.json(result);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(),
  };
};

if (import.meta.main) {
  const port = Number(process.env.PORT ?? "8910");
  const judgeModelSha = process.env.JUDGE_MODEL_SHA ?? "unknown";
  const judgeCodeSha = process.env.JUDGE_CODE_SHA ?? "unknown";
  const judgeLayer = (process.env.JUDGE_LAYER as "stub" | "live") ?? "live";
  const server = await startServer({ port, judgeModelSha, judgeCodeSha, judgeLayer });
  console.log(`judge-server listening on :${server.port} (model=${judgeModelSha} code=${judgeCodeSha})`);
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/server.test.ts
```

Expected: PASS (4/4 expects).

- [ ] **Step 5.5: Commit**

```bash
git add packages/judge-server/src/index.ts packages/judge-server/tests/server.test.ts
git commit -m "feat(judge-server): Bun.serve HTTP entry with /judge, /version, contract validation"
```

---

### Task 6: Wire the live JudgeLLMService Layer

**Files:**
- Modify: `packages/judge-server/src/index.ts`
- Create: `packages/judge-server/tests/live-layer.test.ts`

- [ ] **Step 6.1: Read existing JudgeLLMService**

```bash
cat packages/eval/src/services/judge-llm-service.ts
```

Confirm the exported Tag and Live Layer name. Adjust the next step's import accordingly.

- [ ] **Step 6.2: Write the failing test**

Create `packages/judge-server/tests/live-layer.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

describe("live judge layer construction", () => {
  it("can be constructed without errors when JUDGE_LAYER=live and required env is present", async () => {
    process.env.JUDGE_LAYER = "live";
    process.env.JUDGE_MODEL = "claude-haiku-4-5-20251001";
    process.env.JUDGE_PROVIDER = "anthropic";
    // Note: this test only validates Layer construction, not actual API calls
    const mod = await import("../src/index.js");
    const server = await mod.startServer({
      port: 0,
      judgeModelSha: "test",
      judgeCodeSha: "test",
      judgeLayer: "live",
    });
    expect(server.port).toBeGreaterThan(0);
    server.stop();
  });
});
```

- [ ] **Step 6.3: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/live-layer.test.ts
```

Expected: FAIL — the live layer is currently `StubJudgeLayer` (line in `index.ts`).

- [ ] **Step 6.4: Implement the live layer wiring**

Modify `packages/judge-server/src/index.ts`. Replace the line `const layer = config.judgeLayer === "stub" ? StubJudgeLayer : StubJudgeLayer;` with a real live-layer construction. Import the existing `JudgeLLMService` Live Layer from `@reactive-agents/eval`:

```ts
import { JudgeLLMServiceLive, type JudgeConfig } from "@reactive-agents/eval";

// ...inside startServer:
const layer = config.judgeLayer === "stub"
  ? StubJudgeLayer
  : JudgeLLMServiceLive({
      model: process.env.JUDGE_MODEL ?? "claude-haiku-4-5-20251001",
      provider: process.env.JUDGE_PROVIDER ?? "anthropic",
    });
```

If the actual export name from `@reactive-agents/eval` differs from `JudgeLLMServiceLive`, use the actual name. Confirm via the read in Step 6.1.

- [ ] **Step 6.5: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/live-layer.test.ts
```

Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add packages/judge-server/src/index.ts packages/judge-server/tests/live-layer.test.ts
git commit -m "feat(judge-server): wire live JudgeLLMServiceLive layer for production use"
```

---

### Task 7: Containerize the judge server

**Files:**
- Create: `packages/judge-server/Dockerfile`
- Create: `packages/judge-server/.dockerignore`
- Create: `scripts/build-judge-container.sh`
- Create: `packages/judge-server/tests/container-shape.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `packages/judge-server/tests/container-shape.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dockerfilePath = join(import.meta.dir, "..", "Dockerfile");

describe("judge-server Dockerfile shape", () => {
  it("Dockerfile exists", () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  });
  it("pins a specific bun version (no 'oven/bun:latest')", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).not.toMatch(/oven\/bun:latest/);
    expect(content).toMatch(/oven\/bun:[\d.]+/);
  });
  it("declares JUDGE_MODEL_SHA build arg", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ARG\s+JUDGE_MODEL_SHA/);
  });
  it("declares JUDGE_CODE_SHA build arg", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ARG\s+JUDGE_CODE_SHA/);
  });
  it("propagates JUDGE_MODEL_SHA and JUDGE_CODE_SHA to ENV for runtime", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ENV\s+JUDGE_MODEL_SHA=\$\{JUDGE_MODEL_SHA\}/);
    expect(content).toMatch(/ENV\s+JUDGE_CODE_SHA=\$\{JUDGE_CODE_SHA\}/);
  });
  it("exposes port 8910", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/EXPOSE\s+8910/);
  });
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

```bash
cd packages/judge-server && bun test tests/container-shape.test.ts
```

Expected: FAIL — Dockerfile does not exist.

- [ ] **Step 7.3: Create the Dockerfile**

Create `packages/judge-server/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM oven/bun:1.1.34 AS base
WORKDIR /app

ARG JUDGE_MODEL_SHA=unknown
ARG JUDGE_CODE_SHA=unknown
ENV JUDGE_MODEL_SHA=${JUDGE_MODEL_SHA}
ENV JUDGE_CODE_SHA=${JUDGE_CODE_SHA}
ENV JUDGE_LAYER=live
ENV PORT=8910

# Copy workspace manifests first for cache efficiency
COPY package.json bun.lock turbo.json ./
COPY packages/judge-server/package.json packages/judge-server/
COPY packages/eval/package.json packages/eval/
COPY packages/llm-provider/package.json packages/llm-provider/
COPY packages/core/package.json packages/core/

RUN bun install --frozen-lockfile

# Copy sources
COPY packages/judge-server packages/judge-server
COPY packages/eval packages/eval
COPY packages/llm-provider packages/llm-provider
COPY packages/core packages/core

EXPOSE 8910

CMD ["bun", "run", "packages/judge-server/src/index.ts"]
```

- [ ] **Step 7.4: Create .dockerignore**

Create `packages/judge-server/.dockerignore`:

```
node_modules
dist
.turbo
*.log
tests
```

- [ ] **Step 7.5: Create build script**

Create `scripts/build-judge-container.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Compute SHAs at build time
JUDGE_CODE_SHA=$(git -C "$(dirname "$0")/.." rev-parse HEAD)
JUDGE_MODEL_SHA="${JUDGE_MODEL_SHA:-claude-haiku-4-5-20251001}"

cd "$(dirname "$0")/.."

docker build \
  -f packages/judge-server/Dockerfile \
  --build-arg JUDGE_MODEL_SHA="$JUDGE_MODEL_SHA" \
  --build-arg JUDGE_CODE_SHA="$JUDGE_CODE_SHA" \
  -t reactive-agents/judge-server:${JUDGE_CODE_SHA:0:8} \
  -t reactive-agents/judge-server:latest \
  .

echo "Built reactive-agents/judge-server:${JUDGE_CODE_SHA:0:8}"
```

```bash
chmod +x scripts/build-judge-container.sh
```

- [ ] **Step 7.6: Run the test to verify it passes**

```bash
cd packages/judge-server && bun test tests/container-shape.test.ts
```

Expected: PASS (6/6 expects).

- [ ] **Step 7.7: Commit**

```bash
git add packages/judge-server/Dockerfile packages/judge-server/.dockerignore scripts/build-judge-container.sh packages/judge-server/tests/container-shape.test.ts
git commit -m "feat(judge-server): Dockerfile + build script with pinned SHAs"
```

---

### Task 8: Wire the bench harness to the RPC server

**Files:**
- Modify: `packages/benchmarks/src/judge.ts` (full rewrite)
- Create: `packages/benchmarks/tests/judge-rpc.test.ts`

- [ ] **Step 8.1: Read current judge.ts to understand the existing call surface**

```bash
cat packages/benchmarks/src/judge.ts
```

Note the exported function name(s), input shape(s), and return shape(s) — these are the public API the bench runner depends on.

- [ ] **Step 8.2: Write the failing test**

Create `packages/benchmarks/tests/judge-rpc.test.ts` based on the actual exported function name from Step 8.1. Example assuming `callJudge`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void; port: number };
let judgeUrl: string;

beforeAll(async () => {
  const { startServer } = await import("@reactive-agents/judge-server");
  server = await startServer({
    port: 0,
    judgeModelSha: "test-model-sha",
    judgeCodeSha: "test-code-sha",
    judgeLayer: "stub",
  });
  judgeUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server?.stop());

describe("bench callJudge over RPC", () => {
  it("calls the judge server and returns the verdict", async () => {
    const { callJudge } = await import("../src/judge.js");
    const result = await callJudge({
      taskId: "t-001",
      sutResponse: "Paris.",
      taskInput: { question: "?" },
      sutModel: "claude-sonnet-4-6",
      runId: "r-1",
    }, { judgeUrl });
    expect(result.passed).toBe(true);
    expect(result.reproducibility.judgeModelSha).toBe("test-model-sha");
  });
});
```

- [ ] **Step 8.3: Run the test to verify it fails**

```bash
cd packages/benchmarks && bun test tests/judge-rpc.test.ts
```

Expected: FAIL — `callJudge` does not yet support a `judgeUrl` second argument.

- [ ] **Step 8.4: Rewrite judge.ts**

Replace the contents of `packages/benchmarks/src/judge.ts` with an HTTP client implementation:

```ts
import type { JudgeRequest, JudgeResponse } from "@reactive-agents/judge-server";

export interface JudgeCallOptions {
  judgeUrl: string;
}

export const callJudge = async (
  req: JudgeRequest,
  opts: JudgeCallOptions,
): Promise<JudgeResponse> => {
  const res = await fetch(`${opts.judgeUrl}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "(no body)");
    throw new Error(`Judge RPC failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as JudgeResponse;
};
```

If the original `judge.ts` exported additional functions consumed by the bench runner, preserve their signatures and route them through `callJudge` internally.

- [ ] **Step 8.5: Run the test to verify it passes**

```bash
cd packages/benchmarks && bun test tests/judge-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add packages/benchmarks/src/judge.ts packages/benchmarks/tests/judge-rpc.test.ts
git commit -m "feat(bench): route judge calls through judge-server RPC instead of inline agent"
```

---

### Task 9: Add Rule-4 guard

**Files:**
- Modify: `packages/benchmarks/src/runner.ts`
- Create: `packages/benchmarks/tests/rule4-guard.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `packages/benchmarks/tests/rule4-guard.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void; port: number };

beforeAll(async () => {
  const { startServer } = await import("@reactive-agents/judge-server");
  server = await startServer({
    port: 0,
    judgeModelSha: "claude-sonnet-4-6", // intentionally same as SUT
    judgeCodeSha: "test-code-sha",
    judgeLayer: "stub",
  });
});

afterAll(() => server?.stop());

describe("Rule-4 guard", () => {
  it("rejects a bench run when judge model SHA matches SUT model", async () => {
    const { runSession } = await import("../src/runner.js");
    await expect(
      runSession({
        sutModel: "claude-sonnet-4-6",
        tasks: [],
        judgeUrl: `http://127.0.0.1:${server.port}`,
      })
    ).rejects.toThrow(/Rule.4/);
  });
});
```

- [ ] **Step 9.2: Run the test to verify it fails**

```bash
cd packages/benchmarks && bun test tests/rule4-guard.test.ts
```

Expected: FAIL — runner does not yet check.

- [ ] **Step 9.3: Implement the guard in runner.ts**

In `packages/benchmarks/src/runner.ts`, near the top of the `runSession` function (or its equivalent entry point), add:

```ts
// Rule-4 guard: the judge MUST be a different model than the SUT.
// Fetch judge metadata and compare.
const versionRes = await fetch(`${config.judgeUrl}/version`);
if (!versionRes.ok) {
  throw new Error(`Could not fetch judge version metadata from ${config.judgeUrl}`);
}
const { judgeModelSha } = await versionRes.json() as { judgeModelSha: string };
if (judgeModelSha === config.sutModel) {
  throw new Error(
    `Rule-4 violation: judge model (${judgeModelSha}) must differ from SUT model (${config.sutModel}). ` +
    `See docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4.`
  );
}
```

The exact insertion point depends on the current structure. The test assertion is the contract.

- [ ] **Step 9.4: Run the test to verify it passes**

```bash
cd packages/benchmarks && bun test tests/rule4-guard.test.ts
```

Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add packages/benchmarks/src/runner.ts packages/benchmarks/tests/rule4-guard.test.ts
git commit -m "feat(bench): Rule-4 guard refuses runs when judge model == SUT model"
```

---

### Task 10: Add reproducibility metadata to SessionReport

**Files:**
- Modify: `packages/benchmarks/src/types.ts`
- Modify: `packages/benchmarks/src/runner.ts`
- Create: `packages/benchmarks/tests/reproducibility.test.ts`

- [ ] **Step 10.1: Write the failing test**

Create `packages/benchmarks/tests/reproducibility.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void; port: number };

beforeAll(async () => {
  const { startServer } = await import("@reactive-agents/judge-server");
  server = await startServer({
    port: 0,
    judgeModelSha: "judge-sha-abc",
    judgeCodeSha: "judge-code-def",
    judgeLayer: "stub",
  });
});

afterAll(() => server?.stop());

describe("SessionReport reproducibility metadata", () => {
  it("populates judgeModelSha, judgeCodeSha, runId, replayCommand", async () => {
    const { runSession } = await import("../src/runner.js");
    const report = await runSession({
      sutModel: "claude-haiku-4-5",
      tasks: [{ id: "t-001", input: { question: "Capital of France?" } } as any],
      judgeUrl: `http://127.0.0.1:${server.port}`,
    });
    expect(report.reproducibility.judgeModelSha).toBe("judge-sha-abc");
    expect(report.reproducibility.judgeCodeSha).toBe("judge-code-def");
    expect(report.reproducibility.runId).toMatch(/^run-/);
    expect(report.reproducibility.replayCommand).toContain("--run-id");
  });
});
```

- [ ] **Step 10.2: Run the test to verify it fails**

```bash
cd packages/benchmarks && bun test tests/reproducibility.test.ts
```

Expected: FAIL — `SessionReport.reproducibility` field does not exist.

- [ ] **Step 10.3: Add the field to types.ts and populate in runner.ts**

In `packages/benchmarks/src/types.ts`, add to the `SessionReport` type:

```ts
export interface SessionReproducibility {
  judgeModelSha: string;
  judgeCodeSha: string;
  runId: string;
  replayCommand: string;
}

// In SessionReport:
reproducibility: SessionReproducibility;
```

In `packages/benchmarks/src/runner.ts`, populate after fetching judge version:

```ts
const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const replayCommand = `bun run bench:replay --run-id ${runId} --judge-url ${config.judgeUrl}`;
const reproducibility = {
  judgeModelSha,
  judgeCodeSha: (await (await fetch(`${config.judgeUrl}/version`)).json() as { judgeCodeSha: string }).judgeCodeSha,
  runId,
  replayCommand,
};
// ... include in returned SessionReport
```

- [ ] **Step 10.4: Run the test to verify it passes**

```bash
cd packages/benchmarks && bun test tests/reproducibility.test.ts
```

Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add packages/benchmarks/src/types.ts packages/benchmarks/src/runner.ts packages/benchmarks/tests/reproducibility.test.ts
git commit -m "feat(bench): SessionReport.reproducibility populated from judge /version"
```

---

### Task 11: Reproducibility regression test

**Files:**
- Create: `scripts/run-frozen-judge-regression.sh`
- Create: `harness-reports/phase-0-frozen-judge-postimpl.json`

- [ ] **Step 11.1: Build the judge container**

```bash
./scripts/build-judge-container.sh
```

Expected: container `reactive-agents/judge-server:latest` exists. Verify with `docker images | grep judge-server`.

- [ ] **Step 11.2: Start the judge container**

```bash
docker run -d --name judge-server-test \
  -p 8910:8910 \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e JUDGE_MODEL=claude-haiku-4-5-20251001 \
  -e JUDGE_PROVIDER=anthropic \
  reactive-agents/judge-server:latest
```

Verify it's serving:
```bash
curl http://127.0.0.1:8910/version
```

Expected JSON: `{"judgeModelSha":"...","judgeCodeSha":"..."}`.

- [ ] **Step 11.3: Create the regression script**

Create `scripts/run-frozen-judge-regression.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

JUDGE_URL="${JUDGE_URL:-http://127.0.0.1:8910}"
SUT_MODEL="${SUT_MODEL:-claude-sonnet-4-6}"

cd "$(dirname "$0")/.."

mkdir -p harness-reports/phase-0-runs

echo "Run 1..."
bun run --cwd packages/benchmarks bench:regression-gate \
  --judge-url "$JUDGE_URL" \
  --sut-model "$SUT_MODEL" \
  > harness-reports/phase-0-runs/run1.json

sleep 60

echo "Run 2..."
bun run --cwd packages/benchmarks bench:regression-gate \
  --judge-url "$JUDGE_URL" \
  --sut-model "$SUT_MODEL" \
  > harness-reports/phase-0-runs/run2.json

# Diff the aggregate scores
SCORE1=$(jq '.aggregate.score' harness-reports/phase-0-runs/run1.json)
SCORE2=$(jq '.aggregate.score' harness-reports/phase-0-runs/run2.json)
DELTA=$(echo "scale=4; ($SCORE2 - $SCORE1) * 100" | bc)

echo "Run1 score: $SCORE1"
echo "Run2 score: $SCORE2"
echo "Delta: ${DELTA}%"

# Gate: ±0.5%
if (( $(echo "$DELTA > 0.5 || $DELTA < -0.5" | bc -l) )); then
  echo "FAIL: reproducibility delta exceeds ±0.5%"
  exit 1
fi
echo "PASS: reproducibility delta within ±0.5%"
```

```bash
chmod +x scripts/run-frozen-judge-regression.sh
```

- [ ] **Step 11.4: Run the regression**

```bash
./scripts/run-frozen-judge-regression.sh
```

Expected: PASS with delta ≤±0.5%.

If FAIL: investigate. The judge is supposed to be deterministic given the same SUT response (the SUT has provider nondeterminism, but the judge given the same input should produce the same verdict). If the judge itself is nondeterministic, lower temperature on the judge model in `JudgeLLMServiceLive`.

- [ ] **Step 11.5: Capture postimpl results**

Populate `harness-reports/phase-0-frozen-judge-postimpl.json`:

```json
{
  "phase": 0,
  "captured_at": "<ISO>",
  "judge_model": "claude-haiku-4-5-20251001",
  "judge_code_sha": "<git rev-parse HEAD>",
  "sut_model": "claude-sonnet-4-6",
  "task_suite": "regression-gate",
  "run1_score": "<from run1.json>",
  "run2_score": "<from run2.json>",
  "delta_pct": "<from script>",
  "gate_pass": true,
  "container_image": "reactive-agents/judge-server:latest",
  "regression_script": "scripts/run-frozen-judge-regression.sh"
}
```

- [ ] **Step 11.6: Stop the judge container**

```bash
docker rm -f judge-server-test
```

- [ ] **Step 11.7: Commit**

```bash
git add scripts/run-frozen-judge-regression.sh harness-reports/phase-0-frozen-judge-postimpl.json
git commit -m "test(bench): frozen-judge regression script + postimpl evidence (delta ≤±0.5%)"
```

---

### Task 12: Phase-0 evidence artifact

**Files:**
- Create: `harness-reports/phase-0-frozen-judge-2026-MM-DD.md` (replace MM-DD with today's date)

- [ ] **Step 12.1: Write the artifact**

Create the dated artifact summarizing methodology, gate, and verdict. Template:

```markdown
# Phase 0 — Frozen Judge: Validation Evidence

**Date completed:** YYYY-MM-DD
**Plan:** docs/superpowers/plans/2026-05-03-phase-0-frozen-judge.md
**Master plan:** docs/superpowers/plans/2026-05-03-v1-master-roadmap.md §3 Phase 0

## Validation gate (from master plan §3 Phase 0)

| Gate criterion | Result |
|---|---|
| Same task suite + same SUT model run twice produces identical bench scores within ±0.5% | <PASS / FAIL with delta> |
| Bench publish call rejected with Rule4Violation if judge.model === sut.model | <PASS / FAIL — cite test> |
| Every published bench report includes judge model SHA + judge code SHA + run ID + replay command | <PASS / FAIL — cite SessionReport.reproducibility shape> |
| Frozen-judge container rebuildable from Dockerfile in repo (no missing deps) | <PASS / FAIL — cite container build success> |

## Methodology

(Describe: which task suite was used, which SUT model, judge model + version, container build SHA, run timestamps, sleep interval between runs.)

## Raw evidence

- `harness-reports/phase-0-frozen-judge-baseline.json` — pre-implementation baseline
- `harness-reports/phase-0-frozen-judge-postimpl.json` — post-implementation results
- `harness-reports/phase-0-runs/run1.json`, `run2.json` — raw bench JSON

## Phase verdict

<PASS — advance to Phase 1 / FAIL — stop the line, root-cause, revise>

## Sign-off

(Person who verified, date, link to commit hash of the phase work)
```

Fill in actual values from the runs.

- [ ] **Step 12.2: Run the phase-end code review**

Dispatch a code-review subagent (per superpowers:code-reviewer):

```
Subagent prompt: "Review Phase 0 implementation. Read the plan at docs/superpowers/plans/2026-05-03-phase-0-frozen-judge.md, the diff of all commits since 'chore(bench): capture phase-0 baseline', and the validation evidence at harness-reports/phase-0-frozen-judge-postimpl.json. Verify each validation gate from the master plan §3 Phase 0 is met. Report PASS or FAIL with specific gaps."
```

- [ ] **Step 12.3: Commit and update master plan amendment log**

```bash
git add harness-reports/phase-0-frozen-judge-2026-MM-DD.md
git commit -m "docs(phase-0): validation evidence — frozen judge gates met"
```

Add an entry to `docs/superpowers/plans/2026-05-03-v1-master-roadmap.md` §9:

| YYYY-MM-DD | Phase 0 complete | Frozen judge gate met (delta ≤±0.5%) | <verifier> |

---

## Self-Review Checklist

Before marking this plan ready for execution:

- [ ] Every task contains real code/commands, no `TBD`/`later`/`add appropriate X` placeholders
- [ ] Every test step shows the actual test code
- [ ] Every implementation step shows the actual implementation code (or modification target)
- [ ] Every command step shows the exact bash invocation
- [ ] Type names are consistent: `JudgeRequest`, `JudgeResponse`, `ReproducibilityMetadata`, `SessionReport`, `SessionReproducibility` — used identically across tasks
- [ ] Every task ends with a commit step
- [ ] The validation gate from the master plan §3 Phase 0 is exercised by Tasks 9, 10, 11

## Execution choice

When ready to begin:

1. **Subagent-driven (recommended)** — dispatch a fresh subagent per task; main agent reviews diff + verifies tests after each; commit after verification.
2. **Inline execution** — execute tasks in the current session using superpowers:executing-plans; batch with checkpoints.

For Phase 0 specifically: subagent-driven is recommended because Tasks 1, 7, 11 involve external systems (git, docker, fetch) that benefit from isolated subagent contexts.

---

*Phase 0 unblocks every other phase in the master roadmap. Without a frozen judge, no later phase can produce reproducible evidence — and without reproducible evidence, the framework cannot validate its mechanisms or honestly publish benchmark numbers. This is the keystone.*
