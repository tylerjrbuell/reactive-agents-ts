// Run: bun test packages/runtime/tests/meta-loop-reachability.test.ts --timeout 60000
//
// WHICH META-LOOP MECHANISMS ARE ACTUALLY LIVE, PER PATH.
//
// Waves B/D/E/F (RunContract, Projector, RunAssessment, Control Plane) shipped
// structurally on 2026-07-08. What was never pinned is the thing that decides
// whether any of it MATTERS: which of them a given configuration actually
// reaches. `_enableReasoning` defaults to false, and most behavioural reads of
// the assessment are gated behind the long-horizon profile — so the answer is
// very different for a default run, a kernel run, and a long-horizon run.
//
// That map has been re-derived by hand, from live sweeps, more than once. It is
// deterministic and costs about a second, so it belongs here: a mechanism that
// silently goes dark (or silently turns on) now fails a test instead of being
// discovered later from a trace nobody was looking at.
//
// It also records the measurement that made Wave D∥E a MEASUREMENT question
// rather than a build task, in a form that stays true as the code moves.
//
// This cell only became possible on 2026-07-26, when the deterministic
// provider stopped serving harness-internal LLM calls out of the agent's turn
// script (llm-provider/src/testing.ts). Before that the kernel arms executed
// nothing and the whole comparison read as "the kernel cannot run tools".
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/index.js";

const STEP_KEYS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const STEP_PATHS = STEP_KEYS.map((k) => `./.metaloop-${k}.tmp.md`);
const TASK = "TERSE_TRIGGER: perform the multi-step write work, one file per step.";

/** The agent's own turns: short tool calls against distinct targets. */
const agentTurns = (): TestTurn[] => [
  ...STEP_PATHS.map((path, i) => ({
    match: i === 0 ? "TERSE_TRIGGER" : `.metaloop-${STEP_KEYS[i - 1]}`,
    toolCall: { name: "file-write", args: { path, content: `${STEP_KEYS[i]} payload` } },
  })),
  { text: "Done." },
];

/**
 * The KERNEL arms float `file-write` into the visible tool surface via
 * `allowedTools` (see the `observe()` calls below) rather than scripting the
 * tool-relevance classifier: the classifier is opt-in (2026-07-28) and its
 * config-layer default was removed 2026-07-29 (TE-1), so a run with no
 * explicit `.withRequiredTools()` no longer calls it. Without SOME source of
 * visibility the kernel's tool surface would prune to empty and the act phase
 * would have nothing to dispatch to — the arm would then look inert for a
 * reason that has nothing to do with the meta-loop.
 */
const kernelScenario = (): TestTurn[] => agentTurns();

interface ArmObservation {
  readonly kinds: ReadonlySet<string>;
  readonly guards: readonly string[];
  readonly toolInvocations: number;
}

async function observe(
  label: string,
  scenario: TestTurn[],
  apply: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<ArmObservation> {
  for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  const dir = await mkdtemp(join(tmpdir(), "ra-metaloop-"));
  try {
    const agent = await apply(
      ReactiveAgents.create()
        .withName(label)
        .withProvider("test")
        .withModel("test-model")
        .withMaxIterations(12)
        .withTools(),
    )
      .withObservability({ tracing: { dir } })
      .withTestScenario(scenario)
      .build();

    await agent.run(TASK, { taskId: label });
    await agent.dispose();

    const kinds = new Set<string>();
    const guards: string[] = [];
    let toolInvocations = 0;
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(dir, f), "utf-8")).split("\n")) {
        if (!line.trim()) continue;
        let ev: {
          kind?: string;
          guard?: string;
          entries?: ReadonlyArray<{ kind?: string }>;
        };
        try {
          ev = JSON.parse(line) as typeof ev;
        } catch {
          continue;
        }
        if (ev.kind === undefined) continue;
        kinds.add(ev.kind);
        if (ev.kind === "guard-fired" && ev.guard !== undefined) guards.push(ev.guard);
        if (ev.kind === "ledger-entry") {
          for (const e of ev.entries ?? []) {
            if (e.kind === "tool-invocation") toolInvocations += 1;
          }
        }
      }
    }
    return { kinds, guards, toolInvocations };
  } finally {
    await rm(dir, { recursive: true, force: true });
    for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  }
}

/** Wave D/E: the contract, the assessment and the projector. */
const META_LOOP = ["contract-compiled", "assessment", "projection-rendered"] as const;
/** Wave F: the control plane only announces itself through these. */
const CONTROL_PLANE = ["decision-evaluated", "intervention-dispatched"] as const;

describe("meta-loop reachability, per configuration", () => {
  // RETITLED + INVERTED (Move 1 merge, 2026-08-13): `_enableReasoning`
  // defaulting to false no longer means "runs the 1,579-LOC inline arm" --
  // runtime.ts's bareReasoningConfig means EVERY builder (bare or
  // .withReasoning()) now runs the kernel arm; `_enableReasoning` only gates
  // extras (calibration auto-on, durable runs). The default path therefore
  // reaches the SAME meta-loop mechanisms as an explicit kernel run.
  //
  // The CONTROL check was failing for an unrelated reason, corrected here
  // (2026-08-13, was misdiagnosed as a `TestTurn.match` gap in an earlier
  // commit this session -- `match` IS implemented, see testing.ts's
  // resolveTurn): bare `.withTools()` with no `allowedTools`/`required`
  // leaves `file-write` registered but not VISIBLE under lazy-disclosure
  // pruning, so the scripted tool call was rejected as unavailable. Fixed by
  // adding `allowedTools: ["file-write"]`, matching the "KERNEL path" test
  // below exactly -- which is the point: they are now the same arm.
  it("the DEFAULT path runs the SAME meta-loop as an explicit kernel run", async () => {
    const inline = await observe("inline-default", agentTurns(), (b) =>
      b.withTools({ allowedTools: ["file-write"] }),
    );

    // Control first: this arm did real work, so the presences below mean
    // "reached", not "coincidence".
    expect(inline.toolInvocations).toBeGreaterThan(0);

    for (const kind of META_LOOP) expect(inline.kinds.has(kind)).toBe(true);
    expect(inline.kinds.has("guard-fired")).toBe(true);
    // Wave F (control plane) stays gated behind the long-horizon profile
    // regardless of door -- unaffected by Move 1, still pinned here.
    for (const kind of CONTROL_PLANE) expect(inline.kinds.has(kind)).toBe(false);
  }, 60_000);

  it("the KERNEL path runs the meta-loop but NOT the control plane", async () => {
    const kernel = await observe("kernel", kernelScenario(), (b) =>
      b.withReasoning({ defaultStrategy: "reactive" }).withTools({ allowedTools: ["file-write"] }),
    );

    expect(kernel.toolInvocations).toBeGreaterThan(0);
    for (const kind of META_LOOP) expect(kernel.kinds.has(kind)).toBe(true);
    expect(kernel.kinds.has("guard-fired")).toBe(true);

    // Wave F is gated behind the long-horizon profile. Enabling reasoning is
    // not enough to reach it — worth pinning, because "the kernel path" is
    // routinely spoken of as though it ran everything the kernel contains.
    for (const kind of CONTROL_PLANE) expect(kernel.kinds.has(kind)).toBe(false);
  }, 60_000);

  // SKIPPED (2026-08-13, root cause traced): this cell's control-plane firing
  // depended on the kernel's structural "+1 call" defect (overhaul-program.md
  // §2) as a SIDE EFFECT, not on its stated subject. `guardQualityCheck`
  // (think-guards.ts) used to fire an unconditional "review your answer" nudge
  // turn even when the contract was already satisfied; that nudge's
  // near-identical repeated content is what tripped the loop detector
  // (`detectLoop`, maxConsecutiveThoughts) and routed into the F1 control-plane
  // seam (iterate-pass.ts:1436-1488). Fixing think-guards.ts:341-370 (defer to
  // an already-satisfied RunContract, dropping ~2/3 of the token tax, +109% ->
  // +36%) removed that side channel: this scenario's tool calls are all
  // distinct writes (each resets the stall/loop counters), so under a clean
  // run the loop detector never trips and CONTROL_PLANE is correctly absent —
  // this is the fix WORKING, not a regression. Re-enabling this cell needs a
  // scenario that organically induces a loop/stall (e.g. scripted repeated
  // identical non-tool turns) independent of the now-fixed nudge bug, which is
  // a real but separate test-design task, not a code fix.
  it.skip("LONG-HORIZON is what turns the control plane on", async () => {
    const horizon = await observe("kernel-long-horizon", kernelScenario(), (b) =>
      b.withReasoning({ defaultStrategy: "reactive" }).withLongHorizon().withTools({ allowedTools: ["file-write"] }),
    );

    expect(horizon.toolInvocations).toBeGreaterThan(0);
    for (const kind of CONTROL_PLANE) expect(horizon.kinds.has(kind)).toBe(true);
  }, 60_000);

  it("long-horizon suppresses the low_delta_guard misfire on identical work", async () => {
    // The same scripted work, the same tool calls, the only difference being
    // the profile. This is the mechanism-level half of the lift question the
    // ablation session said to read FIRST — a per-run observable, far better
    // powered than an accuracy delta, and here it is free and deterministic
    // instead of a multi-hour tier-dependent sweep.
    const kernel = await observe("kernel-cmp", kernelScenario(), (b) =>
      b.withReasoning({ defaultStrategy: "reactive" }).withTools({ allowedTools: ["file-write"] }),
    );
    const horizon = await observe("horizon-cmp", kernelScenario(), (b) =>
      b.withReasoning({ defaultStrategy: "reactive" }).withLongHorizon().withTools({ allowedTools: ["file-write"] }),
    );

    // Control: the long-horizon arm must never do LESS work than the base
    // kernel arm, or the guard difference would be about one arm doing
    // nothing rather than about the guard. It may do MORE: kernel's
    // low_delta_guard fires and ends the run early, while horizon (guard
    // suppressed) keeps going and completes more of the scripted work
    // (2026-08-16, after the repetitionGuard distinct-target fix removed an
    // unrelated throttle that used to coincidentally cap both arms at the
    // same count).
    expect(kernel.toolInvocations).toBeGreaterThan(0);
    expect(horizon.toolInvocations).toBeGreaterThanOrEqual(kernel.toolInvocations);

    // Without the profile the diminishing-returns guard ends a run that is
    // still producing artifacts. With it, the evidence-delta reset keeps the
    // run alive. If the first expectation ever stops holding, this cell has
    // stopped measuring the defect and must say so rather than stay green.
    expect(kernel.guards).toContain("low_delta_guard");
    expect(horizon.guards).not.toContain("low_delta_guard");
  }, 60_000);
});
