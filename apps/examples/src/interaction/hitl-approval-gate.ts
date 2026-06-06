/**
 * Aspirational Example (xfail target): HITL approval gate via `human-escalate` controller
 *
 * GAP STATEMENT
 *   human-escalate variant has evaluator but NO registered handler
 *   (packages/reactive-intelligence/src/controller/handlers/index.ts:15-25 only
 *   registers 9 of 13 controller variants); HITL bridge missing — interaction-manager
 *   approvalGate exists at packages/interaction/src/services/interaction-manager.ts:100
 *   but is unreachable from the controller decision path.
 *
 *   Companion gaps:
 *     - No `.withReactiveIntelligence({ controller: { humanEscalate: true } })` opt-in.
 *     - No `.withInteractionMode("approval")` builder hook.
 *
 * SPEC (executable witness — must pass once the feature ships):
 *   const agent = await ReactiveAgents.create()
 *     .withProvider("test")
 *     .withReasoning()
 *     .withReactiveIntelligence({ controller: { humanEscalate: true } })  // doesn't exist
 *     .withInteractionMode("approval")                                     // wire hook
 *     .build();
 *
 *   // Running a task that the evaluator flags as needing human review must:
 *   //   1. produce a controller decision with type "human-escalate"
 *   //   2. invoke a registered handler
 *   //   3. that handler must call interactionManager.approvalGate(...)
 *
 * Usage:
 *   bun run apps/examples/src/interaction/hitl-approval-gate.ts
 */

import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(_opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  console.log("=== Aspirational: HITL approval gate via human-escalate ===\n");

  const gaps: string[] = [];

  // ── Surface gap 1: handler registry is missing human-escalate ───────────────
  try {
    const { defaultInterventionRegistry } = (await import(
      "@reactive-agents/reactive-intelligence"
    )) as { defaultInterventionRegistry?: ReadonlyArray<{ type?: string }> };
    const registry = defaultInterventionRegistry ?? [];
    const types = new Set(
      registry
        .map((h) => (h && typeof h === "object" ? (h as any).type : undefined))
        .filter(Boolean),
    );
    if (!types.has("human-escalate")) {
      gaps.push(
        `defaultInterventionRegistry has ${registry.length} handlers; none of type "human-escalate".`,
      );
    }
  } catch (err) {
    gaps.push(`could not inspect controller handler registry: ${(err as Error).message}`);
  }

  // ── Surface gap 2: builder hooks are missing ────────────────────────────────
  const probe = ReactiveAgents.create() as any;
  if (typeof probe.withInteractionMode !== "function") {
    gaps.push(".withInteractionMode() builder hook missing.");
  }
  // withReactiveIntelligence may exist but accepting `{ controller: { humanEscalate } }`
  // is the opt-in surface we want.
  let acceptedConfig = false;
  try {
    if (typeof probe.withReactiveIntelligence === "function") {
      const tentative = probe.withReactiveIntelligence({ controller: { humanEscalate: true } });
      acceptedConfig = !!tentative;
    } else {
      gaps.push(".withReactiveIntelligence() builder hook missing.");
    }
  } catch (err) {
    gaps.push(
      `.withReactiveIntelligence({ controller: { humanEscalate: true } }) rejected: ${(err as Error).message}`,
    );
  }
  if (!acceptedConfig && !gaps.some((g) => g.includes("withReactiveIntelligence"))) {
    gaps.push(".withReactiveIntelligence accepts no controller.humanEscalate opt-in.");
  }

  // ── If any gap → fail with composite message ────────────────────────────────
  if (gaps.length > 0) {
    return {
      passed: false,
      output:
        "human-escalate variant has evaluator but NO registered handler " +
        "(handlers/index.ts only registers 9 of 13 variants); HITL bridge " +
        "missing — interaction-manager.approvalGate exists at packages/interaction " +
        "but is unreachable from the controller decision path. Gaps: " +
        gaps.join(" | "),
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  }

  // ── If we reach here, all wiring exists. Exercise it. ───────────────────────
  // (When this branch is reached, the feature has shipped — drop expectsFail.)
  try {
    const agent = await (ReactiveAgents.create() as any)
      .withName("xfail-hitl")
      .withProvider("test")
      .withTestScenario([{ match: "review", text: "needs human review" }])
      .withReasoning()
      .withReactiveIntelligence({ controller: { humanEscalate: true } })
      .withInteractionMode("approval")
      .withMaxIterations(3)
      .build();

    // The minimum witness would be the handler reaching the approval gate. The
    // approval-observation surface (callback, queue, event) is UNDESIGNED — there
    // is no public API to subscribe to yet (`onApprovalRequest` was never shipped
    // and HITL is not on the roadmap), so this probe cannot observe an approval
    // and therefore cannot pass until that surface is designed.
    const r = await agent.run("Please review this risky action and approve.");
    const passed = false;
    return {
      passed,
      output:
        "Wiring exists but the approval-observation surface is undesigned; " +
        "the approval gate could not be witnessed.",
      steps: r?.metadata?.stepsCount ?? 0,
      tokens: r?.metadata?.tokensUsed ?? 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      output: `HITL flow threw during execution: ${(err as Error).message}`,
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  }
}

if (import.meta.main) {
  run().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.passed ? 0 : 1);
  });
}
