/**
 * CapabilityRegistry — single Effect-injected service that stores, for
 * every default-on (and tracked opt-in) capability, a typed entry with
 * cost signature, lift evidence, owner warden, and last-ablation date.
 *
 * Designed per MOVE-2 spec at
 * `wiki/Architecture/Design-Specs/2026-05-26-capability-cost-registry.md`.
 * Master plan §3 root cause #1 names the deficit: defaults scattered
 * across 5+ files with no collocated rationale → Lever-8 regression was
 * caught by Mastra bench divergence, not by registry-driven CI.
 *
 * Schema is deliberately narrow (8 fields). Only capabilities with
 * meaningful cost / lift dimension qualify — tools, hooks, low-level
 * config stay out. See §2.3 of the spec for non-features.
 *
 * Bootstrap registers 4 initial entries (memory, reactive-intelligence,
 * verifier, strategy-switching) at L start; the strategy-switching entry
 * deliberately ships with `liftEvidence: null` as the registry's first
 * load-bearing signal — ablation-warden CI gate (M2.3) flags it on
 * first run, forcing either evidence-gathering or default-revert.
 *
 * Status: M2.1 — registry + bootstrap. Consumer surfaces (M2.2 audit
 * API, M2.3 warden gate) ship in follow-up commits per spec §5.
 */
import { Effect, Layer, Ref, Context } from "effect";
import { Data } from "effect";

// ─── Schema ────────────────────────────────────────────────────────────────

export type WardenOwner =
  | "kernel"
  | "runtime"
  | "compose"
  | "memory"
  | "tools"
  | "provider"
  | "reactive-intelligence"
  | "harness";

export type TierId = "local" | "mid" | "large" | "frontier";

export interface CostSignature {
  /** Estimated tokens added per agent.run() when capability is on (average). */
  readonly tokensPerRun: number;
  /** Estimated wall-clock latency added per agent.run() (ms). */
  readonly latencyPerRunMs: number;
  /** Number of additional LLM calls per run (0 if pure-compute capability). */
  readonly extraLLMCalls: number;
  /** Tier-specific multipliers when meaningful. */
  readonly tierMultiplier?: Readonly<Record<TierId, number>>;
}

export interface LiftEvidence {
  /** Tier identifiers the lift was measured on. ≥2 required for default-on per ablation-warden rules. */
  readonly measuredOn: readonly TierId[];
  /** Quantified delta (e.g., "+3pp first-attempt accuracy"). */
  readonly averageDelta: string;
  /** Pointer to evidence artifact in wiki/Research/. */
  readonly evidence: string;
  /** When the evidence was collected (ISO date). */
  readonly measuredAt: string;
}

export interface CapabilityEntry {
  /** Unique stable identifier. */
  readonly name: string;
  /** Human-readable purpose (one sentence). */
  readonly description: string;
  /** Default state when no explicit user opt-in/out. */
  readonly defaultOn: boolean;
  /** Static cost estimate. */
  readonly costSignature: CostSignature;
  /** Empirical evidence backing `defaultOn`. Required (non-null) when defaultOn=true per ablation-warden gate (M2.3). */
  readonly liftEvidence: LiftEvidence | null;
  /** Known failure modes, free-form. */
  readonly riskNotes: string;
  /** Why this default. */
  readonly rationale: string;
  /** Which warden owns this capability per pilot ownership routing. */
  readonly ownerWarden: WardenOwner;
  /** Last time ablation-warden re-verified this entry (ISO date). */
  readonly lastAblation: string | null;
}

export interface CapabilityAuditReport {
  readonly totalEntries: number;
  readonly defaultOnCount: number;
  readonly entries: readonly CapabilityEntry[];
  readonly byWarden: Readonly<Partial<Record<WardenOwner, readonly CapabilityEntry[]>>>;
  /** Entries flagged as stale (lastAblation older than `staleThresholdDays`). */
  readonly staleEntries: readonly CapabilityEntry[];
  /** Default-on entries missing liftEvidence — ablation-warden gate violations. */
  readonly violations: readonly CapabilityEntry[];
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class CapabilityNotFoundError extends Data.TaggedError(
  "CapabilityNotFoundError",
)<{
  readonly name: string;
}> {}

// ─── Service Tag ───────────────────────────────────────────────────────────

export class CapabilityRegistry extends Context.Tag("CapabilityRegistry")<
  CapabilityRegistry,
  {
    /** Register or replace an entry by `name`. */
    readonly register: (entry: CapabilityEntry) => Effect.Effect<void>;
    /** Look up an entry by name. */
    readonly get: (
      name: string,
    ) => Effect.Effect<CapabilityEntry, CapabilityNotFoundError>;
    /** All registered entries (insertion order not guaranteed). */
    readonly list: () => Effect.Effect<readonly CapabilityEntry[]>;
    /** Subset of entries with `defaultOn === true`. */
    readonly defaultOnEntries: () => Effect.Effect<readonly CapabilityEntry[]>;
    /** Structured audit report. Stale threshold defaults to 90 days. */
    readonly audit: (
      options?: { readonly staleThresholdDays?: number; readonly now?: Date },
    ) => Effect.Effect<CapabilityAuditReport>;
  }
>() {}

// ─── Bootstrap entries ─────────────────────────────────────────────────────
//
// Initial 4 entries per spec §3.4. Each entry MUST have a wired consumer in
// the same commit or follow-up M2.* phase per master plan §9 Anti-Scaffold
// Principle — see audit() consumer in M2.2.

export const bootstrapEntries: readonly CapabilityEntry[] = [
  {
    name: "memory",
    description:
      "Cross-session episodic + semantic + procedural memory layers (4-tier).",
    defaultOn: true, // GH #122
    costSignature: {
      tokensPerRun: 0,
      latencyPerRunMs: 5,
      extraLLMCalls: 0,
    },
    liftEvidence: {
      measuredOn: ["local", "frontier"],
      averageDelta:
        "memory bootstrap < 10ms on first task; cross-session recall enables compounding intelligence",
      evidence: "wiki/Decisions/memory-default-on-decision-2026-05-22.md",
      measuredAt: "2026-05-22",
    },
    riskNotes:
      "SQLite file IO; bootstrap can fail with permission errors in restricted envs (mitigated by graceful fallback at memory-flush.ts).",
    rationale:
      "GH #122 graduated memory from opt-in to default-on after benchmark evidence showed compounding-intelligence gains across sessions.",
    ownerWarden: "memory",
    lastAblation: "2026-05-22",
  },
  {
    name: "reactive-intelligence",
    description:
      "Entropy-driven controller that issues mid-loop intervention decisions (strategy-switch, early-stop, etc.).",
    defaultOn: true,
    costSignature: {
      tokensPerRun: 0,
      latencyPerRunMs: 3,
      extraLLMCalls: 0,
      tierMultiplier: { local: 1.0, mid: 1.0, large: 1.0, frontier: 1.0 },
    },
    liftEvidence: {
      measuredOn: ["local", "frontier"],
      averageDelta:
        "+1 rescue on qwen3:14b failure corpus; 75% fire rate; tier-dependent quality",
      evidence:
        "wiki/Research/Harness-Reports/ri-ablation-analysis-2026-05-23.md",
      measuredAt: "2026-05-23",
    },
    riskNotes:
      "Tier-dependent fire rate. Can produce spurious controller-signal veto on graceful-failure tasks when paired with end_turn arbitration — see commit 98118fd1 / Lever 8 regression.",
    rationale:
      "Default-on since v0.10 based on +1 rescue on local-tier failure corpus. Lever 8 exposed paired-veto risk; mitigation shipped, ablation re-verification recommended.",
    ownerWarden: "reactive-intelligence",
    lastAblation: "2026-05-23",
  },
  {
    name: "verifier",
    description:
      "Terminal §9.0 output gate. Catches fabrication / harness parroting / incomplete output.",
    defaultOn: true,
    costSignature: {
      tokensPerRun: 50,
      latencyPerRunMs: 10,
      extraLLMCalls: 0,
    },
    liftEvidence: {
      measuredOn: ["local", "frontier"],
      averageDelta:
        "9 checks (agent-took-action / scaffold-leak / no-fabrication / etc.); catches FM-A1 / M2 leaks at terminal gate; numeric evidence-grounding is opt-in via .withGrounding()",
      evidence:
        "wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md",
      measuredAt: "2026-05-12",
    },
    riskNotes:
      "Pre-Sprint-3.3 retry loop was REWORKED out (commit 051c22be) after M3 ablation showed flat accuracy delta; heuristic gate retained. Bypass via `.withLeanHarness()` or `noopVerifier`.",
    rationale:
      "Heuristic guard (not LLM-as-judge). M3 ablation verdict: REWORK (retain gate, remove retry). Default-on preserves output integrity.",
    ownerWarden: "kernel",
    lastAblation: "2026-05-12",
  },
  {
    name: "strategy-switching",
    description:
      "Adaptive dispatch from initial strategy to fallback when failure pattern detected.",
    defaultOn: true, // commit 051c22be: `enableStrategySwitching !== false` default
    costSignature: {
      tokensPerRun: 0,
      latencyPerRunMs: 1,
      extraLLMCalls: 0,
    },
    // DELIBERATE — registry's first load-bearing signal per spec §3.4.
    // Ablation-warden gate (M2.3) will flag this on first CI run, forcing
    // either evidence-gathering OR default-revert to opt-in. Without the
    // registry this gap stays invisible.
    liftEvidence: null,
    riskNotes:
      "May spawn additional strategy run on switch. Disabled by `.withLeanHarness()`.",
    rationale:
      "Default-on since 2026-05-12 based on practitioner intuition + audit observation. No formal ablation — ablation-warden CI gate will flag this entry as violation per design spec §3.4.",
    ownerWarden: "runtime",
    lastAblation: null,
  },
];

// ─── Live Layer ────────────────────────────────────────────────────────────

const DEFAULT_STALE_THRESHOLD_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function buildAudit(
  entries: readonly CapabilityEntry[],
  options: { readonly staleThresholdDays?: number; readonly now?: Date } = {},
): CapabilityAuditReport {
  const staleThresholdDays =
    options.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const byWarden: Partial<Record<WardenOwner, CapabilityEntry[]>> = {};
  const stale: CapabilityEntry[] = [];
  const violations: CapabilityEntry[] = [];
  for (const entry of entries) {
    const bucket = (byWarden[entry.ownerWarden] ??= []);
    bucket.push(entry);
    if (entry.defaultOn && entry.liftEvidence === null) {
      violations.push(entry);
    }
    if (entry.lastAblation !== null) {
      const ageDays =
        (nowMs - new Date(entry.lastAblation).getTime()) / MS_PER_DAY;
      if (ageDays > staleThresholdDays) {
        stale.push(entry);
      }
    }
  }
  return {
    totalEntries: entries.length,
    defaultOnCount: entries.filter((e) => e.defaultOn).length,
    entries,
    byWarden: byWarden as Readonly<
      Partial<Record<WardenOwner, readonly CapabilityEntry[]>>
    >,
    staleEntries: stale,
    violations,
  };
}

export const CapabilityRegistryLive = Layer.effect(
  CapabilityRegistry,
  Effect.gen(function* () {
    const ref = yield* Ref.make<Map<string, CapabilityEntry>>(
      new Map(bootstrapEntries.map((e) => [e.name, e] as const)),
    );
    return {
      register: (entry) =>
        Ref.update(ref, (m) => {
          const next = new Map(m);
          next.set(entry.name, entry);
          return next;
        }),
      get: (name) =>
        Ref.get(ref).pipe(
          Effect.flatMap((m) => {
            const found = m.get(name);
            return found !== undefined
              ? Effect.succeed(found)
              : Effect.fail(new CapabilityNotFoundError({ name }));
          }),
        ),
      list: () =>
        Ref.get(ref).pipe(Effect.map((m) => Array.from(m.values()))),
      defaultOnEntries: () =>
        Ref.get(ref).pipe(
          Effect.map((m) => Array.from(m.values()).filter((e) => e.defaultOn)),
        ),
      audit: (options) =>
        Ref.get(ref).pipe(
          Effect.map((m) => buildAudit(Array.from(m.values()), options)),
        ),
    };
  }),
);
