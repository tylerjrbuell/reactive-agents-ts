// AgentMemory port — North Star §3.1, FIX-34 / W11.
//
// One of the three NS ports (Capability + AgentMemory + Verification). The
// kernel's reasoning code MUST NOT depend on `@reactive-agents/memory` at
// runtime — it depends on this port. Adapter Layers in the memory package
// (or in user code) provide the implementation.
//
// Surface is intentionally narrow: ONLY what the kernel actually uses today
// (semantic write at tool-execution). Don't widen the port "just in case" —
// that's how ports rot back into anti-ports. New kernel needs add new
// methods deliberately, with a corresponding adapter update.
//
// Phase-2 prep note: this lands the port pattern with one consumer
// (tool-execution.ts) and one provider (memory's adapter). The payoff
// arrives when a second provider wires up — e.g. user agents that supply
// their own AgentMemory implementation without dragging in @reactive-agents/memory.
// Until that second consumer or provider exists, this is an indirection
// layer that establishes the seam.

import { Context, Effect } from "effect";

/**
 * Narrow input shape for AgentMemory.storeSemantic.
 *
 * Mirrors only the fields the kernel actually populates. Adapters in
 * fuller memory implementations are free to require richer types
 * internally — they convert at the adapter boundary, not here.
 */
export interface AgentMemoryEntry {
  /** Stable identifier the caller assigns. */
  readonly id: string;
  /** Agent that owns this entry — used for cross-run isolation by adapters. */
  readonly agentId: string;
  /** Full content body. Adapters may compress / chunk. */
  readonly content: string;
  /** Short summary; falls back to `${toolName} observation` style at call site. */
  readonly summary: string;
  /** 0..1; lower = transient observation, higher = durable fact. */
  readonly importance: number;
  /** Whether the writer has verified the entry against ground truth. */
  readonly verified: boolean;
  /** Free-form tags for retrieval. */
  readonly tags: readonly string[];
  /** Adapter-friendly timestamps. */
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly accessCount: number;
  readonly lastAccessedAt: Date;
}

/**
 * AgentMemory port. The kernel resolves THIS Tag, not the heavier
 * `MemoryService` Tag from `@reactive-agents/memory`.
 *
 * `storeSemantic` returns the assigned id (the adapter may overwrite the
 * caller-supplied id), and is permitted to fail with `unknown` errors —
 * the kernel call site swallows-and-emits via `emitErrorSwallowed`, since
 * memory writes are best-effort.
 */
export class AgentMemory extends Context.Tag("AgentMemory")<
  AgentMemory,
  {
    readonly storeSemantic: (
      entry: AgentMemoryEntry,
    ) => Effect.Effect<string, unknown>;
  }
>() {}
