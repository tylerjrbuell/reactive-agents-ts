// Run: bun test packages/runtime/tests/low-delta-guard-misfire.test.ts --timeout 60000
//
// The low_delta_guard misfire, as a SCRIPTED cell (2026-07-26).
//
// This is the instrument change, not just another test. The misfire was found
// live (bench rw-4/rw-7 on claude-haiku: 5 of 9 traced runs terminated with 3–5
// artifacts already produced), and every attempt to MEASURE it live was a bad
// deal — ~100s and real tokens per sample, one Bernoulli bit of accuracy out,
// and the local tier does not reproduce it at all (qwen3:4b emits ~1300
// tokens/iteration of visible reasoning, so tokenDelta never approaches the 500
// threshold; a full local ablation produced ZERO guard fires in either arm and
// was therefore void).
//
// So the defect is scripted here instead of hunted for. `withTestScenario` can
// author exactly the shape that triggers it — SHORT assistant turns (low token
// delta) against SUCCESSFUL tool calls (real evidence progress) — which turns a
// model-tier-dependent, expensive, noisy live measurement into a deterministic
// zero-cost assertion that runs on every commit.
//
// It also supplies the end-to-end pin the ablation seam was missing: the unit
// test in guard-adapters.test.ts proves `nextLowDeltaCount` respects the env
// var, but nothing proved the var changes LIVE kernel behaviour. Cutting the
// wiring must fail a test, not just cutting the function.
//
// ── BLOCKED (2026-07-26): scripted tool calls never reach the KERNEL act phase.
//
// Measured with a paired probe, identical task + identical scenario, only the
// path differing:
//
//   inline (.withTools())                     tool-call-end: 1   ← fires
//   kernel (.withReasoning({reactive}))       tool-call-end: 0
//   kernel + .withRequiredTools({adaptive:false})  tool-call-end: 0
//   kernel + .withLeanHarness()               tool-call-end: 0
//
// The kernel runs resolve tools (`tool-surface-resolved`), compile a contract,
// compute an assessment, render a projection and fire a guard — everything
// except execute the scripted call. So this is not the documented
// classifier-consumption trap (suppressing the classifier changes nothing); it
// is structural to the kernel path under the `test` provider.
//
// CONSEQUENCE, and it is bigger than this one cell: every harness mechanism
// that lives in the kernel — the guards, RunAssessment, the Projector, the
// control plane, i.e. all of Waves D/E/F — currently CANNOT be exercised by a
// scripted deterministic cell. That is precisely why these defects only ever
// surface on expensive, noisy, model-tier-dependent live runs. Closing this gap
// is the highest-leverage instrument work available.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

const EVIDENCE_RESET_ENV = "REACTIVE_AGENTS_EVIDENCE_DELTA_RESET";

interface GuardEvent {
  readonly kind: string;
  readonly guard?: string;
  readonly outcome?: string;
  readonly metadata?: { readonly tokenDelta?: number; readonly artifactsAvailable?: number };
}

/**
 * The terse-model shape: each turn is a SHORT tool call (few output tokens →
 * low token delta) that SUCCEEDS against a distinct target (new evidence). This
 * is what a model doing real work with big tool results looks like to a guard
 * that only measures token delta.
 */
const STEP_KEYS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

/** Files this scenario writes, relative to cwd (file-write confines to the root). */
const STEP_PATHS = STEP_KEYS.map((k) => `./.lowdelta-${k}.tmp.md`);

// The trigger sits EARLY in the task. (The push-past-char-200 idiom in
// subagent/ledger-merge.test.ts solves a different problem — keeping a CHILD's
// truncated inherited prefix from matching — and applying it here moved the
// trigger outside the window the matcher actually sees, so nothing fired.)
const TASK = "TERSE_TRIGGER: perform the multi-step write work, one file per step.";

function terseWorkScenario(): ReadonlyArray<Record<string, unknown>> {
  // Each turn: a SHORT assistant message (low token delta) issuing a SUCCESSFUL
  // write to a DISTINCT path (new evidence). That combination is exactly what
  // the guard cannot currently distinguish from a stall.
  return [
    ...STEP_PATHS.map((path, i) => ({
      match: i === 0 ? "TERSE_TRIGGER" : `.lowdelta-${STEP_KEYS[i - 1]}`,
      toolCall: { name: "file-write", args: { path, content: `${STEP_KEYS[i]} payload` } },
    })),
    { text: "Done." },
  ];
}

async function runArm(evidenceReset: boolean): Promise<{
  readonly guards: readonly GuardEvent[];
  readonly toolCalls: number;
}> {
  const dir = await mkdtemp(join(tmpdir(), "ra-lowdelta-"));
  const prev = process.env[EVIDENCE_RESET_ENV];
  if (evidenceReset) process.env[EVIDENCE_RESET_ENV] = "1";
  else delete process.env[EVIDENCE_RESET_ENV];
  try {
    const agent = await ReactiveAgents.create()
      .withName(evidenceReset ? "evidence-arm" : "legacy-arm")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ strategy: "reactive" })
      .withMaxIterations(10)
      .withTools()
      // Suppresses the adaptive tool-relevance CLASSIFIER, whose own LLM call
      // otherwise consumes the scripted turns before the act phase ever runs —
      // the documented withTestScenario trap. Deliberately NOT the
      // `{ tools: [...] }` form: a required tool would block low_delta_guard
      // outright (`missingRequiredForLowDelta`) and make this measurement void.
      .withRequiredTools({ adaptive: false })
      .withObservability({ tracing: { dir } })
      .withTestScenario(terseWorkScenario())
      .build();

    await agent.run(TASK, { taskId: `lowdelta-${evidenceReset ? "evidence" : "legacy"}` });
    await agent.dispose();

    const guards: GuardEvent[] = [];
    let toolCalls = 0;
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(dir, f), "utf-8")).split("\n")) {
        if (!line.trim()) continue;
        let ev: GuardEvent;
        try {
          ev = JSON.parse(line) as GuardEvent;
        } catch {
          continue;
        }
        if (ev.kind === "guard-fired") guards.push(ev);
        if (ev.kind === "tool-call-end") toolCalls += 1;
      }
    }
    return { guards, toolCalls };
  } finally {
    if (prev === undefined) delete process.env[EVIDENCE_RESET_ENV];
    else process.env[EVIDENCE_RESET_ENV] = prev;
    await rm(dir, { recursive: true, force: true });
    for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  }
}

const lowDeltaTerminations = (g: readonly GuardEvent[]): readonly GuardEvent[] =>
  g.filter((e) => e.guard === "low_delta_guard" && e.outcome === "terminate");

// BLOCKED — see the header note. `describe.skip` rather than deletion: the cell
// is correct and activates the moment scripted tool calls reach the kernel act
// phase. Left failing it would be noise; left deleted the finding would be lost.
describe.skip("low_delta_guard on a terse-but-progressing run", () => {
  it("CONTROL: the scripted run actually executes tools", async () => {
    const legacy = await runArm(false);
    // Without this the arms below could agree for the trivial reason that no
    // work happened — the malformed-probe trap that cost this project a long
    // stretch twice. A guard comparison over two empty runs proves nothing.
    expect(legacy.toolCalls).toBeGreaterThan(0);
  }, 60_000);

  it("the evidence reset does not INCREASE low-delta terminations", async () => {
    const legacy = await runArm(false);
    const evidence = await runArm(true);
    // Deterministic provider, identical script: the reset can only ever remove a
    // termination, never add one. A violation means the seam is doing something
    // other than what it claims.
    expect(lowDeltaTerminations(evidence.guards).length).toBeLessThanOrEqual(
      lowDeltaTerminations(legacy.guards).length,
    );
  }, 60_000);

  it("never terminates on low delta while artifacts are still accruing", async () => {
    const evidence = await runArm(true);
    // The defect, stated as a property: a run that produced artifacts this
    // iteration is progressing, and the diminishing-returns guard must not end
    // it. `artifactsAvailable > 0` at a low_delta termination IS the misfire —
    // it is what the live traces recorded (rw-4: tokenDelta 0, artifacts 4).
    const misfires = lowDeltaTerminations(evidence.guards).filter(
      (e) => (e.metadata?.artifactsAvailable ?? 0) > 0,
    );
    expect(misfires).toEqual([]);
  }, 60_000);
});
