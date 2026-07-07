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
 *   3. ≥1 ok tool call AND `goalAchieved !== false` → `"tool-grounded"`
 *      (confidence 0.8; 0.9 when `verifierVerdict === "pass"`).
 *   4. ≥1 tool call but none ok → `"partially-grounded"` (confidence 0.6).
 *   5. zero tool calls → `"ungrounded"` (confidence 0.8) — the model answered
 *      from itself; fine for pure-knowledge tasks, and now VISIBLE.
 *
 * `toolsUsed` dedupes tool names, preserving first-seen order, and only
 * counts names from calls that succeeded (`ok: true`).
 */
export function computeTrustReceipt(input: {
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean }[];
  readonly terminatedBy?: string;
  readonly verifierVerdict?: string;
  readonly goalAchieved?: boolean | null;
  readonly abstained: boolean;
  readonly success: boolean;
  readonly modelId: string;
  readonly configHash?: string;
  readonly forkedFrom?: string;
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

  const verdict = ((): TrustReceipt["verdict"] => {
    if (input.abstained) return "abstained";
    if (!input.success) return "failed";
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
    modelId: input.modelId,
    ...(input.configHash !== undefined ? { configHash: input.configHash } : {}),
    computedAt: input.now,
  };
}
