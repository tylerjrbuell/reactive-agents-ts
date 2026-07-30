// Run: bun test packages/runtime/tests/mechanism-liveness.test.ts --timeout 120000
//
// NO INERT FLAGS. Every env-gated harness mechanism must still DO something.
//
// The harness carries a set of opt-in mechanisms held behind env flags, each
// waiting on a lift measurement before any default-on decision. That is sound
// policy, but it has a failure mode: a flag nobody exercises can quietly stop
// working. A refactor drops the read, a threaded option stops being consumed,
// and the flag keeps existing while doing nothing — so when someone finally
// runs the ablation, they measure a no-op and conclude the MECHANISM is
// worthless rather than that its wiring rotted.
//
// This cell flips each flag and asserts the run observably changes. It does not
// assert the change is GOOD — that is the lift rule's job, and deciding it here
// would be exactly the metric-gaming the project forbids. It asserts only that
// there is something there to measure.
//
// ── Watch the right channel, or you will call a live mechanism dead
//
// Building this, a census that looked only at trace event KINDS reported two of
// these flags inert. Both were live:
//
//   • RA_THOUGHT_CONTINUITY renders the recorded thought on replayed assistant
//     turns — and the scenario had no thought to render, because the test
//     provider could not express a turn carrying BOTH assistant text and a tool
//     call. That is the dominant real-model shape (Anthropic emits a text block
//     then a tool_use block). Fixed in llm-provider/src/testing.ts; the flag
//     changed the prompt immediately afterwards.
//   • RA_TOOL_OBSERVE_SYMMETRY attaches a VerificationResult to the observation
//     STEP and forks a memory write. Neither is a trace event, so a
//     kind-counting probe sees nothing.
//
// So each mechanism below names the channel it actually moves. An absence
// measured on the wrong channel is not evidence of absence — this project has
// already published one structural conclusion off exactly that mistake.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/index.js";

const STEP_KEYS = ["alpha", "beta"] as const;
const STEP_PATHS = STEP_KEYS.map((k) => `./.liveness-${k}.tmp.md`);
const TASK = "TERSE_TRIGGER: perform the multi-step write work, one file per step.";

/**
 * Tool turns carry assistant text on purpose: without it there is no recorded
 * thought, and any mechanism keyed on what the model SAID while calling a tool
 * has nothing to act on.
 */
const scenario = (): TestTurn[] => [
  ...STEP_PATHS.map((path, i) => ({
    match: i === 0 ? "TERSE_TRIGGER" : `.liveness-${STEP_KEYS[i - 1]}`,
    text: `Deriving the plan for step ${i}: I will write ${path} next.`,
    toolCall: { name: "file-write", args: { path, content: `${STEP_KEYS[i]} payload` } },
  })),
  { text: "Done." },
];

interface Observation {
  /** Total prompt bytes sent to the model — moves when context assembly changes. */
  readonly promptChars: number;
  /** Observation steps carrying a VerificationResult. */
  readonly verifiedObservations: number;
  readonly guards: readonly string[];
  readonly toolInvocations: number;
}

async function observe(
  label: string,
  env: Readonly<Record<string, string>>,
): Promise<Observation> {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    process.env[k] = v;
  }
  for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  const dir = await mkdtemp(join(tmpdir(), "ra-liveness-"));
  try {
    const agent = await ReactiveAgents.create()
      .withName(label)
      .withProvider("test")
      .withModel("test-model")
      .withMaxIterations(10)
      // allowedTools floors file-write into the visible surface without
      // depending on the (opt-in, as of 2026-07-28/29) tool-relevance
      // classifier — see low-delta-guard-misfire.test.ts for the same fix.
      .withTools({ allowedTools: ["file-write"] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withObservability({ tracing: { dir } })
      .withTestScenario(scenario())
      .build();

    const result = await agent.run(TASK, { taskId: label });
    await agent.dispose();

    let promptChars = 0;
    const guards: string[] = [];
    let toolInvocations = 0;
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(dir, f), "utf-8")).split("\n")) {
        if (!line.trim()) continue;
        let ev: {
          kind?: string;
          guard?: string;
          systemPrompt?: string;
          messages?: unknown;
          entries?: ReadonlyArray<{ kind?: string }>;
        };
        try {
          ev = JSON.parse(line) as typeof ev;
        } catch {
          continue;
        }
        if (ev.kind === "llm-exchange") {
          promptChars += (ev.systemPrompt ?? "").length + JSON.stringify(ev.messages ?? []).length;
        }
        if (ev.kind === "guard-fired" && ev.guard !== undefined) guards.push(ev.guard);
        if (ev.kind === "ledger-entry") {
          for (const e of ev.entries ?? []) {
            if (e.kind === "tool-invocation") toolInvocations += 1;
          }
        }
      }
    }

    const steps =
      (result.metadata as { reasoningSteps?: ReadonlyArray<Record<string, unknown>> } | undefined)
        ?.reasoningSteps ?? [];
    const verifiedObservations = steps.filter(
      (s) =>
        s["type"] === "observation" &&
        (s["metadata"] as Record<string, unknown> | undefined)?.["verification"] !== undefined,
    ).length;

    return { promptChars, verifiedObservations, guards, toolInvocations };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
    for (const p of STEP_PATHS) await rm(join(process.cwd(), p), { force: true });
  }
}

describe("no inert flags — every gated mechanism still does something", () => {
  it("CONTROL: the baseline run does real work", async () => {
    // Every assertion below is a DIFFERENCE against this run. If the baseline
    // executed nothing, the differences would be meaningless and the whole
    // file would pass vacuously.
    const base = await observe("base-control", {});
    expect(base.toolInvocations).toBeGreaterThan(0);
    expect(base.promptChars).toBeGreaterThan(0);
  }, 120_000);

  it("RA_LAZY_TOOLS=0 discloses the full toolbox (prompt grows)", async () => {
    const base = await observe("lazy-base", {});
    const eager = await observe("lazy-off", { RA_LAZY_TOOLS: "0" });
    expect(eager.promptChars).toBeGreaterThan(base.promptChars);
  }, 120_000);

  it("RA_THOUGHT_CONTINUITY=1 replays the model's own reasoning", async () => {
    // #38 in the debt register: "flag shipped, never measured". It is
    // measurable now — a turn can finally carry both a thought and a tool call,
    // which is what the mechanism needs to have anything to replay.
    const base = await observe("thought-base", {});
    const on = await observe("thought-on", { RA_THOUGHT_CONTINUITY: "1" });
    expect(on.promptChars).toBeGreaterThan(base.promptChars);
  }, 120_000);

  it("RA_RATIONALE_AUDIT=1 asks for a per-call rationale", async () => {
    const base = await observe("rationale-base", {});
    const on = await observe("rationale-on", { RA_RATIONALE_AUDIT: "1" });
    expect(on.promptChars).toBeGreaterThan(base.promptChars);
  }, 120_000);

  it("RA_TOOL_OBSERVE_SYMMETRY=1 attaches verification on the SINGLE path", async () => {
    // Not a trace event — it lands on the observation STEP, which is why a
    // kind-counting census called this one dead.
    const base = await observe("symmetry-base", {});
    const on = await observe("symmetry-on", { RA_TOOL_OBSERVE_SYMMETRY: "1" });
    expect(base.verifiedObservations).toBe(0);
    expect(on.verifiedObservations).toBeGreaterThan(0);
  }, 120_000);

  it("REACTIVE_AGENTS_EVIDENCE_DELTA_RESET=1 stops the low_delta misfire", async () => {
    const base = await observe("evidence-base", {});
    const on = await observe("evidence-on", {
      REACTIVE_AGENTS_EVIDENCE_DELTA_RESET: "1",
    });
    // Both arms must do the same work, or the guard difference is about one
    // arm quitting early for an unrelated reason.
    expect(on.toolInvocations).toBe(base.toolInvocations);
    expect(base.guards).toContain("low_delta_guard");
    expect(on.guards).not.toContain("low_delta_guard");
  }, 120_000);
});
