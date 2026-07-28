// harness-cost-attribution — what does the harness SPEND, and on what?
//
// The lift ledger says the full harness costs 555-640% more tokens than a bare
// LLM, against 09 §6's own 15% ceiling. That number is a TOTAL. Until
// 2026-07-28 it could not be decomposed, because `purpose` was stamped on the
// wire request and dropped at the trace (fixed in 16b93dac).
//
// This runs the SAME task across harness configurations against a REAL model
// and reads the resulting traces per `purpose`, so overhead is attributable to
// a subsystem — "synthesize is 40% of spend" rather than "the harness is
// expensive".
//
//   bun run packages/benchmarks/src/harness-cost-attribution.ts <provider> <model> [runs]
//
// Arms, chosen to isolate one variable at a time:
//   inline   the DEFAULT path (`_enableReasoning` false) — the baseline users get
//   kernel   + `.withReasoning()` — contract, assessment, projection, guards
//   kernel+RI + `.withReactiveIntelligence()` — entropy sensing + controller
//
// READ THE PER-PURPOSE TABLE, NOT THE TOTAL. A total tells you the harness is
// expensive; the composition tells you which mechanism to look at. And read the
// OUTCOME column beside it — overhead that buys a correct answer is lift, not
// waste, and this session's own history (the low_delta guard-fire rate) is a
// standing reminder that the cheapest-looking arm can be the one that fails.
//
// Caveat, deliberate: n is small by default. This resolves LARGE differences in
// spend composition. It does NOT resolve a 3pp accuracy lift — that is the live
// arm campaign's job, and bench cells are Bernoulli (see the bench uncertainty
// note in report-format.ts). Do not read an accuracy verdict off this.
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";

interface PurposeCell {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ArmResult {
  readonly arm: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly wroteFile: boolean;
  readonly byPurpose: Record<string, PurposeCell>;
  readonly totalIn: number;
  readonly totalOut: number;
  readonly output: string;
  // ─── Failure-mode fields. Tokens say a run was expensive; these say WHY it
  // ended. Without them a 0/2 deliverable is a mystery rather than a diagnosis.
  /** Terminal status from `run-completed`. */
  readonly status: string;
  /** Guards that fired, in order — `low_delta_guard` etc. */
  readonly guards: readonly string[];
  /** Distinct tools actually dispatched. */
  readonly tools: readonly string[];
  /** Highest iteration index observed on any event. */
  readonly iterations: number;
}

/**
 * Override with `RA_COST_TASK`. The default is deliberately EASY, and that is a
 * limitation to respect rather than a convenience: when every arm succeeds, the
 * harness cannot demonstrate lift, so the run measures overhead ONLY. Measured
 * 2026-07-28 — haiku inline/kernel/kernel+RI all produced the deliverable 2/2,
 * and qwen3.5 1/1, so the +81%..+141% those runs reported is unpurchased
 * overhead ON THIS TASK and says nothing about a task where inline fails.
 *
 * To measure lift, point this at a task the bare path gets WRONG — multi-file,
 * long-horizon, or one with a declared deliverable the model tends to skip.
 * `rw-4`/`rw-7` in the real-world suite are the known-hard shapes.
 */
const TASK =
  process.env.RA_COST_TASK ??
  "Create a file ./report.md containing exactly three markdown bullet points " +
    "summarising what a unit test is. Then state that you are done.";

async function runArm(
  arm: string,
  provider: string,
  model: string,
  configure: (b: never) => unknown,
): Promise<ArmResult> {
  const root = mkdtempSync(join(tmpdir(), "ra-cost-root-"));
  const dir = mkdtempSync(join(tmpdir(), "ra-cost-trace-"));
  mkdirSync(root, { recursive: true });
  // Seed input fixtures INTO the sandbox root. Each arm gets a fresh tmpdir as
  // its file root, so a task referring to `./data.json` finds nothing unless the
  // file is written here. Cost one void arm-set on 2026-07-28: a multi-step task
  // reported deliverable 0/1 on every arm, which reads as "the harness failed"
  // and was actually "the input never existed". Seed, or the run is void.
  // Format: RA_COST_FIXTURES='{"data.json":"{\"records\":[...]}"}'
  const fixtures = process.env.RA_COST_FIXTURES;
  if (fixtures !== undefined) {
    for (const [name, content] of Object.entries(JSON.parse(fixtures) as Record<string, string>)) {
      writeFileSync(join(root, name), content, "utf8");
    }
  }
  const started = Date.now();
  let output = "";
  let ok = false;
  try {
    let b = ReactiveAgents.create()
      .withName(`cost-${arm}`)
      .withProvider(provider as never)
      .withModel(model)
      .withTools({ builtins: ["file-write"], adaptive: false })
      .withRequiredTools({ tools: ["file-write"] })
      .withMaxIterations(8)
      .withTracing({ dir });
    b = configure(b as never) as typeof b;
    const agent = await b.build();
    const r = await withFileRoot(root, async () => agent.run(TASK));
    await agent.dispose();
    output = String(r.output ?? "").slice(0, 80).replace(/\s+/g, " ");
    ok = true;
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 80)}`;
  }
  const durationMs = Date.now() - started;

  const byPurpose: Record<string, PurposeCell> = {};
  let totalIn = 0;
  let totalOut = 0;
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string;
          purpose?: string;
          response?: { tokensIn?: number; tokensOut?: number };
        };
        if (e.kind !== "llm-exchange") continue;
        // Absence is "unmediated", NOT a measured tier — the inline loop calls
        // the provider directly rather than through the stamping gateway.
        const p = e.purpose ?? "(unmediated)";
        const cell = (byPurpose[p] ??= { calls: 0, tokensIn: 0, tokensOut: 0 });
        cell.calls++;
        cell.tokensIn += e.response?.tokensIn ?? 0;
        cell.tokensOut += e.response?.tokensOut ?? 0;
        totalIn += e.response?.tokensIn ?? 0;
        totalOut += e.response?.tokensOut ?? 0;
      } catch {
        /* skip malformed line */
      }
    }
  }
  // The deliverable filename must track RA_COST_TASK. It was hardcoded to
  // "report.md" and a custom task writing ./avg.txt therefore reported
  // deliverable 0/1 on EVERY arm — reading as "the harness failed" when the
  // check was simply looking for the wrong file. Second void arm-set of the
  // day from the same root cause: the probe, not the system.
  const deliverable = process.env.RA_COST_DELIVERABLE ?? "report.md";
  const wroteFile = readdirSync(root).includes(deliverable);
  const guards: string[] = [];
  const tools = new Set<string>();
  let status = "unknown";
  let iterations = 0;
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string; guard?: string; toolName?: string;
          status?: string; error?: string; iter?: number;
        };
        if (typeof e.iter === "number" && e.iter > iterations) iterations = e.iter;
        if (e.kind === "guard-fired" && e.guard) guards.push(e.guard);
        if (e.kind === "tool-call-start" && e.toolName) tools.add(e.toolName);
        if (e.kind === "run-completed") status = e.status ?? "unknown";
      } catch { /* skip */ }
    }
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return {
    arm, ok, durationMs, wroteFile, byPurpose, totalIn, totalOut, output,
    status, guards, tools: [...tools], iterations,
  };
}

if (import.meta.main) {
  const provider = process.argv[2] ?? "anthropic";
  const model = process.argv[3] ?? "claude-haiku-4-5-20251001";
  const runs = Number(process.argv[4] ?? "1");

  const ARMS: readonly (readonly [string, (b: never) => unknown])[] = [
    ["inline", (b) => b],
    ["kernel", (b) => (b as { withReasoning: (o: unknown) => unknown }).withReasoning({ defaultStrategy: "reactive" })],
    ["kernel+RI", (b) => {
      const wb = b as { withReasoning: (o: unknown) => { withReactiveIntelligence: (o: unknown) => unknown } };
      return wb.withReasoning({ defaultStrategy: "reactive" }).withReactiveIntelligence({});
    }],
  ];

  const all: ArmResult[] = [];
  for (let i = 0; i < runs; i++) {
    for (const [arm, cfg] of ARMS) {
      const r = await runArm(arm, provider, model, cfg);
      all.push(r);
      const purposes = Object.entries(r.byPurpose)
        .sort((a, b) => b[1].tokensIn + b[1].tokensOut - (a[1].tokensIn + a[1].tokensOut))
        .map(([p, c]) => `${p}:${c.calls}c/${c.tokensIn + c.tokensOut}t`)
        .join(" ");
      console.log(
        `[${i + 1}] ${arm.padEnd(10)} ${String(r.totalIn + r.totalOut).padStart(7)}t ` +
          `${String(Math.round(r.durationMs / 100) / 10).padStart(6)}s file=${r.wroteFile ? "Y" : "n"} ` +
          `it=${r.iterations} ${r.status.padEnd(9)} ` +
          `tools=[${r.tools.join(",") || "-"}] ` +
          `${r.guards.length ? `GUARDS=[${r.guards.join(",")}] ` : ""}| ${purposes}` +
          (process.env.RA_COST_SHOW_OUTPUT ? `\n     OUT: ${r.output}` : ""),
      );
    }
  }

  // Aggregate: total tokens per arm, and the inline arm as the overhead baseline.
  console.log("\n── per-arm totals ──");
  const base = all.filter((r) => r.arm === "inline");
  const baseTok = base.reduce((s, r) => s + r.totalIn + r.totalOut, 0) / Math.max(base.length, 1);
  for (const arm of ["inline", "kernel", "kernel+RI"]) {
    const rs = all.filter((r) => r.arm === arm);
    if (rs.length === 0) continue;
    const tok = rs.reduce((s, r) => s + r.totalIn + r.totalOut, 0) / rs.length;
    const files = rs.filter((r) => r.wroteFile).length;
    const over = baseTok > 0 ? `${(((tok - baseTok) / baseTok) * 100).toFixed(0)}%` : "—";
    console.log(
      `${arm.padEnd(10)} mean ${Math.round(tok).toString().padStart(7)}t  vs inline ${over.padStart(6)}  deliverable ${files}/${rs.length}`,
    );
  }
  console.log(
    "\nRead composition + deliverable together. Overhead that buys a correct answer is lift;\n" +
      `overhead on a run that fails is waste. n=${runs} per arm — large differences only.`,
  );
}
