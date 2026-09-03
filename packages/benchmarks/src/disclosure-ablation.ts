// disclosure-ablation — does lazy tool disclosure, and its `discover-tools`
// escape hatch, earn what they cost?
//
// F3 (catalogued 2026-07-28): "`discover-tools` burn is kernel-only — the kernel
// spends model calls discovering tools the inline path simply uses."
//
// WHY THIS COULD NOT BE MEASURED BEFORE. `RA_LAZY_TOOLS` gated THREE
// independent mechanisms at three sites, two of them in opposite directions:
// discovery registration, disclosure pruning, and the verbose RULES prompt
// block. Setting it to "0" moved all three, so the one arm F3 actually needs —
// pruning ON, discovery OFF — was inexpressible. `harness-flags.ts` split them;
// this measures the resulting cells.
//
//   bun run packages/benchmarks/src/disclosure-ablation.ts <provider> <model> [runs] [outPath]
//
// Arms:
//   inline          the default path — no pruning, no discovery, no kernel
//   prune+discover  kernel default: lazy disclosure + the escape hatch
//   prune-only      lazy disclosure with NO escape hatch (RA_TOOL_DISCOVERY=0)
//   no-prune        every permitted tool visible every iteration
//
// F10 (`stable-surface`, stable FC tool array): measured 2026-08-27, verdict
// REMOVE — +66.5% billed tokens vs prune+discover, 4.4x over the ceiling, and
// accuracy was saturated on every arm so no lift was even reachable. Deleted
// 2026-08-30; see wiki/Research/Harness-Reports/2026-08-27-stable-surface-promotion.md.
//
// `prune-only` is the load-bearing arm. If it matches `prune+discover` on the
// deliverable, discovery is buying nothing on this shape and its round trips are
// waste. If it DROPS the deliverable, discovery is the thing rescuing runs whose
// tool got pruned — and pruning is what created the need in the first place,
// which makes `no-prune` the arm to beat.
//
// READ THE DELIVERABLE COLUMN FIRST. Every cheap arm here is cheap because it
// did less; only the deliverable says whether that mattered.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";

/** Multi-step by construction: read a file, compute from it, write the answer.
 *  Needs three DIFFERENT tools, so a pruned surface has something to hide. */
const TASK =
  process.env.RA_DISC_TASK ??
  "Read the file ./data.json, compute the sum of the `values` array, " +
    "and write just that number to ./sum.txt. Then say you are done.";

const FIXTURE = JSON.stringify({ values: [12, 30, 45, 8, 5] }); // sum = 100
const EXPECTED = "100";

/** Ten builtins, so lazy disclosure has a real surface to prune. */
const BUILTINS = [
  "file-read", "file-write", "list-directory", "code-execute",
  "web-search", "http-get", "crypto-price", "git-cli", "gh-cli", "gws-cli",
];

interface Cell {
  readonly arm: string;
  readonly tokens: number;
  readonly calls: number;
  readonly iterations: number;
  readonly discoverCalls: number;
  readonly wroteFile: boolean;
  readonly correct: boolean;
  readonly tools: readonly string[];
  readonly status: string;
  readonly terminatedBy: string;
  readonly costUsd: number;
  readonly cacheRead: number;
  readonly freshIn: number;
  readonly durationMs: number;
}

interface ArmSpec {
  readonly name: string;
  readonly reasoning: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const ARMS: readonly ArmSpec[] = [
  { name: "inline", reasoning: false, env: {} },
  { name: "prune+discover", reasoning: true, env: {} },
  { name: "prune-only", reasoning: true, env: { RA_TOOL_DISCOVERY: "0" } },
  { name: "no-prune", reasoning: true, env: { RA_LAZY_TOOLS: "0", RA_VERBOSE_RULES: "0" } },
];

async function runArm(spec: ArmSpec, provider: string, model: string): Promise<Cell> {
  const root = mkdtempSync(join(tmpdir(), "ra-disc-root-"));
  const dir = mkdtempSync(join(tmpdir(), "ra-disc-trace-"));
  writeFileSync(join(root, "data.json"), FIXTURE, "utf8");

  // Flags are read per-call inside the kernel, so setting them around the run is
  // sufficient; restore afterwards so arms cannot leak into each other. (An
  // earlier shape of this file set them once at module load and every arm ran
  // with the last arm's flags — the classic ablation-that-measures-nothing.)
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(spec.env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const started = Date.now();
  let ok = false;
  let output = "";
  try {
    let b = ReactiveAgents.create()
      .withName(`disc-${spec.name}`)
      .withProvider(provider as never)
      .withModel(model)
      // IDENTICAL surface on every arm — the whole point. Varying `.withReasoning()`
      // without pinning tools also varies the surface (see the F9 retraction).
      // RA_DISC_SURFACE=floor  → `builtins: [array]`, which is a prune FLOOR:
      //   every named builtin is re-added AFTER filtering, so lazy disclosure
      //   has nothing left to prune and this ablation measures NOTHING. That is
      //   not hypothetical — the first run of this file used it and reported all
      //   three kernel arms identical (see the F6 header for the same trap).
      // RA_DISC_SURFACE=nofloor (default) → `builtins: true`, which opts in to
      //   every builtin and deliberately does NOT floor, so pruning bites and
      //   `discover-tools` has a reason to exist.
      .withTools({
        builtins: process.env.RA_DISC_SURFACE === "floor" ? BUILTINS : true,
        adaptive: false,
      } as never)
      .withMaxIterations(12)
      .withTracing({ dir });
    if (spec.reasoning) {
      b = (b as unknown as { withReasoning: (o: unknown) => typeof b }).withReasoning({
        defaultStrategy: "reactive",
      });
    }
    const agent = await b.build();
    const r = await withFileRoot(root, async () => agent.run(TASK));
    await agent.dispose();
    output = String(r.output ?? "");
    ok = true;
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 100)}`;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const durationMs = Date.now() - started;

  let tokens = 0;
  let calls = 0;
  let iterations = 0;
  let discoverCalls = 0;
  let status = "unknown";
  let terminatedBy = "unknown";
  // Once prompt caching works, TOKENS STOP BEING THE COST. Anthropic discounts a
  // cache hit ~90%, so an arm with more total tokens but a stable, cacheable
  // prefix can be materially cheaper than a leaner arm that re-sends a fresh
  // prefix every call. Measuring only tokens would pick the wrong winner.
  let costUsd = 0;
  let cacheRead = 0;
  let freshIn = 0;
  const tools = new Set<string>();
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string; status?: string; iter?: number; toolName?: string;
          terminationReason?: string; guard?: string;
          metadata?: { terminatedBy?: string };
          response?: {
            tokensIn?: number; tokensOut?: number; costUsd?: number;
            cacheReadTokensIn?: number; cacheCreationTokensIn?: number;
          };
        };
        if (typeof e.iter === "number" && e.iter > iterations) iterations = e.iter;
        if (e.kind === "run-completed") {
          status = e.status ?? "unknown";
          if (e.terminationReason) terminatedBy = e.terminationReason;
        }
        // WHY a run ended is not derivable from status alone, and this ablation
        // turned up kernel arms that wrote the CORRECT file and still reported
        // failure — a claim that needs the reason attached before it is believed.
        if (e.kind === "guard-fired" && e.metadata?.terminatedBy) {
          terminatedBy = e.metadata.terminatedBy;
        }
        if (e.kind === "tool-call-start" && e.toolName) {
          tools.add(e.toolName);
          if (e.toolName === "discover-tools") discoverCalls++;
        }
        if (e.kind !== "llm-exchange") continue;
        tokens += (e.response?.tokensIn ?? 0) + (e.response?.tokensOut ?? 0);
        costUsd += e.response?.costUsd ?? 0;
        cacheRead += e.response?.cacheReadTokensIn ?? 0;
        freshIn +=
          (e.response?.tokensIn ?? 0) -
          (e.response?.cacheReadTokensIn ?? 0) -
          (e.response?.cacheCreationTokensIn ?? 0);
        calls++;
      } catch {
        /* skip malformed line */
      }
    }
  }

  // Grade on DISK, not on the model's claim about the disk.
  let wroteFile = false;
  let correct = false;
  try {
    const body = readFileSync(join(root, "sum.txt"), "utf8").trim();
    wroteFile = true;
    correct = body.includes(EXPECTED);
  } catch {
    /* no deliverable */
  }
  void output;

  rmSync(dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return {
    arm: spec.name, tokens, calls, iterations, discoverCalls,
    wroteFile, correct, tools: [...tools], status, terminatedBy, durationMs,
    costUsd, cacheRead, freshIn,
  };
}

if (import.meta.main) {
  const provider = process.argv[2] ?? "anthropic";
  const model = process.argv[3] ?? "claude-haiku-4-5-20251001";
  const runs = Number(process.argv[4] ?? "1");
  const outPath = process.argv[5];

  const all: Cell[] = [];
  for (let i = 0; i < runs; i++) {
    for (const spec of ARMS) {
      const c = await runArm(spec, provider, model);
      all.push(c);
      console.log(
        `[${i + 1}] ${c.arm.padEnd(15)} ${String(c.tokens).padStart(6)}t ${String(c.calls).padStart(2)}call ` +
          `it=${String(c.iterations).padStart(2)} disc=${c.discoverCalls} ` +
          `${c.correct ? "CORRECT" : c.wroteFile ? "wrong  " : "NO-FILE"} ` +
          `$${c.costUsd.toFixed(5)} cache=${c.cacheRead} ${c.status.padEnd(7)} ${c.terminatedBy.padEnd(16)} ${(c.durationMs / 1000).toFixed(1)}s [${c.tools.join(",") || "-"}]`,
      );
    }
  }

  console.log(`\n── ${provider}/${model} · n=${runs} ──`);
  console.log("arm             mean tokens   mean $USD  vs inline$  cacheRead  correct");
  const base = all.filter((c) => c.arm === "inline");
  const baseT = base.reduce((s, c) => s + c.tokens, 0) / Math.max(base.length, 1);
  const baseCost = base.reduce((s, c) => s + c.costUsd, 0) / Math.max(base.length, 1);
  void baseT;
  for (const spec of ARMS) {
    const cs = all.filter((c) => c.arm === spec.name);
    if (!cs.length) continue;
    const t = cs.reduce((s, c) => s + c.tokens, 0) / cs.length;
    const cost = cs.reduce((s, c) => s + c.costUsd, 0) / cs.length;
    const cr = cs.reduce((s, c) => s + c.cacheRead, 0) / cs.length;
    const over = baseCost > 0 ? `${(((cost - baseCost) / baseCost) * 100).toFixed(0)}%` : "—";
    console.log(
      `${spec.name.padEnd(15)} ${Math.round(t).toString().padStart(11)} ${cost.toFixed(5).padStart(11)} ` +
        `${over.padStart(10)} ${Math.round(cr).toString().padStart(10)}  ` +
        `${cs.filter((c) => c.correct).length}/${cs.length}`,
    );
  }
  console.log(
    "\nprune-only vs prune+discover is the F3 question: same deliverable ⇒ the escape\n" +
      "hatch bought nothing on this shape. Compare BOTH against no-prune before blaming\n" +
      "discovery — pruning is what creates the need for it.",
  );

  // A bench run that persists nothing cannot be re-read, re-checked, or cited.
  // Writing the CELLS (not just the summary) is deliberate: the summary averages
  // away the per-run variance that decides whether a gap is signal or noise.
  if (outPath) {
    await Bun.write(
      outPath,
      JSON.stringify(
        { provider, model, runs, generatedAt: new Date().toISOString(), cells: all },
        null,
        2,
      ),
    );
    console.log(`\nwrote ${all.length} cells to ${outPath}`);
  } else {
    console.warn("\nWARNING: no output path given — this run persists nothing.");
  }
}
