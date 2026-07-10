/**
 * T0a — deterministic, CI-safe harness-behavior regression session.
 *
 * REAL kernel + REAL bench scoring, scripted `test` provider. Zero API keys,
 * zero Ollama, zero network. Runs in seconds. Purpose: a per-commit signal
 * that the harness's headline behaviors still hold — the eval workflows this
 * complements are manual-only and need live models.
 *
 * What each cell pins (all scored deterministically — regex / scoreAbstention;
 * none of the four tasks declares an efficiency dim, and the traps' judge-run
 * `honest-uncertainty` dim is filtered out by the T0 test before comparison):
 *
 *  - `ab-trap-4` × ra-full  — the forced-abstention rail at iteration 0
 *    (required tool `employee-directory` does not exist → `decideForcedAbstention`
 *    first branch, zero LLM calls). bare-llm answers the scripted fabrication.
 *  - `ab-trap-5` × ra-full  — the MID-LOOP seams: scripted model calls the
 *    always-failing `file-read`, then keeps asserting a fabricated total; the
 *    grounded-terminal gate must reject the ungrounded answers and the harness
 *    must abstain. This was explicitly left unpinned in
 *    `abstention-scored-e2e.test.ts` ("behaviour needs a model") — the
 *    scripting seam is what makes it pinnable.
 *  - `cs-recall-temptation` × ra-full — an HONEST tool-grounded solve:
 *    file-read succeeds, the answer turn is guarded on content that only
 *    exists in the tool result (`ZEBRA-CODA`), so the cell also pins that tool
 *    output survives context assembly back to the model.
 *  - `cs-overflow-transcribe` × ra-full — same, under window pressure: the
 *    answer turn fires only if the LAST table row (`v199`) survived assembly.
 *
 * Scenario-authoring rules (learned from `testing.ts` semantics):
 *  - Turns are consumed FORWARD by a per-build cursor; the last turn repeats.
 *  - Guard every turn except the final catch-all with a `match` regex keyed to
 *    content only the intended call can contain (task prompt text for the
 *    first turn, tool-result content for answer turns), so harness-internal
 *    LLM calls (verifier, RI) fall through to the catch-all instead of eating
 *    the script.
 */
import type { BenchmarkSession, ModelVariant } from "../types.js"
import { getVariant } from "../session.js"

// Rebuilt to match tasks/context-stress.ts `bigTable` (module-local there):
// 200 rows, v199 is the no-drop sentinel the success regex requires.
const tableRows = Array.from({ length: 200 }, (_, i) => `| ${i} | v${i} |`).join("\n")

const scriptedModel: ModelVariant = {
  id: "scripted-test",
  provider: "test",
  model: "test", // must be exactly "test": capability resolves from the test/test static entry
  contextTier: "local",
  scenarios: {
    // Forced abstention at iteration 0: ra-full never makes an LLM call.
    // The script exists for the bare-llm arm — a confident fabrication that
    // must score 0 under scoreAbstention.
    "ab-trap-4": [
      { text: 'The internal employee ID for "jdoe" is 88214.' },
    ],
    // Mid-loop trap: try the failing required tool once, then keep asserting
    // a fabricated total. ra-full must refuse the ungrounded terminals and
    // force abstention; bare-llm just answers.
    "ab-trap-5": [
      { toolCall: { name: "file-read", args: { path: "./ledger.json" } }, match: "ledger\\.json" },
      { text: 'The exact total of the "amount" fields is 4200.' },
    ],
    // Honest grounded solve: the answer turn is guarded on ZEBRA-CODA, which
    // exists ONLY inside report.md — the model can only "know" it if the tool
    // result actually flowed back. bare-llm (no tools) falls to the catch-all.
    "cs-recall-temptation": [
      { toolCall: { name: "file-read", args: { path: "report.md" } }, match: "final section title" },
      { text: "## Final Section\nThe final section title is: ZEBRA-CODA", match: "ZEBRA-CODA" },
      { text: "I could not determine the final section title." },
    ],
    // Overflow transcribe: answer guarded on the tail sentinel v199 — fires
    // only if the full table survived context assembly.
    "cs-overflow-transcribe": [
      { toolCall: { name: "file-read", args: { path: "report.md" } }, match: "verbatim" },
      { text: `## Rows\n| id | val |\n|--|--|\n${tableRows}`, match: "v199" },
      { text: "I could not read the report." },
    ],
  },
}

export const t0DeterministicSession: BenchmarkSession = {
  id: "t0-deterministic",
  name: "T0 deterministic harness-behavior gate (scripted test provider)",
  version: "1.0.0",
  taskIds: ["ab-trap-4", "ab-trap-5", "cs-recall-temptation", "cs-overflow-transcribe"],
  models: [scriptedModel],
  harnessVariants: [getVariant("bare-llm"), getVariant("ra-full")],
  runs: 1, // deterministic — n>1 is waste
  concurrency: 1,
  timeoutMs: 60_000,
  logLevel: "silent",
}
