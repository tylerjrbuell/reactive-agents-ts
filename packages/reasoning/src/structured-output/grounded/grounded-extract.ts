/**
 * grounded-extract — P2 orchestrator for typed structured output with:
 *   - provenance annotation (per-field evidence from step corpus)
 *   - confidence scoring (grounded ~0.9, ungrounded ~0.4)
 *   - abstention (opt-in; only omits OPTIONAL fields below threshold)
 *   - surgical repair (≤1 extra pass for missing required fields)
 *
 * Error channel is `never` — all extraction failures degrade internally
 * and surface as `{ objectError }`. Callers (Task 2.5) translate
 * `objectError` to a thrown error when `onParseFail === "throw"`.
 *
 * `onParseFail` is kept on `GroundedInput` for API symmetry with the
 * pipeline layer; it is advisory here and handled by the caller.
 *
 * ## Extraction strategy
 *
 * Phase A — initial extraction uses `Schema.partial(effectSchema)` so
 * the pipeline succeeds even when the LLM omits some fields. This gives
 * us a real partial object rather than an outright failure.
 *
 * Phase B — detect which required fields are still absent in the partial
 * result. If any, run a ≤1-pass surgical repair focused on those fields.
 *
 * Phase C — merge repair results into the partial object, validate the
 * final merged object against the full contract, and either return or
 * degrade with an `objectError`.
 */
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { extractStructuredOutput } from "../pipeline.js";
import type { SchemaContract } from "../schema-contract.js";
import { toSchemaContract } from "../schema-contract.js";
import {
  fieldRequirementsFromSchema,
  missingRequiredFields,
} from "./field-requirements.js";
import { groundFields } from "./field-provenance.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface GroundedInput<A> {
  /** Validated contract describing the output shape. */
  readonly contract: SchemaContract<A>;
  /** The final answer text produced by the agent (used as extraction prompt). */
  readonly finalAnswer: string;
  /** Concatenated step-observations corpus for grounding lookups. */
  readonly evidenceCorpus: string;
  /**
   * Controls how parse failures propagate.
   * Advisory here — `groundedExtract` always degrades (never channel).
   * Task 2.5 runtime caller translates `objectError` to a thrown error
   * when this is `"throw"`.
   */
  readonly onParseFail: "degrade" | "throw";
  /**
   * Opt-in abstention: fields with confidence < `abstainBelow` are omitted
   * from `object` and recorded in `abstained`.
   *
   * REQUIRED fields are NEVER abstained — they stay in `object` even when
   * confidence is below the threshold. The caller can inspect `confidence`
   * to decide whether to accept or escalate.
   *
   * `undefined` (default) → no abstention.
   */
  readonly abstainBelow?: number;
  /**
   * Internal escape hatch for tests: force the prompt-mode pipeline path
   * on the INITIAL extraction (skips completeStructured/native mode).
   * Not part of the public API.
   * @internal
   */
  readonly _forcePromptMode?: boolean;
  /**
   * Internal escape hatch for tests: override maxRetries on the INITIAL
   * extraction pipeline (default: 2). Not part of the public API.
   * @internal
   */
  readonly _maxRetries?: number;
}

export interface GroundedOutput<A> {
  /** The extracted and validated object. Undefined when extraction failed. */
  readonly object?: A;
  /** Human-readable error when object is absent. */
  readonly objectError?: string;
  /** Per-field provenance records (only for grounded fields). */
  readonly provenance?: Record<string, { source: string; evidence: string }>;
  /** Per-field confidence scores (0–1). */
  readonly confidence?: Record<string, number>;
  /**
   * Fields that were omitted due to low confidence (opt-in abstention).
   * Maps field path → human-readable reason string.
   * Only populated when `abstainBelow` is set.
   */
  readonly abstained?: Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attempt to derive a sub-schema containing only `fields` from `effectSchema`.
 *
 * Works when `effectSchema` is a `Schema.Struct` (has `.pick()` method).
 * Falls back to the full `effectSchema` (as partial) for Standard Schema
 * wrappers (Schema.declare) — the repair LLM call will return a superset
 * but we only merge the missing keys into the result.
 */
function pickSubSchema<A>(
  effectSchema: Schema.Schema<A>,
  fields: ReadonlyArray<string>,
): Schema.Schema<unknown> {
  // Schema.Struct exposes .pick() on its class instance.
  // Detect by duck-typing: presence of `fields` map (TypeLiteral AST).
  const s = effectSchema as unknown as {
    pick?: (...keys: string[]) => Schema.Schema<unknown>;
    fields?: Record<string, unknown>;
  };

  if (typeof s.pick === "function" && s.fields !== undefined) {
    const available = Object.keys(s.fields).filter((k) =>
      (fields as string[]).includes(k),
    );
    if (available.length > 0) {
      return s.pick(...available);
    }
  }

  // Fallback: use the full schema wrapped as partial so the repair call can
  // return a subset. We only merge the specific missing keys afterward.
  return Schema.partial(effectSchema);
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export const groundedExtract = <A>(
  input: GroundedInput<A>,
): Effect.Effect<GroundedOutput<A>, never, LLMService> =>
  Effect.gen(function* () {
    const reqs = fieldRequirementsFromSchema(input.contract.effectSchema);

    // ── Phase A: Initial extraction via partial schema ────────────────────
    // Using Schema.partial so the pipeline accepts a partial object — avoids
    // outright failure when the LLM omits some fields on the first pass.
    // For non-struct schemas (Schema.declare wrappers, unions, etc.) where
    // Schema.partial is the identity-level wrapper, we fall back to the full
    // contract to keep native-mode working correctly.
    const partialSchema = (() => {
      try {
        const s = Schema.partial(input.contract.effectSchema);
        return toSchemaContract(s as Schema.Schema<Partial<A>>);
      } catch {
        // Not a transformable schema — use full contract
        return input.contract as SchemaContract<Partial<A>>;
      }
    })();

    const phase1Result = yield* extractStructuredOutput<Partial<A>>({
      contract: partialSchema,
      prompt: `Extract the schema fields from:\n${input.finalAnswer}`,
      ...(input._forcePromptMode ? { forcePromptMode: true } : {}),
      ...(input._maxRetries !== undefined ? { maxRetries: input._maxRetries } : {}),
    }).pipe(
      Effect.map((r) => ({ ok: true as const, data: r.data as Record<string, unknown> })),
      Effect.catchAll((err) =>
        Effect.succeed({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );

    if (!phase1Result.ok) {
      return { objectError: `grounded extraction failed: ${phase1Result.error}` };
    }

    // ── Phase B: Abstention and provenance ────────────────────────────────
    const obj: Record<string, unknown> = { ...phase1Result.data };
    const grounded = groundFields(obj, input.evidenceCorpus);
    const abstained: Record<string, string> = {};

    // Opt-in abstention — OPTIONAL fields only (required fields always stay).
    if (input.abstainBelow !== undefined) {
      for (const [k, conf] of Object.entries(grounded.confidence)) {
        if (conf < input.abstainBelow) {
          const isRequired = reqs.find((r) => r.path === k)?.required ?? false;
          if (!isRequired) {
            delete obj[k];
            abstained[k] = `confidence ${conf.toFixed(2)} < ${input.abstainBelow}`;
          }
        }
      }
    }

    // ── Phase C: Surgical repair (≤1 pass) for missing required fields ────
    const missing = [...missingRequiredFields(reqs, obj)];

    if (missing.length > 0) {
      const repairSubSchema = pickSubSchema(input.contract.effectSchema, missing);
      const repairContract = toSchemaContract(
        repairSubSchema as Schema.Schema<Partial<A>>,
      );

      const repairResult = yield* extractStructuredOutput<Partial<A>>({
        contract: repairContract,
        prompt: `The following required fields are missing from the previous extraction: ${missing.join(", ")}.\nExtract ONLY these fields from:\n${input.finalAnswer}`,
        forcePromptMode: true, // always prompt-mode for repair to advance scenario cursor
        maxRetries: 0,
      }).pipe(
        Effect.map((r) => ({
          ok: true as const,
          data: r.data as Record<string, unknown>,
        })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, data: {} as Record<string, unknown> }),
        ),
      );

      if (repairResult.ok) {
        // Merge only the missing keys — never overwrite values from phase 1.
        for (const key of missing) {
          const v = repairResult.data[key];
          if (v !== undefined && v !== null) {
            obj[key] = v;
          }
        }
      }

      // Recompute after repair.
      const stillMissing = [...missingRequiredFields(reqs, obj)];
      if (stillMissing.length > 0) {
        return {
          objectError: `missing required fields after repair: ${stillMissing.join(", ")}`,
          provenance: grounded.provenance,
          confidence: grounded.confidence,
        };
      }
    }

    // ── Phase D: Final validation against the full contract ───────────────
    const validation = input.contract.validate(obj);
    if (!validation.ok) {
      return {
        objectError: `validation failed: ${validation.issues.map((i) => i.message).join("; ")}`,
        provenance: grounded.provenance,
        confidence: grounded.confidence,
      };
    }

    return {
      object: validation.value,
      provenance: grounded.provenance,
      confidence: grounded.confidence,
      ...(Object.keys(abstained).length > 0 ? { abstained } : {}),
    };
  });
