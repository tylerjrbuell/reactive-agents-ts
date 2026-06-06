// apps/advocate/src/harness/growth-harness.ts
import type { Harness } from "reactive-agents/core";

const INVARIANTS = [
  "GROWTH-AGENT INVARIANTS (non-negotiable):",
  "1. NEVER claim to have posted anything — you only save drafts for human review.",
  "2. Lead with genuine value; mention reactive-agents only when it truly helps the person.",
  "3. In competitive scorecards, cite ONLY evidence urls returned by competitive-intel, each with its confidence level. Never invent links.",
  "4. Skip any thread where mentioning the framework would be spammy.",
  "",
].join("\n");

/** Hard guardrails injected into the system prompt every iteration (persona-independent,
 *  so other context can't dilute them). Uses the live `prompt.system` transform chokepoint. */
export const growthInvariants = (h: Harness): void => {
  h.on("prompt.system", (system) => INVARIANTS + (system ?? ""));
};

/** Observability taps for the Cortex demo + debugging. Defaults to console logging. */
export const growthObservability =
  (log: (s: string) => void = (s) => console.log(s)) =>
  (h: Harness): void => {
    h.tap("message.tool-result", (msg, ctx) => {
      const name = (msg as Record<string, unknown>)["toolName"] ?? "unknown";
      log(`[advocate] tool-result ${String(name)} iter=${ctx.iteration}`);
    });
    h.tap("lifecycle.failure", (payload, ctx) => {
      log(`[advocate] failure reason=${payload.reason} streak=${payload.failureStreak} iter=${ctx.iteration}`);
    });
    h.tap("nudge.loop-detected", (_nudge, ctx) => {
      log(`[advocate] loop-detected iter=${ctx.iteration}`);
    });
  };
