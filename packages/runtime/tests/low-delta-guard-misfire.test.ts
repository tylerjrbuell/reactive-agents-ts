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
// ── Why this cell was blocked, and what unblocked it (2026-07-26)
//
// It first landed `describe.skip`, on a measurement that said the kernel path
// executed zero scripted tool calls where the inline path executed them fine.
// That measurement was real; the conclusion drawn from it ("structural to the
// kernel path") was wrong.
//
// The actual cause was in the instrument. Harness-internal LLM calls — above
// all the tool-relevance classifier, which runs BEFORE the agent's first think
// and retries on a parse failure — shared the deterministic provider's single
// turn cursor with the agent. A classifier attempt cannot answer a `toolCall`
// turn, so each one burned a turn the agent had not consumed yet. Against a
// tool-calling scenario the classifier ate the script, `think` reached the
// trailing text turn, and the run terminated `end_turn` at one step having
// called nothing. The kernel was never at fault; the test provider was
// answering the harness out of the agent's script.
//
// The provider now separates the two channels (llm-provider/src/testing.ts) and
// the gateway stamps `purpose` on every mediated request so it can. Which is
// why the scenario below opens with a `json` turn: that is the CLASSIFIER's
// turn, consumed on the harness channel, naming the tool the agent is about to
// use. Without it the classifier returns nothing relevant and the kernel's tool
// surface prunes to empty — the agent then emits `file-write` and the act phase
// has nothing to dispatch it to.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestTurn } from "@reactive-agents/llm-provider";
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

function terseWorkScenario(): TestTurn[] {
  return [
    // HARNESS channel — the tool-relevance classifier's turn. It must name
    // file-write or the kernel prunes it out of the tool surface and the act
    // phase has nothing to dispatch. Deliberately `relevant` and not
    // `required`: a required tool blocks low_delta_guard outright
    // (`missingRequiredForLowDelta`), which would make this measurement void.
    { json: { required: [], relevant: ["file-write"] } },
    // AGENT channel — each turn a SHORT assistant message (low token delta)
    // issuing a SUCCESSFUL write to a DISTINCT path (new evidence). That
    // combination is exactly what the guard cannot currently distinguish from
    // a stall.
    ...STEP_PATHS.map((path, i) => ({
      match: i === 0 ? "TERSE_TRIGGER" : `.lowdelta-${STEP_KEYS[i - 1]}`,
      toolCall: { name: "file-write", args: { path, content: `${STEP_KEYS[i]} payload` } },
    })),
    { text: "Done." },
  ];
}

async function runArm(evidenceReset: boolean): Promise<{
  readonly guards: readonly GuardEvent[];
  readonly toolInvocations: number;
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
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(10)
      .withTools()
      .withObservability({ tracing: { dir } })
      .withTestScenario(terseWorkScenario())
      .build();

    await agent.run(TASK, { taskId: `lowdelta-${evidenceReset ? "evidence" : "legacy"}` });
    await agent.dispose();

    const guards: GuardEvent[] = [];
    let toolInvocations = 0;
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(dir, f), "utf-8")).split("\n")) {
        if (!line.trim()) continue;
        let ev: GuardEvent & { entries?: ReadonlyArray<{ kind?: string }> };
        try {
          ev = JSON.parse(line) as typeof ev;
        } catch {
          continue;
        }
        if (ev.kind === "guard-fired") guards.push(ev);
        // The kernel path records tool execution on the RunLedger, not as the
        // engine's `tool-call-end` event — reading the wrong one here is what
        // made the kernel look inert in the first place.
        if (ev.kind === "ledger-entry") {
          for (const e of ev.entries ?? []) {
            if (e.kind === "tool-invocation") toolInvocations += 1;
          }
        }
      }
    }
    return { guards, toolInvocations };
  } finally {
    if (prev === undefined) delete process.env[EVIDENCE_RESET_ENV];
    else process.env[EVIDENCE_RESET_ENV] = prev;
    await rm(dir, { recursive: true, force: true });
    for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  }
}

const lowDeltaTerminations = (g: readonly GuardEvent[]): readonly GuardEvent[] =>
  g.filter((e) => e.guard === "low_delta_guard" && e.outcome === "terminate");

describe("low_delta_guard on a terse-but-progressing run", () => {
  it("CONTROL: the scripted run actually executes tools", async () => {
    const legacy = await runArm(false);
    // Without this the arms below could agree for the trivial reason that no
    // work happened — the malformed-probe trap that cost this project a long
    // stretch twice. A guard comparison over two empty runs proves nothing.
    expect(legacy.toolInvocations).toBeGreaterThan(0);
  }, 60_000);

  it("CONTROL: the legacy arm still REPRODUCES the misfire", async () => {
    const legacy = await runArm(false);
    // The anchor that keeps the assertion below from rotting into a vacuous
    // pass. "No misfires under the reset" proves nothing unless the arm without
    // the reset actually misfires — if the guard stops firing here for some
    // unrelated reason, this cell has quietly stopped measuring anything and
    // must say so rather than stay green.
    //
    // Observed shape, which matches the live rw-4 trace almost exactly:
    //   low_delta_guard terminate { tokenDelta: 0, consecutiveLowDeltaCount: 6,
    //                               artifactsAvailable: 2 }
    const misfires = lowDeltaTerminations(legacy.guards).filter(
      (e) => (e.metadata?.artifactsAvailable ?? 0) > 0,
    );
    expect(misfires.length).toBeGreaterThan(0);
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
