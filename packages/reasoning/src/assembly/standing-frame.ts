// File: src/assembly/standing-frame.ts
//
// The Projector's standing-frame render authority (Wave D / task D1, meta-loop
// spec §3). The projector is the LAST node of the DAG:
//
//   RunContract → RunLedger → RunAssessment → (Control/Policy) → Actuators → Projector
//
// The ledger owns *what is true*; the projector owns *what the model sees*. This
// module is the SINGLE place that renders the run's STANDING FRAME — the context
// that persists across the loop and (crucially) across a strategy switch:
//
//   1. priorContext  — carried context from BEFORE this kernel pass (switch
//                      handoffs folded by strategy-switch, ToT selected-approach,
//                      reflexion hints, memory bootstrap). This RETIRES the H1
//                      hotfix (audit 03-F1): the priorContext block was a
//                      provisional patch on the systemPromptStage seam; it is now
//                      a first-class projector responsibility.
//   2. handoff       — strategy-switch handoffs read FROM THE LEDGER (audit
//                      03-F5: the carried handoff summary lived in state but never
//                      reached the prompt via the DAG source of truth). This is
//                      the one DELIBERATE output addition D1 makes — dormant until
//                      a `handoff` ledger entry exists, so every pre-D1 render is
//                      byte-identical.
//   3. outstanding   — contract.outstanding rendered as the standing goal frame
//                      (spec §3 "outstanding requirements rendered"). Gated behind
//                      the long-horizon profile (lift-gate discipline, matching
//                      A2/E3): the DEFAULT profile is byte-identical to today.
//
// Render PROFILES are keyed by assessment.phase (spec §3: "phase decides render
// profile"). The DEFAULT profile (no long-horizon / no assessment) renders no
// outstanding frame and no phase emphasis — byte-identical to pre-D1 assembly.
// Phase-driven variation only CHANGES output under the long-horizon profile.
//
// Pure — no I/O, no state mutation. Type-only imports of the upstream DAG nodes
// (contract/ledger/assessment) so there is no runtime cycle; the ledger is a
// plain readonly array, filtered inline (no value import from kernel/ledger).

import type { RunContract } from "../kernel/contract/run-contract.js";
import type { RunLedger, HandoffEntry } from "../kernel/ledger/run-ledger.js";
import type { RunAssessment, RunPhase } from "../kernel/assessment/assess.js";

// ─── Rendered-section provenance (the traceability half of the contract) ──────

/** A rendered standing-frame section + the ledger/contract refs it derives from. */
export interface StandingFrameSection {
  readonly name: "priorContext" | "handoff" | "outstanding";
  /** The EXACT prompt part text (pushed verbatim into the system prompt). */
  readonly text: string;
  /** Provenance: the ledger/contract refs this section was rendered from. */
  readonly refs: readonly string[];
}

/** The rendered standing frame: ordered parts + their provenance. */
export interface StandingFrame {
  readonly sections: readonly StandingFrameSection[];
}

export interface StandingFrameInput {
  readonly priorContext?: string;
  readonly ledger?: RunLedger;
  readonly contract?: RunContract;
  readonly assessment?: RunAssessment;
  /** Opt-in long-horizon profile (state.meta.horizonProfile === "long"). */
  readonly longHorizon?: boolean;
}

// ─── Render profiles keyed by run phase (spec §3) ─────────────────────────────

/** A projection render profile — what the standing frame emphasises this phase. */
export interface ProjectionProfile {
  readonly phase: RunPhase | "default";
  /** Render the contract's outstanding requirements as the standing goal frame. */
  readonly showOutstanding: boolean;
  /** A one-line phase steer prepended to the outstanding frame (omitted default). */
  readonly emphasis?: string;
}

/** The DEFAULT profile — byte-identical to pre-D1 assembly (no outstanding frame). */
export const DEFAULT_PROFILE: ProjectionProfile = { phase: "default", showOutstanding: false };

/**
 * W4.4 — the CONTRACT profile: the default render when a compiled RunContract
 * exists. Content only (no phase emphasis): the outstanding requirements are
 * recited into the F10 volatile tail every iteration so the model always sees
 * what remains. `showOutstanding: true` here is the "true-when-contract" half of
 * `DEFAULT_PROFILE.showOutstanding` — a contractless run keeps the historical
 * DEFAULT_PROFILE and is byte-identical.
 */
export const CONTRACT_PROFILE: ProjectionProfile = { phase: "default", showOutstanding: true };

/** Phase-keyed profiles applied ONLY under the long-horizon profile. */
export const PHASE_PROFILES: Readonly<Record<RunPhase, ProjectionProfile>> = {
  orient: {
    phase: "orient",
    showOutstanding: true,
    emphasis: "Orient: map what the outstanding requirements below demand before acting.",
  },
  gather: {
    phase: "gather",
    showOutstanding: true,
    emphasis: "Gather evidence for the outstanding requirements below — breadth over depth.",
  },
  execute: {
    phase: "execute",
    showOutstanding: true,
    emphasis: "Execute: produce the outstanding deliverables below.",
  },
  synthesize: {
    phase: "synthesize",
    showOutstanding: true,
    emphasis:
      "Synthesize NOW: produce the outstanding deliverables below from evidence already gathered — do not gather further.",
  },
  verify: {
    phase: "verify",
    showOutstanding: true,
    emphasis: "Verify each outstanding requirement below is satisfied before finishing.",
  },
};

/**
 * Select the render profile. The DEFAULT profile is used unless the long-horizon
 * profile is active AND an assessment (with a phase) exists — the lift-gate seam:
 * phase-driven variation only reaches the prompt under the opt-in profile.
 */
export function selectProfile(input: StandingFrameInput): ProjectionProfile {
  if (input.longHorizon && input.assessment) return PHASE_PROFILES[input.assessment.phase];
  // W4.4 — outstanding recitation default-on: a compiled RunContract present
  // (every run by default) shows the outstanding frame even without the
  // long-horizon profile. No contract → the historical DEFAULT_PROFILE
  // (byte-identical parity).
  if (input.contract) return CONTRACT_PROFILE;
  return DEFAULT_PROFILE;
}

// ─── Ledger reads (inline; RunLedger is a plain readonly array) ────────────────

/**
 * W4.4 — max outstanding items recited into the volatile tail before the
 * `(+K more)` overflow marker (precedent: compaction.ts `buildStub`). Bounds the
 * tail-bloat regression the plan's scoreboard tokens/run guard watches.
 */
const MAX_OUTSTANDING_ITEMS = 8;

function handoffEntries(ledger: RunLedger | undefined): readonly HandoffEntry[] {
  return (ledger ?? []).filter((e): e is HandoffEntry => e.kind === "handoff");
}

/**
 * Ids of requirements this run has already satisfied.
 *
 * The RunAssessment is AUTHORITATIVE: `assess()` recomputes satisfaction every
 * iteration from post-conditions and artifact facts, and the assessment is
 * already threaded to the projector (from-kernel-state → project → system-prompt).
 *
 * The ledger `requirement` entries are the intended long-term substrate, but
 * NOTHING mints them today (kind declared at run-ledger.ts:97, zero writers).
 * Reading only the ledger meant `satisfied` was always empty, so the standing
 * frame re-listed finished work as outstanding and told the model to redo it
 * (wiring audit 2026-07-09). We prefer the assessment and keep the ledger read
 * as a union, so this becomes a no-op the day an emitter lands.
 */
function satisfiedRequirementIds(
  ledger: RunLedger | undefined,
  assessment: RunAssessment | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>(assessment?.requirements.satisfied ?? []);
  for (const e of ledger ?? []) {
    if (e.kind === "requirement" && e.status === "satisfied") ids.add(e.requirementId);
  }
  return ids;
}

/**
 * W4.4 — the ordered, DEDUPED outstanding requirement ids to recite.
 *
 * The RunAssessment's `requirements.outstanding` is authoritative when present
 * (it is the same partition every other consumer reads); otherwise fall back to
 * contract-minus-satisfied. Satisfied ids (already recited-and-done) are
 * excluded and duplicate ids collapse to one entry, so the tail never re-lists
 * finished work or repeats an item.
 */
function outstandingRequirementIds(
  contract: RunContract,
  ledger: RunLedger | undefined,
  assessment: RunAssessment | undefined,
): readonly string[] {
  const satisfied = satisfiedRequirementIds(ledger, assessment);
  const source =
    assessment?.requirements.outstanding ??
    contract.requirements.map((r) => r.id).filter((id) => !satisfied.has(id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of source) {
    if (satisfied.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ─── The render (pure) ─────────────────────────────────────────────────────────

/**
 * Render the standing frame. Returns ordered sections whose `.text` is pushed
 * VERBATIM into the system prompt (each carries a leading blank line so it reads
 * as its own block, matching the pre-D1 priorContext part exactly).
 *
 * Byte-identical guarantee: with only `priorContext` set (no ledger handoff, no
 * long-horizon), the sole section's text is exactly the pre-D1 priorContext part.
 */
export function renderStandingFrame(input: StandingFrameInput): StandingFrame {
  const sections: StandingFrameSection[] = [];

  // 1. priorContext (retired H1 patch — now owned here). Byte-identical text.
  const prior = input.priorContext?.trim();
  if (prior) {
    sections.push({
      name: "priorContext",
      text: `\nPrior context (from earlier work on this task):\n${prior}`,
      refs: [],
    });
  }

  // 2. handoff — rendered FROM THE LEDGER (audit 03-F5). The deliberate D1
  //    addition; dormant (no section) when the ledger carries no handoff.
  const handoffs = handoffEntries(input.ledger);
  if (handoffs.length > 0) {
    const body = handoffs
      .map((h) => `Prior strategy handoff (${h.from} → ${h.to}):\n${h.summary}`)
      .join("\n\n");
    sections.push({
      name: "handoff",
      text: `\n${body}`,
      refs: handoffs.map((h) => `ledger://handoff/${h.seq}`),
    });
  }

  // 3. outstanding — the contract's outstanding requirements as the standing
  //    goal frame. W4.4: shown whenever a contract exists (CONTRACT_PROFILE);
  //    phase emphasis still only under the long-horizon profile. Bounded to
  //    MAX_OUTSTANDING_ITEMS with a `(+K more)` overflow marker.
  const profile = selectProfile(input);
  if (profile.showOutstanding && input.contract) {
    const ids = outstandingRequirementIds(input.contract, input.ledger, input.assessment);
    const byId = new Map(input.contract.requirements.map((r) => [r.id, r]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    if (items.length > 0) {
      const shown = items.slice(0, MAX_OUTSTANDING_ITEMS);
      const more = items.length - shown.length;
      const lines = shown.map((r) => `- [${r.id}] ${r.spec.description}`).join("\n");
      const moreLine = more > 0 ? `\n(+${more} more)` : "";
      const head = profile.emphasis ? `${profile.emphasis}\n` : "";
      sections.push({
        name: "outstanding",
        text: `\n${head}Outstanding requirements:\n${lines}${moreLine}`,
        refs: items.map((r) => r.id),
      });
    }
  }

  return { sections };
}
