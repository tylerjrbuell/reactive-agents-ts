import type { AssemblyCtx } from "../assembly-ctx.js";
import { pushStage } from "../trace.js";
import { renderStandingFrame, type StandingFrameSection } from "../standing-frame.js";

/**
 * F10 — put per-iteration content where it cannot break the cache.
 *
 * Anthropic caches by exact prefix, ordered `tools` -> `system` -> `messages`.
 * Content that changes between iterations therefore has exactly one safe home:
 * after the last cache breakpoint, in the message tail. The standing frame and
 * the remaining-steps list both change every iteration and both used to live
 * inside the system prompt, which invalidated the system breakpoint — and every
 * breakpoint after it — on every single turn. Measured cacheRead was 0 on the
 * default kernel path.
 *
 * This placement is also what leading harnesses do for a second, independent
 * reason: re-stating the plan at the END of the context biases attention toward
 * the goal, where the middle of a long context is where instructions go to die.
 * One move, two defects.
 *
 * Rendering is IDENTICAL to what systemPromptStage used to emit — same
 * `renderStandingFrame` call, same section order, same `Remaining steps:` line.
 * Only the destination changed. A run with neither a frame nor a plan appends
 * nothing and is byte-identical to the pre-F10 behaviour.
 *
 * NOTE on `goal_state` (DEBT-REGISTER D-2026-07-28-C): wired 2026-09-05.
 * `KernelInput.remainingGoals` — populated today only by plan-execute's
 * composite steps, from `Plan.steps` (the one typed sub-goal ledger in the
 * codebase; reactive/ToT/reflexion track progress as tool-name coverage, not
 * named sub-goals, so they have nothing to feed this from) — seeds this event
 * via `fromKernelState`. Structurally opt-in: absent/empty ⇒ no event ⇒
 * byte-identical to the pre-wiring no-op, so wiring it costs plan-execute
 * callers nothing until measured. See the D-2026-07-28-C ablation report
 * before wiring a second producer (e.g. reactive/ToT) off this result.
 */
export const volatileTailStage = (c: AssemblyCtx): AssemblyCtx => {
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const frame = renderStandingFrame({
    priorContext: c.priorContext,
    ledger: c.ledger,
    contract: c.contract,
    assessment: c.assessment,
    longHorizon: c.longHorizon,
  });

  const parts: string[] = [];
  const standingSections: StandingFrameSection[] = [];
  for (const s of frame.sections) {
    parts.push(s.text);
    standingSections.push(s);
  }
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);

  // Nothing volatile this iteration — leave the request untouched so the
  // no-plan case stays byte-identical to every historical baseline.
  if (parts.length === 0) {
    return {
      ...c,
      standingSections,
      trace: pushStage(c.trace, "volatileTail", "none"),
    };
  }

  // Section texts carry a leading blank line so they read as their own block
  // inside the system prompt. At the head of a message that leading newline is
  // just noise, so it is stripped; every byte after it is unchanged.
  const text = parts.join("\n").replace(/^\n+/, "");
  const messages = appendToTail(c.messages, text);

  return {
    ...c,
    messages,
    standingSections,
    trace: pushStage(
      c.trace,
      "volatileTail",
      `${standingSections.length} frame section(s) + ${remaining.length} remaining`,
    ),
  };
};

/**
 * Append volatile text to the end of the message list.
 *
 * Merges into the trailing message when that message is already a `user` turn,
 * rather than appending a second consecutive user message — some providers
 * reject or silently coalesce consecutive same-role turns. A trailing
 * `tool_result` (a distinct role in this representation, `types.ts:5`) or an
 * assistant turn gets a fresh trailing `user` message instead, which is the
 * shape the provider adapters expect after a tool round-trip.
 */
function appendToTail(
  messages: AssemblyCtx["messages"],
  text: string,
): AssemblyCtx["messages"] {
  const list = [...messages];
  const last = list[list.length - 1];

  if (last && last.role === "user") {
    list[list.length - 1] = { ...last, content: `${last.content}\n\n${text}` };
    return list;
  }

  list.push({ role: "user", content: text });
  return list;
}
