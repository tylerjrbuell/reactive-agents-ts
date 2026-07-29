// Run: bun test packages/reasoning/tests/assembly/volatile-placement.test.ts
//
// F10 — the request prefix churns, so the prompt cache never hits.
//
// Anthropic caches by exact prefix, ordered `tools` -> `system` -> `messages`.
// Anything that changes between iterations must live AFTER the last cache
// breakpoint, i.e. in the message tail. `Remaining steps:` and the standing
// frame change every iteration and currently live inside the system prompt, so
// they invalidate the system breakpoint (and everything after it) every turn.
//
// This also fixes attention placement: leading harnesses re-state the plan at
// the END of context to bias attention toward the goal. Ours sat in the middle.
//
// RED-ON-CUT: revert `volatileTailStage` and the first two cells fail.
import { describe, it, expect } from "bun:test";
import { project, type AssemblyInput } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

/**
 * `EventLog.append` is PERSISTENT — it returns a new log rather than mutating
 * (`event-log.ts:23`). Discarding the return value silently produces an empty
 * log, and every assertion below would then pass vacuously.
 */
const CAPABILITY = resolveCapability({
  window: 200_000,
  outputBudget: 4096,
  dialect: "native-fc",
  tier: "frontier",
});

/** An assembly input carrying BOTH volatile sources: a plan and prior context. */
function plannedInput(remaining: readonly string[]): AssemblyInput {
  const log = new EventLog()
    .append({ kind: "goal", text: "Count the lines in ./input.txt and write the count." })
    .append({ kind: "goal_state", remaining });
  return {
    log,
    capability: CAPABILITY,
    store: new ResultStore(),
    persona: { system: "You are a careful assistant." },
    priorContext: "Earlier pass selected the two-step approach.",
    tools: {
      schemas: [
        { name: "file-read", description: "Read a file", parameters: [] },
        { name: "file-write", description: "Write a file", parameters: [] },
      ],
    },
  };
}

/** Concatenated text of every message, in order. */
function messageText(messages: readonly unknown[]): string {
  return messages
    .map((m) => {
      const rec = m as { content?: unknown };
      if (typeof rec.content === "string") return rec.content;
      if (Array.isArray(rec.content)) {
        return rec.content
          .map((b) => (b as { text?: string }).text ?? "")
          .join("\n");
      }
      return "";
    })
    .join("\n");
}

describe("volatile content lives in the message tail, not the cached prefix", () => {
  it("keeps the per-iteration plan OUT of the system prompt", () => {
    const { request } = project(plannedInput(["read the file", "write the count"]));

    // The load-bearing assertion. This string inside `systemPrompt` is what
    // invalidates the system cache breakpoint on every iteration.
    expect(request.systemPrompt).not.toContain("Remaining steps:");
  });

  it("keeps the standing frame OUT of the system prompt", () => {
    const { request } = project(plannedInput(["read the file"]));

    // priorContext is rendered by the standing frame and changes across passes.
    expect(request.systemPrompt).not.toContain("Earlier pass selected");
  });

  it("still DELIVERS the plan to the model, somewhere in the request", () => {
    // Moving volatile content must not DROP it. The strategy-switch handoff
    // regression (H1) was exactly this: composed but never rendered, so the
    // model restarted blind after every switch.
    //
    // NOTE: asserted over the WHOLE rendered request (systemPrompt + message
    // tail), not just `request.messages`. Today (pre-Task-8) both volatile
    // sources are rendered into `systemPrompt` only — `request.messages`
    // contains just the opening goal turn, nothing from goal_state/priorContext.
    // Cells 1/2 above already pin that this location is wrong; this cell's own
    // job is narrower: prove the content survives the eventual relocation
    // rather than being silently dropped. Checking the full request keeps that
    // true both before Task 8 moves it to the tail and after.
    const { request } = project(plannedInput(["read the file", "write the count"]));
    const rendered = `${request.systemPrompt}\n${messageText(request.messages)}`;

    expect(rendered).toContain("read the file");
    expect(rendered).toContain("Earlier pass selected");
  });

  it("holds the system prompt BYTE-STABLE across iterations that differ only in plan state", () => {
    // The whole point: two iterations of the same run, different remaining
    // steps, must produce an identical cacheable prefix.
    const a = project(plannedInput(["read the file", "write the count"]));
    const b = project(plannedInput(["write the count"]));

    expect(a.request.systemPrompt).toBe(b.request.systemPrompt);
  });

  it("leaves a run with no plan and no frame byte-identical to before", () => {
    // Back-compat: the common no-plan case must not change at all, or this
    // 'fix' silently re-scales every historical baseline.
    const bare: AssemblyInput = {
      log: new EventLog().append({ kind: "goal", text: "What is 2+2?" }),
      capability: CAPABILITY,
      store: new ResultStore(),
      persona: { system: "You are a careful assistant." },
      tools: { schemas: [] },
    };

    const before = project(bare);
    expect(before.request.systemPrompt).toContain("What is 2+2?");
    expect(before.request.systemPrompt).not.toContain("Remaining steps:");
    // No volatile content means volatileTailStage appends nothing at all.
    expect(before.request.messages.length).toBe(
      project(bare).request.messages.length,
    );
  });
});
