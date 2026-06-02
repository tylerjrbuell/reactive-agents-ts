/**
 * Phase-A root-cause diagnostic: capture full conversation thread + final
 * output for cs-overflow-summarize under both arms. The post-fix bench
 * showed project arm 0% / 14471 tokens vs legacy 100% / 4854 tokens — 3x
 * token bloat AND zero success. This script reproduces ONE cell per arm
 * with full event-capture so we can read what each arm actually sent to
 * the model + what the model produced.
 *
 * Outputs:
 *   /tmp/raphase-a/diag-summarize-project.json   # events + output
 *   /tmp/raphase-a/diag-summarize-legacy.json
 *
 * Run from repo root:
 *   bun run apps/examples/diag-summarize-arms.ts
 */
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "reactive-agents";

const OUT_DIR = "/tmp/raphase-a";
mkdirSync(OUT_DIR, { recursive: true });

// Same fixture as `cs-overflow-summarize`.
const bigReport =
  Array.from(
    { length: 40 },
    (_, i) => `## Section ${i + 1}\n` + "lorem ipsum ".repeat(60),
  ).join("\n\n") +
  "\n\n## Final Section\nThe final section title is: ZEBRA-CODA\n";

async function runOnce(arm: "project" | "legacy"): Promise<{
  output: string;
  tokens: number;
  durationMs: number;
}> {
  const tmpDir = mkdtempSync(join(tmpdir(), `diag-sum-${arm}-`));
  writeFileSync(join(tmpDir, "report.md"), bigReport);

  const prev = process.env.RA_ASSEMBLY;
  if (arm === "legacy") process.env.RA_ASSEMBLY = "0";
  else delete process.env.RA_ASSEMBLY;

  // Provider/model selected via DIAG_PROVIDER / DIAG_MODEL env (default qwen3.5).
  const provider = (process.env.DIAG_PROVIDER ?? "ollama") as "ollama" | "anthropic" | "openai" | "gemini" | "litellm";
  const model = process.env.DIAG_MODEL ?? "qwen3.5:latest";

  const agent = await ReactiveAgents.create()
    .withName(`diag-sum-${arm}`)
    .withProvider(provider)
    .withModel(model)
    .withMaxIterations(15)
    .withTools({ builtins: ["file-read", "file-write"] })
    .withReasoning({ defaultStrategy: "reactive" })
    .withReactiveIntelligence()
    .build();

  const t0 = performance.now();
  try {
    const prompt =
      `Working directory for this task: ${tmpDir}\n\n` +
      `All task files (e.g. report.md) are located in that directory. Use the full path when reading files.\n\n` +
      `Read report.md and write a one-line summary of EACH section under '## Summary'.`;
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
  const provider = process.env.DIAG_PROVIDER ?? "ollama";
  const model = process.env.DIAG_MODEL ?? "qwen3.5:latest";
  console.log(`Phase-A summarize-arms diagnostic (${provider}/${model})\n`);

  for (const arm of ["project", "legacy"] as const) {
    process.stdout.write(`  ${arm}... `);
    const { output, tokens, durationMs } = await runOnce(arm);
    const hit = /## Summary/i.test(output);
    const file = join(OUT_DIR, `diag-summarize-${arm}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          arm,
          tokens,
          durationMs: Math.round(durationMs),
          sentinel_hit: hit,
          output_length: output.length,
          output,
        },
        null,
        2,
      ),
    );
    console.log(
      `tokens=${tokens} dur=${Math.round(durationMs)}ms hit=${hit ? "YES" : "NO"} outlen=${output.length} → ${file}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
