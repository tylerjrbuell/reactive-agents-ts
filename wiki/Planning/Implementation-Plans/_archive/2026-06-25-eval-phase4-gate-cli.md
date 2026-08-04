# Eval Canonical System — Phase 4 (Gate CLI + CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Follow the project's `agent-tdd` skill (Bun test, mandatory `--timeout`).

**Goal:** Make the Phase-1 gate runnable + enforceable. Add `rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId>` — reads an existing benchmark report, applies the pure `evaluateLiftGate`, prints `formatGateReceipt`, and exits non-zero on a `reject` verdict. Then wire it into a `workflow_dispatch` CI job (bench → gate → fail on reject).

**Architecture:** The gate verdict is pure (Phase 1: `evaluateLiftGate(report, baselineVariantId, candidateVariantId, policy)`), so the CLI command needs no live models — it consumes a `SessionReport` JSON that `rax bench --session X --output report.json` already writes (`bench.ts:64-67`). The command parses flags, reads the report, dynamic-imports `@reactive-agents/benchmarks` (matching `bench.ts`'s pattern — benchmarks is a private, repo-only pkg), evaluates, prints the receipt, and `process.exit`s on the verdict via a pure `decideExitCode(verdict)`. CI is a manual `workflow_dispatch` job (live runs need provider keys; existing `eval.yml` is already manual-only).

**Tech Stack:** TypeScript, Bun test, GitHub Actions YAML.

## Global Constraints

- **Decisions locked:** command = `rax eval gate` (eval is the canonical facade per Phase 2); report-mode (reads a SessionReport JSON, no live models in the gate command itself); exit codes: `reject` → 1, `default-on`/`opt-in` → 0, no comparable tiers (bad variant ids / empty `perTier`) → 2. Scope = gate CLI + CI wiring; **ImprovementLedger (loop-state.json) is OUT** (deferred).
- **Match `bench.ts` for the private-pkg edge:** dynamic `await import("@reactive-agents/benchmarks")` inside the command, wrapped in try/catch with the same "only available inside the reactive-agents-ts repo" friendly error. Do NOT add a static `@reactive-agents/benchmarks` dependency to `apps/cli/package.json`.
- **Pure `decideExitCode(verdict)`** is the unit-tested core (no fs, no `process.exit`). The command wrapper does fs + `process.exit`.
- **No behavior change to existing commands.** `rax eval run` keeps working; `runEval` becomes a `run | gate` dispatcher.
- **Clean types:** strict TS, no `any`. `import type { GateVerdict }` (erased) is fine; runtime gate fns come from the dynamic import. Conventional Commits, NO `Co-Authored-By`.
- **Import extensions:** `.js` (match `apps/cli/src` siblings). Test: `bun test apps/cli/tests/eval-gate.test.ts --timeout 10000`. Build: `bunx turbo run build --filter=@reactive-agents/cli`.

---

## File Structure

- Create `apps/cli/src/commands/eval-gate.ts` — `decideExitCode(verdict)` (pure) + `runEvalGate(args)` (the command).
- Modify `apps/cli/src/commands/eval.ts` — dispatch `args[0] === "gate"` → `runEvalGate(args)`; update USAGE.
- Create `apps/cli/tests/eval-gate.test.ts` — `decideExitCode` unit tests.
- Modify `apps/cli/src/commands/bench.ts` — register the `frontier-spot-check` session (a frontier-runnable 2-variant session: `bare-llm` vs `ra-full`) so CI can produce a gateable report with only a cloud key.
- Create `.github/workflows/regression-gate.yml` — `workflow_dispatch` job: build → `rax bench --session … --output report.json` → `rax eval gate --report … --baseline … --candidate …` (fails on reject).

---

## Task 1: `rax eval gate` command + pure exit-code core

**Files:**
- Create: `apps/cli/src/commands/eval-gate.ts`
- Modify: `apps/cli/src/commands/eval.ts`
- Test: `apps/cli/tests/eval-gate.test.ts`

**Interfaces:**
- Consumes (dynamic): `evaluateLiftGate`, `formatGateReceipt`, `DEFAULT_LIFT_POLICY` from `@reactive-agents/benchmarks`; `import type { GateVerdict, LiftPolicy }`.
- Produces: `decideExitCode(verdict: GateVerdict): number`; `runEvalGate(args: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test for `decideExitCode`**

Create `apps/cli/tests/eval-gate.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { decideExitCode } from "../src/commands/eval-gate.js";

function verdict(decision: "default-on" | "opt-in" | "reject", tiersCovered: number) {
  return {
    decision,
    perTier: [],
    aggregate: { liftPp: 0, tokenOverheadPct: 0, tiersCovered },
    partial: false,
    rationale: "",
    baselineVariantId: "b",
    candidateVariantId: "c",
  };
}

describe("decideExitCode", () => {
  it("exits 1 on reject", () => {
    expect(decideExitCode(verdict("reject", 2))).toBe(1);
  });
  it("exits 0 on default-on", () => {
    expect(decideExitCode(verdict("default-on", 2))).toBe(0);
  });
  it("exits 0 on opt-in", () => {
    expect(decideExitCode(verdict("opt-in", 2))).toBe(0);
  });
  it("exits 2 when no tiers were comparable (bad variant ids / empty report)", () => {
    expect(decideExitCode(verdict("opt-in", 0))).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/cli/tests/eval-gate.test.ts --timeout 10000`
Expected: FAIL — `Cannot find module "../src/commands/eval-gate.js"`.

- [ ] **Step 3: Implement `eval-gate.ts`**

Create `apps/cli/src/commands/eval-gate.ts`:

```ts
// File: apps/cli/src/commands/eval-gate.ts
import type { GateVerdict, LiftPolicy } from "@reactive-agents/benchmarks";
import { fail, info } from "../ui.js";

const GATE_USAGE =
  "Usage: rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId> " +
  "[--metric <dimension>] [--min-lift <pp>] [--max-tok <pct>] [--min-tiers <n>]";

/**
 * Pure exit-code mapping for a gate verdict.
 * reject → 1 (CI must block); no comparable tiers → 2 (bad variant ids / empty data);
 * default-on / opt-in → 0.
 */
export function decideExitCode(verdict: GateVerdict): number {
  if (verdict.aggregate.tiersCovered === 0) return 2;
  if (verdict.decision === "reject") return 1;
  return 0;
}

export async function runEvalGate(args: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const reportPath = get("--report");
  const baseline = get("--baseline");
  const candidate = get("--candidate");
  if (!reportPath || !baseline || !candidate) {
    console.error(fail(GATE_USAGE));
    process.exit(1);
  }

  let benchmarks: typeof import("@reactive-agents/benchmarks");
  try {
    benchmarks = await import("@reactive-agents/benchmarks");
  } catch {
    console.error(
      fail(
        "rax eval gate requires @reactive-agents/benchmarks, which is only available inside the reactive-agents-ts repo.",
      ),
    );
    process.exit(1);
  }
  const { evaluateLiftGate, formatGateReceipt, DEFAULT_LIFT_POLICY } = benchmarks;

  let reportText: string;
  try {
    reportText = await Bun.file(reportPath).text();
  } catch {
    console.error(fail(`Cannot read report file: ${reportPath}`));
    process.exit(1);
  }

  let report: unknown;
  try {
    report = JSON.parse(reportText);
  } catch {
    console.error(fail(`Invalid JSON in report file: ${reportPath}`));
    process.exit(1);
  }

  const policy: LiftPolicy = {
    ...DEFAULT_LIFT_POLICY,
    ...(get("--metric") ? { metric: get("--metric") as LiftPolicy["metric"] } : {}),
    ...(get("--min-lift") ? { minLiftPp: Number(get("--min-lift")) } : {}),
    ...(get("--max-tok") ? { maxTokenOverheadPct: Number(get("--max-tok")) } : {}),
    ...(get("--min-tiers") ? { minTiers: Number(get("--min-tiers")) } : {}),
  };

  // evaluateLiftGate is pure; report shape is the SessionReport written by `rax bench --output`.
  const verdict = evaluateLiftGate(report as Parameters<typeof evaluateLiftGate>[0], baseline, candidate, policy);
  console.log(formatGateReceipt(verdict));
  if (verdict.aggregate.tiersCovered === 0) {
    console.error(
      info(`No comparable tiers for "${baseline}" vs "${candidate}" — check the variant ids exist in the report.`),
    );
  }
  process.exit(decideExitCode(verdict));
}
```

(If `Bun.file(...).text()` does not reject on a missing file in this runtime, guard with an existence check; the implementer should verify and adjust the read-error path so a missing file still produces the friendly error + exit 1.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test apps/cli/tests/eval-gate.test.ts --timeout 10000`
Expected: PASS (4 tests). (`decideExitCode` imports cleanly — the `@reactive-agents/benchmarks` import in `eval-gate.ts` is `import type` only at module scope; the runtime import is inside `runEvalGate`, so importing `decideExitCode` does not require benchmarks at load.)

- [ ] **Step 5: Wire the `gate` subcommand into `runEval`**

In `apps/cli/src/commands/eval.ts`, add the import at the top:

```ts
import { runEvalGate } from "./eval-gate.js";
```

Then change the dispatch at the start of `runEval` (currently `const subcommand = args[0]; if (subcommand !== "run") { ... }`) to route `gate` first:

```ts
export async function runEval(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "gate") {
    return runEvalGate(args);
  }
  if (subcommand !== "run") {
    console.error(fail(USAGE));
    process.exit(1);
  }
  // ... existing run body unchanged ...
```

And extend the `USAGE` constant to mention both:

```ts
const USAGE =
  "Usage:\n" +
  "  rax eval run --suite <path> [--provider anthropic|openai|test] [--agent <name>]\n" +
  "  rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId> [--metric|--min-lift|--max-tok|--min-tiers]";
```

- [ ] **Step 6: Build the CLI**

Run: `bunx turbo run build --filter=@reactive-agents/cli`
Expected: build success (the `import type` from benchmarks resolves; no static runtime dep added).

- [ ] **Step 7: Smoke the command against a fixture report (best-effort)**

Write a tiny fixture SessionReport JSON to a temp path (a 2-tier, 2-variant report shaped like `packages/benchmarks/tests/gate.test.ts`'s `makeReport`/`tvr` fixtures — `taskReports[]` with `modelVariantId`, `variantId`, `meanScores:[{dimension:"accuracy",score}]`, `meanTokens`, `variance`, plus the required top-level `sessionId`/`sessionVersion`/`gitSha`/`generatedAt`/`runs`/`reproducibility`). Run:
`bun run apps/cli/src/index.ts eval gate --report <tmp> --baseline base --candidate cand` and confirm a receipt prints and the exit code matches the verdict (`echo $?`). If running the CLI entrypoint directly is impractical, note it and rely on the `decideExitCode` unit tests + the build. Do NOT block on this.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/eval-gate.ts apps/cli/src/commands/eval.ts apps/cli/tests/eval-gate.test.ts
git commit -m "feat(cli): rax eval gate — run the lift gate over a benchmark report"
```

---

## Task 2: Register a gateable session + CI workflow

**Files:**
- Modify: `apps/cli/src/commands/bench.ts` (add `frontier-spot-check` to the session registry)
- Create: `.github/workflows/regression-gate.yml`

**Interfaces:**
- Consumes: `frontierSpotCheckSession` from `@reactive-agents/benchmarks` (a 2-variant `bare-llm` vs `ra-full` session over frontier models — runnable in CI with a cloud key); the `rax eval gate` command (Task 1).

- [ ] **Step 1: Confirm the frontier session export + its variant ids**

Run: `grep -rn "frontierSpotCheck\|frontier-spot-check\|bare-llm\|ra-full" packages/benchmarks/src/sessions/frontier-spot-check.ts packages/benchmarks/src/index.ts`
Confirm: the session is exported from `@reactive-agents/benchmarks` (e.g. `frontierSpotCheckSession`), and its `harnessVariants` include `bare-llm` and `ra-full` (the gate's baseline/candidate ids). If it is NOT exported from the package entry, add the export in `packages/benchmarks/src/index.ts` (match the existing session re-export style). If its variants differ, note the actual baseline/candidate ids to use in the workflow.

- [ ] **Step 2: Register the session in the bench CLI**

In `apps/cli/src/commands/bench.ts`, add `frontierSpotCheckSession` to the destructured import and the `sessions` registry (matching the existing entries):

```ts
const { runSession, regressionGateSession, realWorldFullSession, localModelsSession, competitorComparisonSession, frontierSpotCheckSession } = benchmarks;
const sessions: Record<string, any> = {
  "regression-gate": regressionGateSession,
  "real-world-full": realWorldFullSession,
  "local-models": localModelsSession,
  "competitor-comparison": competitorComparisonSession,
  "frontier-spot-check": frontierSpotCheckSession,
};
```

- [ ] **Step 3: Build + confirm the session is selectable**

Run: `bunx turbo run build --filter=@reactive-agents/cli` and `bunx turbo run build --filter=@reactive-agents/benchmarks`
Expected: builds green. (No unit test for the registry line — it's a one-line wiring change; the build + the existing CLI contract tests cover it. If `apps/cli/tests/cli-contracts.test.ts` enumerates sessions, update it.)

- [ ] **Step 4: Create the CI workflow**

Create `.github/workflows/regression-gate.yml`:

```yaml
name: Regression Gate

# Manual-only: a live bench run needs provider keys (set as repo secrets).
# Mirrors eval.yml's workflow_dispatch posture.
on:
  workflow_dispatch:
    inputs:
      session:
        description: "Benchmark session id (must have a baseline + candidate variant)"
        required: true
        default: "frontier-spot-check"
      baseline:
        description: "Baseline variant id"
        required: true
        default: "bare-llm"
      candidate:
        description: "Candidate variant id"
        required: true
        default: "ra-full"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  regression-gate:
    name: Run + gate a benchmark session
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.10"
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Build packages
        run: bun run build
      - name: Run benchmark session
        run: bun run apps/cli/src/index.ts bench --session "${{ inputs.session }}" --output report.json
      - name: Gate the report (fails on reject)
        run: bun run apps/cli/src/index.ts eval gate --report report.json --baseline "${{ inputs.baseline }}" --candidate "${{ inputs.candidate }}"
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: session-report
          path: report.json
```

(Match the bun version + checkout/setup-bun action versions used by the existing `eval.yml`/`ci.yml` — adjust if those pin different versions. The `bun run apps/cli/src/index.ts` invocation mirrors how the repo runs the CLI from source; if there's a package script alias for the CLI, prefer it.)

- [ ] **Step 5: Validate the workflow file**

Confirm the YAML parses (e.g. `bunx js-yaml .github/workflows/regression-gate.yml` if available, or a manual structural read) and that the `bench`/`eval gate` invocations match the real CLI entrypoint + flags from Task 1. No automated test for a workflow file — the validation is structural + flag-consistency with Task 1.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/bench.ts .github/workflows/regression-gate.yml
git commit -m "feat(ci): regression-gate workflow + register frontier-spot-check session"
```

---

## Done Criteria

- `rax eval gate --report <json> --baseline <id> --candidate <id> [policy flags]` reads a `SessionReport`, applies `evaluateLiftGate`, prints `formatGateReceipt`, and exits: `reject`→1, `default-on`/`opt-in`→0, no-comparable-tiers→2.
- `decideExitCode` is pure + unit-tested; the command degrades gracefully (friendly error) when benchmarks is absent or the report is missing/invalid.
- `rax eval run` is unchanged; `runEval` dispatches `run | gate`.
- A `frontier-spot-check` session is selectable via `rax bench --session`, and `.github/workflows/regression-gate.yml` (workflow_dispatch) runs bench → gate → fails on reject.
- CLI builds green; existing CLI tests + the new `decideExitCode` tests pass. No static `@reactive-agents/benchmarks` dep added to the CLI.

## Deferred (NOT in this plan)
- **ImprovementLedger (L4):** formalize `loop-state.json` into code-owned weakness→hypothesis→verdict→fix→regression-baseline (skill-coupled; separate phase).
- A per-PR blocking gate (needs a keyless/local-runnable session or committed baseline reports).
- Cross-run gating (baseline = a stored prior report vs current) — `evaluateLiftGate` is cross-variant within one report; cross-run is a separate path.
- Product sugar `ReactiveAgents.eval().against().gate()` + cortex receipt panel.

## Self-Review notes
- **Spec coverage:** implements canonical-evaluation-system §7 Phase 4's "gate surface" (rax eval gate + CI) and the eval-lift-gate spec §5.1 (CLI/CI dev gate). The ImprovementLedger half of spec-P4 is explicitly deferred per the chosen scope.
- **Risk controls:** the gate command is report-mode (no live models in the command); benchmarks is dynamic-imported (matches `bench.ts`, no published→private static dep); `decideExitCode` is the pure tested core; CI is manual `workflow_dispatch` (no flaky per-PR live run). All error paths (missing flags, unreadable file, bad JSON, missing benchmarks) exit with friendly messages.
- **Type consistency:** `decideExitCode`, `runEvalGate`, the flag names (`--report/--baseline/--candidate/--metric/--min-lift/--max-tok/--min-tiers`), and exit-code semantics are identical across tasks + the workflow.
- **Placeholder scan:** every code step carries complete code; uncertain bits (frontier session export name/variants, Bun.file missing-file behavior, CLI-from-source invocation) are handled by explicit inspection/verify steps.
