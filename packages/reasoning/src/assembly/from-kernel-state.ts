/**
 * from-kernel-state.ts — Adapter: KernelState → AssemblyInput
 *
 * Translates a live (or snapshot) KernelState into the pure AssemblyInput
 * shape consumed by `project()`. This is intentionally a pure function: it
 * reads from state but never mutates it. Phase 3 will route the live path
 * through project() via this adapter.
 */
import type { KernelState } from "../kernel/state/kernel-state.js";
import type { ContextProfile } from "../context/context-profile.js";
import { EventLog } from "./event-log.js";
import { ResultStore } from "./result-store.js";
import { resolveCapability, type Tier } from "./capability.js";
import type { AssemblyInput } from "./project.js";

// ── fromKernelState ───────────────────────────────────────────────────────────

/**
 * Build an `AssemblyInput` from a live `KernelState`.
 *
 * Mapping:
 * - `store`  : all scratchpad entries are seeded via `putWithRef` to preserve
 *              `_tool_result_N` identity; value is JSON-parsed (fallback: raw).
 * - `log`    : goal from first user message → tool_called per assistant toolCall
 *              → tool_result per tool_result message.
 * - `capability`: resolved from the supplied ContextProfile.
 *
 * @param state   Immutable KernelState (not mutated).
 * @param profile ContextProfile for the current run (tier, maxTokens, …).
 * @param persona System-prompt persona injected into AssemblyInput.
 * @param tools   Tool schemas for this run.
 */
export function fromKernelState(
  state: KernelState,
  profile: ContextProfile,
  persona: { system: string },
  tools: { schemas: readonly unknown[] },
): AssemblyInput {
  // ── 1. Seed ResultStore from scratchpad ──────────────────────────────────
  //
  // Build a storedKey→toolName lookup from tool_result messages first so the
  // store entries carry a useful tool name instead of the generic "tool" fallback.
  const storedKeyToTool = new Map<string, string>();
  for (const msg of state.messages) {
    if (msg.role === "tool_result" && msg.storedKey) {
      storedKeyToTool.set(msg.storedKey, msg.toolName);
    }
  }

  const store = new ResultStore();
  for (const [storedKey, jsonStr] of state.scratchpad) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = jsonStr;
    }
    const toolName = storedKeyToTool.get(storedKey) ?? "tool";
    store.putWithRef(storedKey, toolName, parsed);
  }

  // ── 2. Build EventLog ────────────────────────────────────────────────────
  //
  // The goal text lives in the first user message (the kernel seeds messages
  // with [{role:"user", content: task}] — see CLAUDE.md FC thread flow).
  let log = new EventLog();

  const firstUser = state.messages.find((m) => m.role === "user");
  if (firstUser && firstUser.role === "user") {
    log = log.append({ kind: "goal", text: firstUser.content });
  }

  for (const msg of state.messages) {
    if (msg.role === "assistant") {
      for (const tc of msg.toolCalls ?? []) {
        // ToolCallSpec.arguments is Record<string,unknown> by convention; use
        // a guard so we never cast to any.
        const args: Record<string, unknown> =
          tc.arguments !== null &&
          typeof tc.arguments === "object" &&
          !Array.isArray(tc.arguments)
            ? (tc.arguments as Record<string, unknown>)
            : {};
        log = log.append({
          kind: "tool_called",
          tool: tc.name,
          callId: tc.id,
          args,
        });
      }
    } else if (msg.role === "tool_result") {
      // Determine the ref: prefer storedKey (already in store); otherwise
      // mint a new content-hash ref via put() so every result is reachable.
      let ref: string;
      if (msg.storedKey) {
        ref = msg.storedKey;
      } else {
        // Small inline result — content not in scratchpad; store it now.
        ref = store.put(msg.toolName, msg.content);
      }
      log = log.append({
        kind: "tool_result",
        callId: msg.toolCallId,
        ref,
        shape: "result",
      });
    }
  }

  // ── 3. Resolve capability ────────────────────────────────────────────────
  const capability = resolveCapability({
    window: profile.maxTokens ?? 32_768,
    outputBudget: 2000,
    dialect: "native-fc",
    tier: (profile.tier as Tier) ?? "mid",
  });

  return { log, capability, store, persona, tools };
}
