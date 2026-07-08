// File: src/assembly/compaction.ts
//
// The ONE compaction path (Wave C / task C4, audit 03-F4).
//
// Compaction is a RE-PROJECTION of the message window, never an in-place rewrite
// of history (DAG law). This module owns the single algorithm the assembly
// pipeline uses when the projected thread overflows the recency window. It
// replaces the old blind "cut the thread in half + stub-that-lies" logic with:
//
//   1. PROTECTED entry classes (declared ONCE, here) that compaction must never
//      drop: the goal, preserved observations (`preserveOnCompaction`, audit
//      03-F4 — now LIVE), and the most-recent evidence. Handoffs + the
//      contract's outstanding requirements are protected structurally by living
//      in the (never-compacted) system prompt today; when Wave D moves them into
//      the projected window they classify as `handoff` / `contract-outstanding`
//      here and are covered by the same declaration.
//   2. HONEST stubs: a dropped exchange is replaced by a stub that ENUMERATES
//      the recallable refs of what it dropped (via ref-grammar `renderRecallHint`
//      so each is matched by the recall gate + resolvable in the store) — no more
//      "summarized" lies that pointed at nothing (audit 03-F4).
//   3. A post-compaction SIZE self-check: the window must strictly shrink; if it
//      does not (everything protected, nothing droppable), a no-shrink event is
//      raised so the caller can signal instead of silently no-op'ing.
//
// Pure — no Effect, no state, no I/O. The caller (compactHistoryStage) records
// the trace + the `compaction-marker` ledger fact from the returned refs.

import { isRecallableRef, renderRecallHint } from "./ref-grammar.js";

/** The provider-boundary message shape compaction operates on (mutable working copy). */
export interface CompactMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: unknown;
}

/** Per-tool-result facts compaction needs, keyed by tool-call id (from the EventLog). */
export interface ResultInfo {
  /** The store/scratchpad ref this result is stored under. */
  readonly ref: string;
  /** `preserveOnCompaction` — carried from the observation (audit 03-F4). */
  readonly preserve: boolean;
}

export interface CompactionInput {
  readonly messages: readonly CompactMessage[];
  /** Total-thread char budget above which compaction is attempted. */
  readonly limitChars: number;
  /** callId → {ref, preserve}. Empty when the caller has no EventLog correlation. */
  readonly resultInfo: ReadonlyMap<string, ResultInfo>;
}

/** The protected entry classes compaction must never drop (declared ONCE). */
export type ProtectedClass =
  | "goal"
  | "preserved"
  | "recent-evidence"
  | "handoff"
  | "contract-outstanding";

export interface CompactionResult {
  readonly messages: CompactMessage[];
  /** Every ref (recallable or not) dropped this compaction — for the ledger marker. */
  readonly droppedRefs: readonly string[];
  /** True iff compaction was attempted (thread was over `limitChars`). */
  readonly attempted: boolean;
  /** True iff the window strictly shrank (chars). */
  readonly shrank: boolean;
  /** True iff compaction was attempted but the window did NOT shrink. */
  readonly noShrinkEvent: boolean;
  /** How many exchanges were dropped. */
  readonly droppedBlocks: number;
}

/** Max refs enumerated inside a single stub (keeps the stub itself bounded). */
const MAX_STUB_REFS = 20;

const totalChars = (messages: readonly CompactMessage[]): number =>
  messages.reduce((n, m) => n + (m.content ?? "").length, 0);

// ─── Block model ──────────────────────────────────────────────────────────────
//
// A block is the atomic unit compaction keeps-or-drops. Keeping WHOLE blocks is
// what preserves native-FC thread validity: an assistant tool-call turn always
// travels with its tool_result answers, so a kept tool_result is never orphaned
// and a dropped tool_use never leaves a dangling answer.

interface Block {
  readonly msgs: CompactMessage[];
  /** Refs of tool_results in this block (recallable or not). */
  readonly refs: string[];
  /** Recallable refs only — the ones a stub may enumerate resolvably. */
  readonly recallableRefs: string[];
  isGoal: boolean;
  hasPreserve: boolean;
  hasEvidence: boolean;
}

/**
 * Group a flat message thread into keep-or-drop blocks. An `assistant` turn
 * absorbs the `tool_result` messages that immediately follow it (a parallel
 * batch collapses into one block); every other message is a singleton block.
 * A leading `user` singleton is tagged `isGoal`.
 */
function groupBlocks(
  messages: readonly CompactMessage[],
  resultInfo: ReadonlyMap<string, ResultInfo>,
): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.role === "assistant") {
      const msgs: CompactMessage[] = [m];
      const refs: string[] = [];
      const recallableRefs: string[] = [];
      let hasPreserve = false;
      let hasEvidence = false;
      i++;
      while (i < messages.length && messages[i]!.role === "tool_result") {
        const tr = messages[i]!;
        msgs.push(tr);
        hasEvidence = true;
        const info = tr.toolCallId ? resultInfo.get(tr.toolCallId) : undefined;
        if (info) {
          refs.push(info.ref);
          if (isRecallableRef(info.ref)) recallableRefs.push(info.ref);
          if (info.preserve) hasPreserve = true;
        }
        i++;
      }
      blocks.push({ msgs, refs, recallableRefs, isGoal: false, hasPreserve, hasEvidence });
    } else {
      blocks.push({
        msgs: [m],
        refs: [],
        recallableRefs: [],
        isGoal: blocks.length === 0 && m.role === "user",
        hasPreserve: false,
        hasEvidence: false,
      });
      i++;
    }
  }
  return blocks;
}

/** Mint the honest compaction stub — enumerates recallable dropped refs. */
function buildStub(droppedBlocks: number, recallableRefs: readonly string[]): CompactMessage {
  const uniq = [...new Set(recallableRefs)];
  const shown = uniq.slice(0, MAX_STUB_REFS);
  const pointers = shown.map((r) => renderRecallHint(r, "full")).join(", ");
  const more = uniq.length > shown.length ? ` (+${uniq.length - shown.length} more)` : "";
  const retrieval = pointers
    ? ` Their full results remain retrievable by reference: ${pointers}${more}.`
    : "";
  return {
    role: "user",
    content:
      `[history compacted: ${droppedBlocks} earlier exchange(s) dropped to fit the ` +
      `context window.${retrieval}]`,
  };
}

/**
 * Compact a message thread by re-projection with protected entry classes.
 *
 * Under the budget → no-op (untouched thread, `attempted:false`). Over budget →
 * drop non-protected exchanges oldest-first until under budget (or nothing more
 * is droppable), replacing them with ONE honest stub that enumerates the dropped
 * recallable refs. Protected classes (goal, `preserveOnCompaction`, most-recent
 * evidence) always survive. If the window could not shrink, `noShrinkEvent` is
 * set so the caller signals rather than silently no-op'ing.
 */
export function compact(input: CompactionInput): CompactionResult {
  const { messages, limitChars, resultInfo } = input;
  const before = totalChars(messages);

  if (before <= limitChars) {
    return {
      messages: [...messages],
      droppedRefs: [],
      attempted: false,
      shrank: false,
      noShrinkEvent: false,
      droppedBlocks: 0,
    };
  }

  const blocks = groupBlocks(messages, resultInfo);

  // ── Declare protection (the ONE place protected classes are decided) ─────────
  //
  // recent-evidence: the last evidence block and everything after it. This keeps
  // the freshest tool results (the ones the model is acting on now) plus any
  // trailing turns.
  let lastEvidenceIdx = -1;
  for (let b = 0; b < blocks.length; b++) if (blocks[b]!.hasEvidence) lastEvidenceIdx = b;

  const isProtected = (b: number): boolean => {
    const blk = blocks[b]!;
    if (blk.isGoal) return true; // goal
    if (blk.hasPreserve) return true; // preserveOnCompaction (LIVE — audit 03-F4)
    if (lastEvidenceIdx >= 0 && b >= lastEvidenceIdx) return true; // recent-evidence
    return false;
  };

  // ── Drop non-protected blocks oldest-first until under budget ─────────────────
  const dropped = new Set<number>();
  let running = before;
  for (let b = 0; b < blocks.length && running > limitChars; b++) {
    if (isProtected(b)) continue;
    dropped.add(b);
    running -= totalChars(blocks[b]!.msgs);
  }

  // ── Rebuild the window: one stub at the first dropped position ────────────────
  const droppedRefs: string[] = [];
  const droppedRecallable: string[] = [];
  for (const b of dropped) {
    droppedRefs.push(...blocks[b]!.refs);
    droppedRecallable.push(...blocks[b]!.recallableRefs);
  }

  const out: CompactMessage[] = [];
  let stubInserted = false;
  for (let b = 0; b < blocks.length; b++) {
    if (dropped.has(b)) {
      if (!stubInserted) {
        out.push(buildStub(dropped.size, droppedRecallable));
        stubInserted = true;
      }
      continue;
    }
    out.push(...blocks[b]!.msgs);
  }

  const after = totalChars(out);
  const shrank = after < before;
  return {
    messages: out,
    droppedRefs,
    attempted: true,
    shrank,
    noShrinkEvent: !shrank,
    droppedBlocks: dropped.size,
  };
}
