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
