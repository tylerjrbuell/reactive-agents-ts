/**
 * Multi-Model Harness Probe — runs `test.ts` serially across a curated model list
 * and emits a compact per-model summary. Designed to surface harness gaps that
 * only manifest on certain model classes (small vs medium, native FC vs not, etc.)
 * without overloading the local Ollama daemon.
 *
 * Usage:
 *   bun .agents/skills/harness-improvement-loop/scripts/multi-model-test.ts \
 *     [--models gemma4:e4b,cogito,qwen2.5-coder:14b] \
 *     [--category efficiency,tools] \
 *     [--max 6]
 *
 * Environment overrides flags. Output goes to stdout AND
 * harness-reports/multi-model-<datetime>/<model-slug>.log
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface RunSummary {
  readonly model: string;
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly durationMs: number;
  readonly logPath: string;
  readonly exitCode: number;
}

function parseFlag(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return process.env[name.toUpperCase()] ?? fallback;
}

function slugifyModel(model: string): string {
  return model.replace(/[:/]/g, "-").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function runOne(
  model: string,
  category: string | undefined,
  maxTests: string | undefined,
  outDir: string,
): Promise<RunSummary> {
  const slug = slugifyModel(model);
  const logPath = join(outDir, `${slug}.log`);
  const start = Date.now();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROVIDER: "ollama",
    MODEL: model,
  };
  if (category) env["CATEGORY"] = category;
  if (maxTests) env["MAX_TESTS"] = maxTests;

  const lines: string[] = [];
  let stdoutBuf = "";

  const child = spawn("bun", ["run", "test.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdoutBuf += text;
    lines.push(text);
    process.stdout.write(`  [${slug}] ${text.split("\n").slice(-2, -1)[0] ?? ""}\n`);
  });
  child.stderr.on("data", (chunk: Buffer) => lines.push(chunk.toString("utf8")));

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? -1));
  });

  writeFileSync(logPath, lines.join(""));

  // Strip ANSI escape codes from the buffer before matching summary lines.
  const clean = stdoutBuf.replace(/\u001b\[[0-9;]*m/g, "");
  const passMatch = clean.match(/Pass Rate\s*:\s*(\d+)\s*\/\s*(\d+)/);
  const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
  const total = passMatch ? parseInt(passMatch[2]!, 10) : 0;
  const failed = Math.max(0, total - passed);

  return {
    model,
    passed,
    failed,
    total,
    durationMs: Date.now() - start,
    logPath,
    exitCode,
  };
}

async function main(): Promise<void> {
  const modelsArg = parseFlag("models", "gemma4:e4b,cogito,qwen2.5-coder:14b,qwen3:4b");
  const category = parseFlag("category");
  const maxTests = parseFlag("max", "6");
  const models = modelsArg!
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "harness-reports", `multi-model-${ts}`);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`\n🧪 Multi-Model Harness Probe`);
  console.log(`   Models:     ${models.join(", ")}`);
  console.log(`   Category:   ${category ?? "(all)"}`);
  console.log(`   Per-model:  up to ${maxTests} tests`);
  console.log(`   Out dir:    ${outDir}\n`);

  const summaries: RunSummary[] = [];
  for (const model of models) {
    console.log(`▶ ${model} ...`);
    const summary = await runOne(model, category, maxTests, outDir);
    summaries.push(summary);
    const pct = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
    console.log(
      `  ✓ ${summary.passed}/${summary.total} (${pct}%) in ${(summary.durationMs / 1000).toFixed(1)}s — ${summary.logPath}\n`,
    );
  }

  const summaryPath = join(outDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summaries, null, 2));

  console.log(`═══ Multi-Model Summary ═══`);
  for (const s of summaries) {
    const pct = s.total > 0 ? `${Math.round((s.passed / s.total) * 100)}%` : "—";
    console.log(`  ${s.model.padEnd(28)} ${s.passed}/${s.total}  (${pct})  ${(s.durationMs / 1000).toFixed(1)}s  exit=${s.exitCode}`);
  }
  console.log(`\nSummary JSON: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
