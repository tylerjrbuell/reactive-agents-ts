/**
 * Phase-A diagnostic: capture project() vs legacy curate() outputs for the
 * same context-stress task. Phase-A exit-gate fired in the WRONG direction —
 * canonical arm scored worse than legacy. This script reproduces one cell per
 * arm and dumps the raw output text so we can read what the model produced.
 *
 * Run from repo root:
 *   bun run scripts/probes/diag-context-stress.ts
 *
 * Outputs:
 *   /tmp/raphase-a/diag-project-recall.txt
 *   /tmp/raphase-a/diag-legacy-recall.txt
 */
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "reactive-agents";

const OUT_DIR = "/tmp/raphase-a";
mkdirSync(OUT_DIR, { recursive: true });

// Same fixture as cs-recall-temptation in `packages/benchmarks/src/tasks/context-stress.ts`
const bigReport =
  Array.from(
    { length: 40 },
    (_, i) => `## Section ${i + 1}\n` + "lorem ipsum ".repeat(60),
  ).join("\n\n") +
  "\n\n## Final Section\nThe final section title is: ZEBRA-CODA\n";

async function runOnce(arm: "project" | "legacy"): Promise<{ output: string; tokens: number; durationMs: number }> {
  // Inline-fixture diagnostic: skip file-read entirely. The bench result
  // we're triaging confounded file-read failures with assembly-arm behavior.
  // Embedding the fixture directly in the prompt forces the difference to be
  // assembly-side only.

  const prev = process.env.RA_ASSEMBLY;
  if (arm === "legacy") process.env.RA_ASSEMBLY = "0";
  else delete process.env.RA_ASSEMBLY;

  const agent = await ReactiveAgents.create()
    .withName(`diag-${arm}`)
    .withProvider("ollama")
    .withModel("qwen3.5:latest")
    .withMaxIterations(15)
    .withTools()
    .withReasoning({ defaultStrategy: "reactive" })
    .withReactiveIntelligence()
    .build();

  const t0 = performance.now();
  try {
    const prompt =
      `Below is the FULL CONTENT of report.md, inlined for you. You do NOT need to read any file.\n\n` +
      `<report.md>\n${bigReport}\n</report.md>\n\n` +
      `Task: state the report's final section title under '## Final Section'. Answer briefly. ` +
      `Do not call any tools — answer directly from the content above.`;
    const result = await agent.run(prompt);
    return {
      output: result.output ?? "",
      tokens: result.metadata?.tokensUsed ?? 0,
      durationMs: performance.now() - t0,
    };
  } finally {
    await agent.dispose();
    if (prev === undefined) delete process.env.RA_ASSEMBLY;
    else process.env.RA_ASSEMBLY = prev;
  }
}

async function main(): Promise<void> {
  console.log("Phase-A diagnostic: cs-recall-temptation, qwen3.5:latest");
  console.log("Looking for sentinel 'ZEBRA-CODA' in final output.\n");

  for (const arm of ["project", "legacy"] as const) {
    process.stdout.write(`  ${arm}... `);
    const { output, tokens, durationMs } = await runOnce(arm);
    const hit = /ZEBRA-CODA/i.test(output);
    const file = join(OUT_DIR, `diag-${arm}-recall.txt`);
    writeFileSync(
      file,
      `# arm: ${arm}\n# tokens: ${tokens}\n# duration_ms: ${Math.round(durationMs)}\n# sentinel_hit: ${hit}\n# output_length: ${output.length}\n\n--- OUTPUT ---\n${output}\n`,
    );
    console.log(`tokens=${tokens} dur=${Math.round(durationMs)}ms sentinel=${hit ? "HIT" : "MISS"} → ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
