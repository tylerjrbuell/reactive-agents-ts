/**
 * Example 20: Compose API — .withHarness()
 *
 * Demonstrates the harness intercept system for inspecting and transforming
 * agent internals without modifying kernel source:
 *
 *   - harness.on('prompt.system', ...) — override/augment the system prompt
 *     per iteration before it reaches the LLM
 *   - harness.tap('**', ...) — observe every emission without mutation
 *   - harness.before('think', ...) / harness.after('think', ...) — phase hooks
 *   - harness.use(...) — compose reusable sub-harnesses
 *
 * Wave B status (v0.11): `prompt.system` chokepoint is live. The remaining
 * four tags (nudge.loop-detected, nudge.healing-failure, message.tool-result,
 * observation.tool-result) land in v0.12 — registrations compile fine today
 * but transforms for those tags are pass-through until v0.12 wires them.
 *
 * Usage:
 *   bun run apps/examples/src/advanced/20-compose-harness.ts
 */

import { ReactiveAgents } from "reactive-agents";
import type { Harness } from "@reactive-agents/core";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const log: string[] = [];

  // ─── Reusable audit sub-harness ───────────────────────────────────────────
  // Encapsulate logging concern; compose it into any agent via harness.use().
  function auditHarness(prefix: string) {
    return (h: Harness) => {
      h.tap("**", (payload, ctx) => {
        log.push(`[${prefix}] iter=${ctx.iteration} phase=${ctx.phase}`);
      });
    };
  }

  // ─── Agent with harness ───────────────────────────────────────────────────
  const agentBuilder = ReactiveAgents.create()
    .withName("harness-demo")
    .withProvider("test")
    .withTestScenario([
      { match: "quarterly", text: "Task complete. Security scan passed." },
    ])
    // Register a prompt.system transform: prepend a security reminder each iteration.
    .withHarness((h) => {
      // Transform: prepend a security reminder to the system prompt each iteration.
      // prompt.system is live in v0.11. The returned string replaces the original.
      h.on("prompt.system", (systemPrompt, ctx) => {
        const banner = `[Security: iteration ${ctx.iteration}] No PII in responses.\n\n`;
        return banner + (systemPrompt ?? "");
      });

      // Tap: observe the final system prompt after all transforms have run.
      h.tap("prompt.system", (prompt, ctx) => {
        log.push(`[prompt.system] iter=${ctx.iteration} len=${String(prompt).length}`);
      });

      // Tap tool results for observability (live in v0.12; no-op pass-through now).
      h.tap("message.tool-result", (msg, ctx) => {
        log.push(`[tool-result] tool=${
          (msg as Record<string, unknown>)["toolName"] ?? "unknown"
        } iter=${ctx.iteration}`);
      });

      // Phase hooks (Wave C; registered here for forward-compatibility).
      h.before("think", (_state) => {
        log.push("[phase] before:think");
      });
      h.after("think", (_state) => {
        log.push("[phase] after:think");
      });
    })
    // Second .withHarness() call composes additional registrations.
    .withHarness((h) => {
      h.use(auditHarness("audit"));
    });

  const agent = await agentBuilder.build();

  console.log("=== Harness Demo ===");

  const result = await agent.run("Summarize the quarterly report.");
  console.log("Output:", result.output);
  console.log("Success:", result.success);
  console.log("\nHarness log:");
  for (const entry of log) console.log(" ", entry);

  await agent.dispose();

  const passed = result.success && log.some((e) => e.includes("[prompt.system]"));

  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount ?? 0,
    tokens: result.metadata.tokensUsed ?? 0,
    durationMs: Date.now() - start,
  };
}

// Run directly
if (import.meta.main) {
  run()
    .then((r) => {
      console.log("\n---");
      console.log(r.passed ? "PASSED" : "FAILED", `(${r.durationMs}ms)`);
    })
    .catch(console.error);
}
