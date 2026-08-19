/**
 * Probe for 09-UNIFIED-PROGRAM §6.6 / F9 (Step 3a).
 *
 * Claim under test: the healing pipeline (path-resolver.ts) silently remaps
 * an out-of-root absolute path to `<root>/<basename>` BEFORE file-write ever
 * runs, so file-operations.ts's own traversal throw never fires on this path
 * — and the model's stated/requested path and the actually-written path
 * diverge, which is what produces F9 (agent succeeds, run reports failure).
 *
 * Method: withFileRoot(ROOT). Ask the model to write a marker string to an
 * absolute path OUTSIDE ROOT (a sibling tmp dir, also under the OS tmp dir —
 * never a real system path, so this is safe to run unattended). After the
 * run, inspect the filesystem directly (no LLM judgment involved) for three
 * possible outcomes:
 *
 *   REMAPPED  — file landed at ROOT/<basename> — confirms the silent remap.
 *   REJECTED  — no file anywhere, tool observation shows the traversal
 *               error — confirms healing did NOT fire (was bypassed) and
 *               the tool's own guard is what's live.
 *   ESCAPED   — file landed at the literal outside path — confinement did
 *               not apply at all. Worse than the documented bug; flag hard.
 *   NONE      — model never called file-write, or run errored.
 *
 * Cross-model: the outcome is a harness code-path property, not a model
 * capability, so a REMAPPED result should replicate across every tier that
 * reliably invokes the tool at all.
 *
 * Run: bun scripts/probes/step3-path-authority-probe.ts
 * Env: MODELS="claude-haiku-4-5-20251001:anthropic,qwen3:14b:ollama" (name:provider pairs)
 */
import { ReactiveAgents } from "reactive-agents";
import { withFileRoot } from "@reactive-agents/tools";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CELLS = (process.env.MODELS ?? "claude-haiku-4-5-20251001:anthropic,qwen3:14b:ollama")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [model, provider] = s.split(":");
    return { model, provider: (provider ?? "anthropic") as "anthropic" | "ollama" | "openai" | "gemini" };
  });

const MARKER = "STEP3_PATH_AUTHORITY_PROBE_MARKER";

type Outcome = "REMAPPED" | "REJECTED" | "ESCAPED" | "NONE" | "ERROR";

async function runCell(model: string, provider: string): Promise<{ outcome: Outcome; detail: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "ra-probe-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ra-probe-outside-"));
  const outsideTarget = path.join(outside, "report.md");
  const remapTarget = path.join(root, "report.md");

  const modelCfg = provider === "ollama" ? { model, numCtx: 12000 } : { model };
  const b = ReactiveAgents.create()
    .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task exactly as instructed.", tone: "concise" })
    .withProvider(provider as "anthropic" | "ollama")
    .withModel(modelCfg)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withTools({ allowedTools: ["file-write", "file-read"], metaTools: false });

  const task = `Use the file-write tool to write exactly this text: "${MARKER}" to this EXACT absolute path: ${outsideTarget}\nThen finish.`;

  let toolCalls: { name: string; arguments?: unknown }[] = [];
  let runSuccess = false;
  try {
    const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
    try {
      const r = await withFileRoot(root, () => agent.run(task));
      runSuccess = r.success;
      toolCalls = (r.metadata.toolCalls ?? []) as { name: string; arguments?: unknown }[];
    } finally {
      await agent.dispose();
    }
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    return { outcome: "ERROR", detail: String(e) };
  }

  const wroteCall = toolCalls.find((t) => t.name === "file-write");
  let outcome: Outcome;
  let detail: string;
  const remapped = await readFile(remapTarget, "utf8").catch(() => null);
  const escaped = await readFile(outsideTarget, "utf8").catch(() => null);
  if (remapped?.includes(MARKER)) {
    outcome = "REMAPPED";
    detail = `file landed at ROOT/report.md (${remapTarget}) instead of the requested ${outsideTarget}; requested path in tool call: ${JSON.stringify(wroteCall?.arguments)}; run.success=${runSuccess}`;
  } else if (escaped?.includes(MARKER)) {
    outcome = "ESCAPED";
    detail = `file landed at the literal outside path — confinement did not apply. run.success=${runSuccess}`;
  } else if (wroteCall) {
    outcome = "REJECTED";
    detail = `file-write was called (args=${JSON.stringify(wroteCall.arguments)}) but no marker found at either candidate path — likely a thrown traversal error observed by the model. run.success=${runSuccess}`;
  } else {
    outcome = "NONE";
    detail = `model never called file-write. run.success=${runSuccess}, toolCalls=${JSON.stringify(toolCalls.map((t) => t.name))}`;
  }

  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  return { outcome, detail };
}

const results: Record<string, { outcome: Outcome; detail: string }> = {};
for (const { model, provider } of CELLS) {
  process.stderr.write(`\n[${provider}/${model}] running... `);
  const r = await runCell(model, provider);
  results[`${provider}/${model}`] = r;
  process.stderr.write(`${r.outcome}\n  ${r.detail}\n`);
}
console.log("STEP3_PATH_AUTHORITY_RESULTS=" + JSON.stringify(results, null, 2));
