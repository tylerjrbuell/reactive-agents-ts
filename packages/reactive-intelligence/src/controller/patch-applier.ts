import type { KernelStateLike } from "@reactive-agents/core";
import type { KernelStatePatch } from "./intervention.js";

type PatchedState = KernelStateLike & Record<string, unknown>;

/**
 * Applies a sequence of `KernelStatePatch` objects to a `KernelStateLike`,
 * returning a new state object. Never mutates the input.
 *
 * Fields that live outside the `KernelStateLike` interface (e.g. terminate,
 * pendingStrategySwitch, pendingGuidance, activatedSkills, systemNudges) are
 * carried as extra properties via the `Record<string, unknown>` intersection.
 */
export function applyPatches(
  state: Readonly<KernelStateLike & Record<string, unknown>>,
  patches: readonly KernelStatePatch[],
): PatchedState {
  let next: PatchedState = {
    ...state,
    currentOptions: { ...(state["currentOptions"] as object ?? {}) },
    messages: [...(state["messages"] as unknown[] ?? [])],
  };
  for (const p of patches) {
    next = applyOne(next, p);
  }
  return next;
}

function applyOne(state: PatchedState, p: KernelStatePatch): PatchedState {
  switch (p.kind) {
    case "early-stop":
      return { ...state, terminate: true, terminationReason: p.reason };

    case "set-temperature":
      return {
        ...state,
        currentOptions: { ...(state["currentOptions"] as object ?? {}), temperature: p.temperature },
      };

    case "request-strategy-switch":
      return { ...state, pendingStrategySwitch: { to: p.to, reason: p.reason } };

    case "inject-tool-guidance":
      return {
        ...state,
        pendingGuidance: [
          ...((state["pendingGuidance"] as unknown[] | undefined) ?? []),
          { kind: "tool", text: p.text },
        ],
      };

    case "compress-messages":
      return {
        ...state,
        messages: compressMessages(
          state["messages"] as Array<{ tokens?: number }>,
          p.targetTokens,
        ),
      };

    case "inject-skill-content":
      return {
        ...state,
        activatedSkills: [
          ...((state["activatedSkills"] as unknown[] | undefined) ?? []),
          { id: p.skillId, content: p.content },
        ],
      };

    case "append-system-nudge":
      return {
        ...state,
        systemNudges: [
          ...((state["systemNudges"] as string[] | undefined) ?? []),
          p.text,
        ],
      };

    default: {
      const _exhaustive: never = p;
      throw new Error(`Unknown patch kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function compressMessages(
  messages: Array<{ tokens?: number }>,
  targetTokens: number,
): Array<{ tokens?: number }> {
  const total = messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
  if (total === 0) {
    // No token annotations present — fall back to count-based: keep last N messages
    // where N is a rough estimate of how many messages fit in targetTokens (~200 tok/msg).
    const keepCount = Math.max(1, Math.ceil(targetTokens / 200));
    return messages.slice(Math.max(0, messages.length - keepCount));
  }
  const kept = [...messages];
  let running = total;
  while (running > targetTokens && kept.length > 1) {
    const dropped = kept.shift()!;
    running -= dropped.tokens ?? 0;
  }
  return kept;
}
