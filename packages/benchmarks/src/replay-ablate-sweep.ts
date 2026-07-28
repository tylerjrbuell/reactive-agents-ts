// replay-ablate-sweep — run every behavioural flag through the golden corpus
// and print the three-bucket triage. Zero tokens, no provider, no keys.
//
//   bun run packages/benchmarks/src/replay-ablate-sweep.ts
//
// Spawns `replay-ablate.ts` once per flag, because several flags are read at
// MODULE LOAD and toggling them in-process would silently do nothing — a
// vacuous "INERT" for every one of them. One process per flag is the cost of
// not lying.
//
// The sweep is only as good as the corpus. INERT means "no divergence on the
// recorded shapes", NOT "does nothing". Grow `golden/` before treating an INERT
// verdict as a delete authorisation, and never delete on this signal alone for
// a mechanism whose effect is on the PROMPT (see replay-ablate.ts scope limit).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { AblationResult } from "./replay-ablate.js";

/**
 * Behavioural flags only. Infrastructure (hosts, tokens, URLs, trace dirs,
 * provider/model selection, record-mode switches) is excluded: those steer the
 * harness's environment, not its reasoning.
 *
 * THE VALUE MATTERS AS MUCH AS THE FLAG. A first pass of this sweep set every
 * flag to `"1"` and reported 18 of 19 INERT — nearly all of it artifact. The
 * tell was `REACTIVE_AGENTS_MAX_ITERATIONS=1` coming back inert, which a hard
 * iteration cap cannot be. Three distinct faults were behind it:
 *
 *   1. WRONG POLARITY. `RA_LAZY_TOOLS` is read as `!== "0"`, i.e. ON by
 *      default — setting it to `"1"` is a no-op. It must be set to `"0"`.
 *   2. WRONG LITERAL. `DISABLE_STATUS_MODE` compares against `"true"`, not
 *      `"1"`; `RA_SANDBOX` against `"docker"`.
 *   3. SHADOWED / UNEXERCISED. Some flags cannot move on this path at all —
 *      see UNTESTABLE below.
 *
 * So: read the actual comparison in the source before adding a row here. A
 * wrong toggle produces a confident, silent false INERT, which is exactly the
 * evidence someone would later use to delete a working mechanism.
 *
 * Budget flags get a deliberately TIGHT value — a budget only bites under
 * pressure, and a generous one reports INERT for a mechanism merely unexercised.
 */
const BEHAVIOURAL: readonly (readonly [string, string])[] = [
  ["REACTIVE_AGENTS_EVIDENCE_DELTA_RESET", "1"], // === "1"
  ["REACTIVE_AGENTS_NOOP_VERIFIER", "1"], // === "1"
  ["REACTIVE_AGENTS_LAZY_VALIDATION", "1"], // === '1'
  ["RA_LAZY_TOOLS", "0"], // !== "0"  — default ON, so "0" is the ablation
  ["RA_THOUGHT_CONTINUITY", "1"], // === "1"
  ["RA_TOOL_OBSERVE_SYMMETRY", "1"], // === "1"
  ["RA_RATIONALE_AUDIT", "1"], // === "1"
  ["RA_OVERHAUL", "1"], // === "1"
  ["RA_AGENT_STRICT_EGRESS", "1"], // !== "1"
  ["REACTIVE_AGENTS_DISABLE_STATUS_MODE", "true"], // === "true"
  ["RA_RECENCY_BUDGET_CHARS", "200"], // Number(...)
  ["RA_TOOL_RESULT_BUDGET_CHARS", "100"], // Number(...)
  ["RA_ASSEMBLY_DEBUG", "1"], // debug printer — inert is the CORRECT answer
  ["RA_PROMPT_DUMP", "1"], // debug printer — inert is the CORRECT answer
];

/**
 * Flags this corpus CANNOT test, with the reason. Reported separately so they
 * are never miscounted as evidence of inertness — "the code never ran" and
 * "the code ran and did nothing" are different findings, and only the second
 * is grounds for deletion.
 */
const UNTESTABLE: readonly (readonly [string, string])[] = [
  ["REACTIVE_AGENTS_MAX_ITERATIONS", "shadowed — every sidecar sets maxIterations, and builder.ts:263 reads the env var only as a DEFAULT"],
  ["REACTIVE_AGENTS_MAX_RECURSION_DEPTH", "unexercised — read in agent-tool-adapter; no golden delegates. Needs a sub-agent golden"],
  ["RA_TOT_EXPLORE_BUDGET_MS", "unexercised — tree-of-thought only; every golden runs `reactive`"],
  ["RA_HTTP_ALLOW_PRIVATE", "unexercised — network egress; no golden makes an HTTP call"],
  ["RA_SANDBOX", "unexercised — compares against \"docker\" and needs a live daemon"],
];

const WORKER = join(import.meta.dir, "replay-ablate.ts");

function runOne(flag: string, value?: string): AblationResult | undefined {
  const args = value === undefined ? [WORKER, "--baseline"] : [WORKER, flag, value];
  const p = spawnSync("bun", ["run", ...args], { encoding: "utf8", timeout: 120_000 });
  const line = (p.stdout ?? "").split("\n").find((l) => l.startsWith("__ABLATE__"));
  if (line === undefined) return undefined;
  return JSON.parse(line.slice("__ABLATE__".length)) as AblationResult;
}

const baseline = runOne("(baseline)");
if (baseline === undefined) {
  console.error("sweep: baseline produced no result — the worker is broken, not the flags");
  process.exit(1);
}
// A baseline that does not fully match its own recordings makes every
// downstream verdict meaningless: divergence could not be attributed to a flag.
const baselineClean = baseline.cells.every((c) => c.ok);
console.log(
  `baseline: ${baseline.cells.filter((c) => c.ok).length}/${baseline.cells.length} goldens match` +
    (baselineClean ? "" : "  ← NOT CLEAN, verdicts below are unattributable"),
);
if (!baselineClean) process.exit(1);

const live: string[] = [];
const inert: string[] = [];

for (const [flag, value] of BEHAVIOURAL) {
  const r = runOne(flag, value);
  if (r === undefined) {
    console.log(`  ?? ${flag} — worker produced no result (skipped, NOT counted inert)`);
    continue;
  }
  const diverged = r.cells.filter((c) => !c.ok);
  if (diverged.length === 0) {
    inert.push(flag);
    console.log(`  ·  ${flag}=${value} — no divergence on ${r.cells.length} goldens`);
  } else {
    live.push(flag);
    console.log(`  ✦  ${flag}=${value} — LIVE on ${diverged.length}/${r.cells.length}`);
    for (const c of diverged) {
      console.log(`       ${c.golden}: ${c.dispensed}/${c.tableSize} ${c.failure ?? ""}`);
    }
  }
}

console.log(`\nUNTESTABLE on this corpus (${UNTESTABLE.length}) — NOT evidence of inertness:`);
for (const [flag, why] of UNTESTABLE) console.log(`  ⊘  ${flag} — ${why}`);

console.log(`\nLIVE       (${live.length}): ${live.join(", ") || "—"}`);
console.log(`INERT      (${inert.length}): ${inert.join(", ") || "—"}`);
console.log(`UNTESTABLE (${UNTESTABLE.length}): ${UNTESTABLE.map(([f]) => f).join(", ")}`);
console.log(
  `\nINERT = the flag was toggled, the code ran, and nothing diverged across ` +
    `${baseline.cells.length} goldens. It is a deletion CANDIDATE, not a deletion order: ` +
    `grow the corpus first, and never delete a prompt-altering mechanism on this ` +
    `signal alone (replay fixes the model's trajectory — see replay-ablate.ts).`,
);
