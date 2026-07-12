/**
 * TrustReceipt v1 — graded evidence about HOW an answer was produced.
 * NOT a truth certificate: `verdict` grades the run's evidence trail, not
 * the factual correctness of the output (spec 08 §4.3 honest-claims note).
 *
 * Computed from IN-MEMORY run data at result assembly (tool-call outcomes,
 * termination reason, abstention, verifier verdict) — NOT from the trace,
 * so it is present even when tracing is disabled. `computeTrustReceipt` is a
 * pure function: the caller passes `now` (no `Date.now()` inside), so unit
 * tests are deterministic.
 *
 * Mirrored by `TrustReceiptWire` in `@reactive-agents/ui-core`
 * (`packages/ui-core/src/protocol/events.ts`) for the wire/endpoint path —
 * adding a REQUIRED field here requires updating that mirror too.
 */
/**
 * One declared deliverable's completion status, named on the receipt (B2 /
 * meta-loop 4a). Computed from the RunContract's deliverable specs × the
 * step-based artifact scan: `produced: false` names a MISSING deliverable so a
 * partial multi-file run reports exactly which outputs never landed (rw-8
 * partial-truth: 1 of 3 files → 2 entries with `produced: false`).
 */
export interface DeliverableReceipt {
  /** Human-readable deliverable spec (e.g. "produce the file ./report.md"). */
  readonly spec: string;
  /** True iff the ledger/steps scan verified this deliverable was produced. */
  readonly produced: boolean;
}

/**
 * One harness intervention on the run (north-star spec 2026-07-11 §5b). The
 * receipt's DEBUGGING spine: "what did the harness DO to my run, and under which
 * authority class?" Emitted at every control action — gate redirects, recovery
 * nudges, guard fires, strategy switches, the piece-1 lexical-proposal
 * rejections — so an intervention is visible on the result instead of requiring
 * raw jsonl archaeology (the `c4e964e8` postmortem cost).
 */
export interface InterventionReceipt {
  /** Actor that produced the intervention (evaluator / gate / guard name). */
  readonly actor: string;
  /** Authority class of the actor (spec §3): deterministic > model-grade > lexical. */
  readonly authorityClass: "deterministic" | "model-grade" | "lexical";
  /** Short evidence string naming the concrete signal that drove it. */
  readonly evidence: string;
  /** What the intervention changed about the run. */
  readonly whatChanged: string;
  /** Run iteration at which it fired. */
  readonly iter: number;
}

export interface TrustReceipt {
  /** Evidence grade for the final answer. */
  readonly verdict: "tool-grounded" | "partially-grounded" | "ungrounded" | "abstained" | "failed";
  /** How the verdict was computed. v1 ships heuristic only. */
  readonly method: "heuristic";
  /** 0..1 — confidence in the verdict itself (not in the answer). */
  readonly confidence: number;
  /** Distinct tool names with ≥1 successful substantive call — "substantive" excludes kernel META/termination/memory-retrieval tools (final-answer, task-complete, recall, checkpoint, abstain, etc.; see `isSubstantiveReceiptTool` in runtime/builder/helpers.ts). */
  readonly toolsUsed: readonly string[];
  /** Successful / total tool calls. */
  readonly toolCallStats: { readonly ok: number; readonly failed: number };
  /**
   * Declared deliverables and whether each was produced (B2 / meta-loop 4a).
   * Present only when the RunContract declared at least one concrete
   * deliverable — absent for pure Q&A runs, so receipts for tasks with no
   * deliverable spec stay byte-identical to v1. A partial run (some
   * `produced: false`) names the missing outputs here.
   */
  readonly deliverables?: readonly DeliverableReceipt[];
  /**
   * Harness interventions on this run (spec §5b) — gate redirects, nudges,
   * guard fires, strategy switches, piece-1 proposal rejections. Present only
   * when the run had at least one intervention, so receipts for clean runs stay
   * byte-identical to v1. Ordered by iteration (emission order).
   */
  readonly interventions?: readonly InterventionReceipt[];
  /** Terminal reason (mirrors AgentResult.terminatedBy). */
  readonly terminatedBy?: string;
  /** Verifier verdict when the terminal verifier ran. */
  readonly verifierVerdict?: string;
  /** Fork lineage when this run was forked (Task 6). */
  readonly forkedFrom?: string;
  /** Model + config identity for provenance. */
  readonly modelId: string;
  readonly configHash?: string;
  readonly computedAt: number;
  /**
   * Optional Ed25519 provenance signature (Arc 1 Task 9). Absent by default
   * (zero overhead) — set only when a signing key is configured via
   * `.withReceiptSigning()` or the `RA_RECEIPT_KEY` env var.
   *
   * HONEST-CLAIMS SCOPE: this signature certifies "this receipt, this run,
   * untampered" — that the receipt bytes were produced by the holder of the
   * embedded public key and have not been altered since. It NEVER certifies
   * the correctness of the agent's answer, nor does it change what
   * `verdict` means (still an evidence-trail grade, not a truth claim).
   */
  readonly signature?: {
    readonly alg: "ed25519";
    /** Embedded public key as a JSON-stringified JWK, so verification is self-contained. */
    readonly publicKey: string;
    /** Base64url signature over the stable-stringified receipt (this field excluded). */
    readonly sig: string;
  };
}

/**
 * Compute a {@link TrustReceipt} from in-memory run data.
 *
 * Deterministic verdict rules, evaluated in order (first match wins):
 *   1. `abstained` → `"abstained"` (confidence 0.95) — wins over everything,
 *      including any tool calls made before the agent declined.
 *   2. `!success` → `"failed"` (confidence 0.95).
 *   3. any DECLARED deliverable with `produced: false` → `"partially-grounded"`
 *      (confidence 0.6) — a missing promised artifact is an objective hole in
 *      the evidence trail; an explicit `goalAchieved: true` does not outrank it.
 *   3b. `verifierVerdict` of `reject`/`escalate` → `"partially-grounded"` — the
 *      terminal verifier judged the shipped answer invalid (scaffold leak,
 *      harness parrot, mid-thought continuation, fabricated measurement).
 *   4. a tool call failed against a target it never afterwards succeeded on,
 *      AND the run never claimed a final answer (`goalAchieved !== true`)
 *      → `"partially-grounded"` (confidence 0.6).
 *   5. ≥1 ok tool call AND `goalAchieved !== false` → `"tool-grounded"`
 *      (confidence 0.8; 0.9 when `verifierVerdict === "pass"`).
 *   6. ≥1 tool call but none ok → `"partially-grounded"` (confidence 0.6).
 *   7. zero tool calls → `"ungrounded"` (confidence 0.8) — the model answered
 *      from itself; fine for pure-knowledge tasks, and now VISIBLE.
 *
 * Rule 3 exists because rule 4 asked only "did ANY tool succeed", which is a
 * non sequitur: a successful read of `orders.json` says nothing about the
 * exchange rate the answer also needed. Measured 2026-07-09 — agents whose
 * `file-read` of `rates.json` returned ENOENT invented a rate (claude-haiku-4-5
 * took 0.873956 off a web search; qwen3:14b assumed 1:1), wrote the wrong
 * number to disk, and this function certified BOTH runs `tool-grounded` at
 * confidence 0.8, because a `file-read` of a DIFFERENT file had succeeded.
 * `failed` was computed one line above the verdict and read only into a display
 * field — computed-never-read, inside the artifact whose whole job is honesty.
 *
 * Why BOTH conjuncts, and not the failed call alone. A failed call cannot by
 * itself separate fabrication from recovery: once `list-directory` shipped,
 * haiku hit the same ENOENT, listed the directory, found the rate in
 * `config.json`, and answered correctly — an identical failed-call signature.
 * What differed was the ending. Both fabricating runs stopped at `end_turn`
 * (`goalAchieved: null`, documented as "treat as maybe"); the recovering run
 * invoked `final-answer` (`true`). Certifying a "maybe" that still carries an
 * open tool failure was the defect. A first draft keyed on `requiredTools`
 * instead, and would have downgraded that correct recovery — a live run caught
 * it before it shipped.
 *
 * Conservative by construction, and NOT ablated: the rule can only move a
 * verdict DOWN. A run that resolves its failures, or that explicitly finishes,
 * is unaffected.
 *
 * `toolsUsed` dedupes tool names, preserving first-seen order, and only
 * counts names from calls that succeeded (`ok: true`).
 */
/**
 * Tool calls that failed and were never re-attempted successfully against the
 * same target — an open hole in the run's evidence trail.
 *
 * A call with no `target` can never be resolved by a later success, since
 * nothing establishes the two calls were about the same thing. That is the
 * conservative direction: an unfingerprinted failure stays counted.
 */
function countUnresolvedFailures(
  toolCalls: readonly { readonly name: string; readonly ok: boolean; readonly target?: string }[],
): number {
  const succeededTargets = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.ok && tc.target !== undefined) succeededTargets.add(`${tc.name} ${tc.target}`);
  }

  let unresolved = 0;
  for (const tc of toolCalls) {
    if (tc.ok) continue;
    if (tc.target !== undefined && succeededTargets.has(`${tc.name} ${tc.target}`)) continue;
    unresolved += 1;
  }
  return unresolved;
}

export function computeTrustReceipt(input: {
  readonly toolCalls: readonly {
    readonly name: string;
    readonly ok: boolean;
    /**
     * Stable fingerprint of the call's arguments — what the call was ABOUT.
     * Two `file-read`s are the same evidence attempt only when they name the
     * same file. Absent → the call can never be resolved by a later success,
     * which is the conservative direction.
     */
    readonly target?: string;
  }[];
  readonly terminatedBy?: string;
  readonly verifierVerdict?: string;
  readonly goalAchieved?: boolean | null;
  readonly abstained: boolean;
  readonly success: boolean;
  readonly modelId: string;
  readonly configHash?: string;
  readonly forkedFrom?: string;
  /**
   * Declared deliverables × produced-status, computed by the caller from the
   * RunContract and the run's step-based artifact scan. Passed through verbatim
   * onto the receipt. Omit (or pass empty) for runs with no declared
   * deliverable — the field then stays absent and the receipt is byte-identical
   * to v1.
   */
  readonly deliverables?: readonly DeliverableReceipt[];
  /**
   * Harness interventions on the run (spec §5b), derived by the caller from the
   * reasoning steps via {@link deriveInterventionsFromSteps}. Omit (or pass
   * empty) for runs with no intervention — the field then stays absent and the
   * receipt is byte-identical to v1.
   */
  readonly interventions?: readonly InterventionReceipt[];
  readonly now: number;
}): TrustReceipt {
  const ok = input.toolCalls.filter((tc) => tc.ok).length;
  const failed = input.toolCalls.length - ok;

  const toolsUsed: string[] = [];
  const seen = new Set<string>();
  for (const tc of input.toolCalls) {
    if (tc.ok && !seen.has(tc.name)) {
      seen.add(tc.name);
      toolsUsed.push(tc.name);
    }
  }

  const unresolvedFailures = countUnresolvedFailures(input.toolCalls);

  const verdict = ((): TrustReceipt["verdict"] => {
    if (input.abstained) return "abstained";
    if (!input.success) return "failed";
    // A DECLARED deliverable the ledger scan could not verify is an objective
    // hole in the evidence trail — the run cannot be "tool-grounded" while a
    // promised artifact is missing, no matter what the model claimed
    // (goalAchieved: true does not outrank a missing file). Deterministic
    // authority: the flag comes from the RunContract × step-ledger scan
    // (computeDeliverableReport), not from any model judgment. Measured
    // 2026-07-11 (gemma4 reflexion 01KX99T53WSFS1TW08KAHR89SR): ./show.md
    // reported produced:false while this function certified `tool-grounded`
    // @0.8 beside success:true — deliverables was attached to the receipt one
    // field away from a verdict that never read it.
    if (input.deliverables?.some((d) => !d.produced)) return "partially-grounded";
    // The terminal verifier REJECTED the shipped answer (scaffold leak,
    // harness parrot, mid-thought continuation, fabricated measurement, a
    // failed grounding check the user opted into). Since 2026-07-12 the
    // verifier runs at the result boundary for EVERY path, so this field has
    // a writer outside the react kernel. A rejected answer is never
    // "tool-grounded" no matter how many tools ran. Cap only — the verdict
    // moves DOWN, and `pass` still raises confidence below.
    if (input.verifierVerdict === "reject" || input.verifierVerdict === "escalate") {
      return "partially-grounded";
    }
    // An open tool failure AND no claim of completion. Either alone is
    // ordinary; together they are the fabrication signature (see JSDoc).
    if (unresolvedFailures > 0 && input.goalAchieved !== true) return "partially-grounded";
    if (ok > 0 && input.goalAchieved !== false) return "tool-grounded";
    if (input.toolCalls.length > 0) return "partially-grounded";
    return "ungrounded";
  })();

  const confidence = ((): number => {
    switch (verdict) {
      case "abstained":
        return 0.95;
      case "failed":
        return 0.95;
      case "tool-grounded":
        return input.verifierVerdict === "pass" ? 0.9 : 0.8;
      case "partially-grounded":
        return 0.6;
      case "ungrounded":
        return 0.8;
    }
  })();

  return {
    verdict,
    method: "heuristic",
    confidence,
    toolsUsed,
    toolCallStats: { ok, failed },
    ...(input.terminatedBy !== undefined ? { terminatedBy: input.terminatedBy } : {}),
    ...(input.verifierVerdict !== undefined ? { verifierVerdict: input.verifierVerdict } : {}),
    ...(input.forkedFrom !== undefined ? { forkedFrom: input.forkedFrom } : {}),
    ...(input.deliverables !== undefined && input.deliverables.length > 0
      ? { deliverables: input.deliverables }
      : {}),
    ...(input.interventions !== undefined && input.interventions.length > 0
      ? { interventions: input.interventions }
      : {}),
    modelId: input.modelId,
    ...(input.configHash !== undefined ? { configHash: input.configHash } : {}),
    computedAt: input.now,
  };
}

// ─── Interventions (spec §5b) ──────────────────────────────────────────────────

/** The minimal step shape {@link deriveInterventionsFromSteps} reads. */
export interface InterventionStepLike {
  readonly metadata?: {
    readonly intervention?: {
      readonly actor: string;
      readonly authorityClass: "deterministic" | "model-grade" | "lexical";
      readonly evidence: string;
      readonly whatChanged: string;
      readonly iter: number;
    };
  };
}

/**
 * Collect the harness interventions recorded on a run's reasoning steps into the
 * receipt shape (spec §5b). Pure — the kernel records each intervention on the
 * step that carried it (`metadata.intervention`); this scans those out in order.
 * Callers (runtime receipt assembly) pass the result to
 * {@link computeTrustReceipt} as `interventions`.
 */
export function deriveInterventionsFromSteps(
  steps: readonly InterventionStepLike[] | undefined,
): readonly InterventionReceipt[] {
  if (!steps || steps.length === 0) return [];
  const out: InterventionReceipt[] = [];
  for (const s of steps) {
    const i = s.metadata?.intervention;
    if (i === undefined) continue;
    out.push({
      actor: i.actor,
      authorityClass: i.authorityClass,
      evidence: i.evidence,
      whatChanged: i.whatChanged,
      iter: i.iter,
    });
  }
  return out;
}

/**
 * Render a receipt's interventions as a human-readable block (spec §5b — the
 * debugging surface). Returns the count header plus one line per entry naming
 * the actor, its authority class, and what it changed. Empty string when the
 * run had no interventions, so callers can concatenate unconditionally.
 */
export function formatInterventions(receipt: TrustReceipt): string {
  const entries = receipt.interventions ?? [];
  if (entries.length === 0) return "";
  const lines = entries.map(
    (i) => `  - [${i.authorityClass}] ${i.actor} @iter ${i.iter}: ${i.whatChanged} (${i.evidence})`,
  );
  return `Harness interventions (${entries.length}):\n${lines.join("\n")}`;
}
