// bench:replay:record — mint the committed goldens the bench:replay lane checks.
//
// Records REAL harness runs on the deterministic test provider (no keys, no
// network): each scenario runs the full kernel/tool/assembly path with tracing
// pointed at a temp dir, then the run's ULID trace is copied into
// packages/benchmarks/golden/<name>.jsonl next to a <name>.expect.json sidecar
// carrying the harness config (recordings do not serialize config) and the
// record-side truth assertions.
//
// Re-record ritual: goldens are drift DETECTORS. A legitimate harness change
// that alters the model-call sequence is SUPPOSED to fail bench:replay; rerun
// this script, review the diff of the goldens like any other fixture, commit.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";
import { goldenDir, type GoldenSidecar } from "./replay-lane.js";

/**
 * Stable absolute root for live-mode tool calls. Deliberately NOT the repo or
 * a user directory: goldens embed tool args verbatim, and argsHash parity on
 * replay requires the recorded paths to be recreatable on any machine/CI.
 */
export const GOLDEN_FILE_ROOT = "/tmp/ra-bench-replay-fixroot";

interface GoldenScenario {
  readonly sidecar: GoldenSidecar;
  readonly scenario: readonly Record<string, unknown>[];
}

const SCENARIOS: readonly GoldenScenario[] = [
  {
    // Tool-free run: pins prompt assembly + termination path with zero tools.
    sidecar: {
      name: "answer-only",
      task: "State the capital of France and stop.",
      strategy: "reactive",
      maxIterations: 3,
      toolMode: "recorded",
      expectOutputIncludes: ["Paris"],
      expectToolsUsed: [],
    },
    scenario: [{ text: "FINAL ANSWER: The capital of France is Paris." }],
  },
  {
    // Tool-using run: pins the tool rail end to end (surface, execution,
    // observation, receipt) with a relative path so argsHash is root-agnostic.
    sidecar: {
      name: "tool-write",
      task: "Write a short note to ./note.md and report done.",
      strategy: "reactive",
      builtins: ["file-write"],
      // Static required list — BOTH sides need it: it suppresses the
      // tool-relevance classifier (classifier.ts `hasStaticRequiredList`),
      // whose prompt contains the task text and would otherwise consume the
      // scenario's match-guarded toolCall turn, and its quota forces the tool
      // to actually fire before the terminal.
      requiredTools: ["file-write"],
      maxIterations: 4,
      toolMode: "live",
      fileRoot: GOLDEN_FILE_ROOT,
      expectOutputIncludes: ["done"],
      expectToolsUsed: ["file-write"],
    },
    scenario: [
      { match: "note\\.md", toolCall: { name: "file-write", args: { path: "./note.md", content: "hello from the golden recorder" } } },
      { text: "FINAL ANSWER: wrote the note and it is done." },
    ],
  },
  {
    // ── THE ABLATION SHAPE (added 2026-07-27) ────────────────────────────────
    // Many SHORT assistant turns against real tool results — the shape that
    // trips `low_delta_guard`, because the guard measures TOKEN delta and a
    // model emitting terse tool calls against large results has a delta near
    // zero while doing real work. This is rw-7's signature (`tokenDelta` ~185,
    // `artifactsAvailable` 4–5) reproduced deterministically.
    //
    // WHY THIS GOLDEN EXISTS. The low_delta_guard lift question cost a
    // multi-hour live campaign (three VOID arm-sets first) to answer. Replayed,
    // a terminating mechanism shows up as LLM-table UNDER-CONSUMPTION —
    // `dispensed < tableSize` means the harness stopped before the recording
    // did. That is the same signal, at zero tokens and ~100ms. Proven on
    // tool-write: control 3/3, `maxIterations: 1` variant 1/3.
    //
    // A guard that fires here consumes fewer than the 9 recorded exchanges. Do
    // not "fix" a drift failure by shortening the scenario — the length IS the
    // instrument. It needs enough consecutive low-delta iterations to build the
    // counter past its threshold.
    sidecar: {
      name: "terse-tool-loop",
      // The task text MUST contain "log.txt": the first turn's `match` guard is
      // tested against it, and a guard that never fires makes the provider skip
      // the write turn — the reads then ENOENT and the golden records four tool
      // errors as if they were the harness's behavior. Cost one bad recording.
      task: "Write ./log.txt, then read log.txt back four times, then report done.",
      strategy: "reactive",
      builtins: ["file-write", "file-read"],
      // Static list suppresses the tool-relevance classifier, which would
      // otherwise consume a match-guarded turn (see tool-write above).
      requiredTools: ["file-write", "file-read"],
      maxIterations: 12,
      toolMode: "live",
      fileRoot: GOLDEN_FILE_ROOT,
      expectOutputIncludes: ["done"],
      expectToolsUsed: ["file-write", "file-read"],
    },
    scenario: [
      {
        match: "log\\.txt",
        text: "Writing the log.",
        toolCall: { name: "file-write", args: { path: "./log.txt", content: "line one\nline two\nline three\n" } },
      },
      { text: "Reading it back.", toolCall: { name: "file-read", args: { path: "./log.txt" } } },
      { text: "Again.", toolCall: { name: "file-read", args: { path: "./log.txt" } } },
      { text: "Once more.", toolCall: { name: "file-read", args: { path: "./log.txt" } } },
      { text: "Last read.", toolCall: { name: "file-read", args: { path: "./log.txt" } } },
      { text: "FINAL ANSWER: wrote and re-read the log, it is done." },
    ],
  },
  {
    // Honest decline. Pins the abstention rail end to end — the class of defect
    // where an abstention was scored as a SUCCESS at four sites (register §3).
    // A replay whose output stops containing the decline means the rail broke.
    sidecar: {
      name: "abstain",
      task: "What is the population of Aetheria?",
      strategy: "reactive",
      maxIterations: 3,
      toolMode: "recorded",
      expectOutputIncludes: ["cannot"],
      expectToolsUsed: [],
    },
    scenario: [
      { text: "FINAL ANSWER: I cannot answer that — Aetheria is not a real place I have data for." },
    ],
  },
  {
    // F10: the only golden that populates `goal_state.remaining` and renders a
    // standing frame. Without it, nothing in the corpus can detect a change in
    // WHERE volatile content sits, so the volatile-placement gate would be
    // guarding a case no golden exercises.
    //
    // plan-execute dispatches `tool_call` steps DIRECTLY via
    // executeToolAndObserve (strategies/plan-execute/step-executor.ts) — no
    // per-step LLM call, no assembly/project() involvement for those steps.
    // The three LLM calls this scenario answers are the OUTER strategy calls:
    // plan generation (completeStructured, matched on the PLANNER_PERSONA
    // string "You are a planning agent..."), reflection (runCritiquePass,
    // matched on the reflection prompt's leading "GOAL:" line), and synthesis
    // (gatewayComplete, matched on "Synthesize a clear, complete answer...").
    // The scripted plan writes ./input.txt itself (2 lines) before reading it
    // back, since nothing else seeds that fixture for a live-mode golden.
    sidecar: {
      name: "planned-tool-loop",
      task: "Read ./input.txt, then write the line count to ./count.txt and report the number.",
      // Registered strategy key is "plan-execute-reflect", NOT "plan-execute" —
      // verified against strategy-registry.ts:159. Using "plan-execute" throws
      // StrategyNotFoundError before any LLM call, recording a failure trace.
      strategy: "plan-execute-reflect",
      builtins: ["file-read", "file-write"],
      // Static required list, for the SAME reason tool-write carries one: it
      // suppresses the tool-relevance classifier, whose prompt contains the task
      // text and would otherwise consume this scenario's match-guarded toolCall
      // turns, and its quota forces both tools to fire before the terminal.
      requiredTools: ["file-read", "file-write"],
      maxIterations: 6,
      toolMode: "live",
      fileRoot: GOLDEN_FILE_ROOT,
      expectOutputIncludes: ["2"],
      expectToolsUsed: ["file-read", "file-write"],
    },
    scenario: [
      {
        match: "planning agent",
        json: {
          steps: [
            {
              title: "Create the input file",
              instruction: "Write two lines to ./input.txt so a real file exists to read.",
              type: "tool_call",
              toolName: "file-write",
              toolArgs: { path: "./input.txt", content: "line one\nline two\n" },
            },
            {
              title: "Read the input file",
              instruction: "Read ./input.txt to determine its line count.",
              type: "tool_call",
              toolName: "file-read",
              toolArgs: { path: "./input.txt" },
              dependsOn: ["s1"],
            },
            {
              title: "Write the line count",
              instruction: "Write the line count (2) to ./count.txt.",
              type: "tool_call",
              toolName: "file-write",
              toolArgs: { path: "./count.txt", content: "2" },
              dependsOn: ["s2"],
            },
          ],
        },
      },
      { match: "GOAL:", text: "SATISFIED: all steps completed successfully; the file has 2 lines." },
      { match: "Synthesize", text: "FINAL ANSWER: The input file has 2 lines, and the count 2 was written to count.txt." },
    ],
  },
];

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/;

async function recordOne(spec: GoldenScenario, outDir: string): Promise<void> {
  const traceDir = mkdtempSync(join(tmpdir(), `ra-golden-${spec.sidecar.name}-`));
  const prior = process.env.REACTIVE_AGENTS_TRACE_DIR;
  process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
  try {
    let builder = ReactiveAgents.create()
      .withProvider("test")
      .withModel("test")
      // Scenario turns drive the run; the sequential replay table will dispense
      // exactly these exchanges back.
      .withTestScenario(spec.scenario as never)
      .withReasoning({ defaultStrategy: (spec.sidecar.strategy ?? "reactive") as never });
    builder =
      spec.sidecar.builtins !== undefined
        ? builder.withTools({ builtins: [...spec.sidecar.builtins], adaptive: false })
        : builder.withTools({ adaptive: false });
    if (spec.sidecar.requiredTools !== undefined && spec.sidecar.requiredTools.length > 0) {
      builder = builder.withRequiredTools({ tools: [...spec.sidecar.requiredTools] });
    }
    if (spec.sidecar.maxIterations !== undefined) builder = builder.withMaxIterations(spec.sidecar.maxIterations);
    const agent = await builder.build();

    const run = async () => {
      const result = await agent.run(spec.sidecar.task);
      await agent.dispose();
      return result;
    };
    const result =
      spec.sidecar.toolMode === "live" && spec.sidecar.fileRoot !== undefined
        ? await (async () => {
            rmSync(spec.sidecar.fileRoot!, { recursive: true, force: true });
            mkdirSync(spec.sidecar.fileRoot!, { recursive: true });
            return withFileRoot(spec.sidecar.fileRoot!, run);
          })()
        : await run();
    if (typeof result.output !== "string" || result.output.length === 0) {
      throw new Error(`recording ${spec.sidecar.name}: run produced no output`);
    }

    const golden = readdirSync(traceDir).find((f) => ULID_RE.test(f));
    if (golden === undefined) {
      throw new Error(`recording ${spec.sidecar.name}: no ULID trace written to ${traceDir}`);
    }
    // Sanitize check: a committed golden must not leak user-specific absolute paths.
    const body = readFileSync(join(traceDir, golden), "utf8");
    const home = process.env.HOME ?? "";
    if (home !== "" && body.includes(home)) {
      throw new Error(`recording ${spec.sidecar.name}: golden embeds ${home} — fix the scenario to use relative/neutral paths`);
    }
    copyFileSync(join(traceDir, golden), join(outDir, `${spec.sidecar.name}.jsonl`));
    writeFileSync(join(outDir, `${spec.sidecar.name}.expect.json`), `${JSON.stringify(spec.sidecar, null, 2)}\n`);
    console.log(`[bench:replay:record] wrote ${spec.sidecar.name}.jsonl (+ sidecar)`);
  } finally {
    if (prior === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
    else process.env.REACTIVE_AGENTS_TRACE_DIR = prior;
    if (process.env.RA_RECORD_KEEP === "1") console.log(`[bench:replay:record] kept trace dir ${traceDir}`);
    else rmSync(traceDir, { recursive: true, force: true });
  }
}

export async function recordGoldens(outDir: string = goldenDir()): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const only = process.env.RA_RECORD_ONLY;
  for (const spec of SCENARIOS) {
    if (only !== undefined && spec.sidecar.name !== only) continue;
    await recordOne(spec, outDir);
  }
}

if (import.meta.main) {
  recordGoldens().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
