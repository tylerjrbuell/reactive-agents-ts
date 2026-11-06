import { createHash } from "node:crypto";
import { renderValue, describeShape, type ResultFormat } from "@reactive-agents/tools";
import { recallHintIfCallable } from "./ref-grammar.js";

const WRITE_BY_REF_TOOL = "write_result_to_file";

/** True when the model's offered tool schemas include a tool named `name` (flat or OpenAI-function shape). */
function offersTool(schemas: readonly unknown[], name: string): boolean {
  return schemas.some((s) => {
    if (typeof s !== "object" || s === null) return false;
    const flat = (s as { name?: unknown }).name;
    const fn = (s as { function?: { name?: unknown } }).function?.name;
    return flat === name || fn === name;
  });
}

/** True when the model's offered tool schemas include the by-reference writer. */
export function offersWriteByRef(schemas: readonly unknown[]): boolean {
  return offersTool(schemas, WRITE_BY_REF_TOOL);
}

/**
 * True when `recall` is on the offered tool surface. The predicate the
 * assembly stages pass to `recallHintIfCallable` (truth item 3): no recall
 * pointer renders unless recall is offered.
 */
export function offersRecall(schemas: readonly unknown[]): boolean {
  return offersTool(schemas, "recall");
}

/** Preview/summary render options. */
export interface StoredRenderOptions {
  readonly writeByRef?: boolean;
  /**
   * Whether `recall` is on the callable surface (truth item 3). `false` drops
   * the "Re-read … with recall(…)" hint. Absent ⇒ legacy behavior (hint for
   * every recallable ref); the projector always passes it.
   */
  readonly recallCallable?: boolean;
}

export interface StoredResult {
  readonly ref: string;
  readonly tool: string;
  readonly value: unknown;
  /**
   * H2 (2026-07-08 sweep, audit 03-F2): true when `ref` is a live scratchpad
   * key (`putWithRef` path — e.g. `_tool_result_N`) that the `recall` meta-tool
   * can actually resolve. Minted content-hash refs (`put` path) live only in
   * this per-render store, so advertising `recall` for them would recreate the
   * blind-recall lure (found:false on invented keys).
   */
  readonly recallable: boolean;
}

export class ResultStore {
  private readonly map = new Map<string, StoredResult>();

  put(tool: string, value: unknown): string {
    const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
    const ref = `res_${hash}`;
    if (!this.map.has(ref)) this.map.set(ref, { ref, tool, value, recallable: false });
    return ref;
  }

  /**
   * Store a result under an existing key (e.g. `_tool_result_N`) rather than
   * minting a new content-hash ref. Preserves live tool-result identity so the
   * adapter and downstream reconciliation can resolve `storedKey` references
   * back to their original scratchpad keys. Idempotent: no-op if `ref` already
   * present.
   */
  putWithRef(ref: string, tool: string, value: unknown): string {
    if (!this.map.has(ref)) this.map.set(ref, { ref, tool, value, recallable: true });
    return ref;
  }

  get(ref: string): StoredResult | undefined {
    return this.map.get(ref);
  }

  has(ref: string): boolean {
    return this.map.has(ref);
  }

  summarize(ref: string, opts?: StoredRenderOptions): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    // H2: for scratchpad-backed refs, advertise the READ path in the exact
    // `recall("<key>"` vocabulary the recall-overflow gate matches
    // (think-guards.ts SURFACED_RECALL_KEY). Before this, previews only taught
    // write_result_to_file, the gate never saw its marker on the canonical
    // assembly path, and the stored-evidence read path was structurally dead.
    const pointer = s.recallable ? recallHintIfCallable(ref, "full", opts?.recallCallable ?? true) : undefined;
    const readHint = pointer !== undefined ? ` Re-read the full data with ${pointer}.` : "";
    const actHint = opts?.writeByRef
      ? ` act on it by reference (e.g. ${WRITE_BY_REF_TOOL}(result_ref="${ref}", path)).`
      : "";
    return (
      `${s.tool} result stored as result_ref="${ref}" (${describeShape(s.value)}). ` +
      `Full data held system-side;${actHint} Do not retype it.${readHint}`
    );
  }

  materialize(ref: string, format: ResultFormat = "bullets"): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return renderValue(s.value, format);
  }

  /**
   * Content-aware bounded preview for an OVERFLOWING result (#1, 2026-05-31).
   *
   * Replaces the bare `summarize()` (shape + ref only) that caused the Phase-4
   * regression: stripping all content meant the model couldn't summarize what it
   * couldn't see, so it looped or dropped sections. Verified bar — legacy inlined
   * ~5k of a 57k spread-section doc and SILENTLY covered only ~19/22 sections.
   *
   * preview() does better by being STRUCTURE-AWARE:
   *  - markdown-structured content (≥2 `#..######` headings): surface the heading
   *    SKELETON (each heading + its lead line, degrading to headings-only, then a
   *    hard slice) so EVERY section stays visible within budget → the model can
   *    cover all sections faithfully, not just the front-loaded head.
   *  - otherwise: bounded HEAD truncation.
   * Both append an honest truncation marker + the ref, so the result is faithful
   * about what was dropped AND recoverable/actionable by reference. Content that
   * fits the budget is returned in full with no marker noise.
   */
  preview(ref: string, budgetChars: number, opts?: StoredRenderOptions): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    // compact: this is the model's REASONING view — drop navigation/metadata
    // noise (author.*_url ×15/record on GitHub shapes) so the budget is spent on
    // selection-criteria fields, not URLs. The full untouched data stays
    // recoverable via recall, or `write_result_to_file` when offered, and
    // `materialize()` (the actual file deliverable) still renders byte-complete.
    const fullText = renderValue(s.value, "bullets", { compact: true });
    if (fullText.length <= budgetChars) return fullText;

    // H2: recall read-hint in the gate-matched vocabulary (see summarize()).
    const pointer = s.recallable ? recallHintIfCallable(ref, "segment", opts?.recallCallable ?? true) : undefined;
    const readHint = pointer !== undefined ? ` Re-read any section with ${pointer}.` : "";
    const actHint = opts?.writeByRef
      ? `act on the complete data by reference (e.g. ${WRITE_BY_REF_TOOL}(result_ref="${ref}", path)). `
      : "";
    const footer =
      `\n\n[content truncated — ${fullText.length} chars total; full data held ` +
      `system-side as result_ref="${ref}". Summarize from the sections shown above; ` +
      actHint +
      `Do not retype it.${readHint}]`;
    const body = Math.max(0, budgetChars - footer.length);

    const lines = fullText.split("\n");
    const headingIdx = lines.reduce<number[]>((acc, l, i) => {
      if (/^#{1,6}\s/.test(l)) acc.push(i);
      return acc;
    }, []);

    if (headingIdx.length >= 2) {
      // Prefer heading + lead line; degrade to headings-only; then hard slice.
      const withLead = headingIdx
        .map((i) => {
          const lead = lines.slice(i + 1).find((l) => l.trim().length > 0);
          return lead ? `${lines[i]}\n${lead}` : lines[i]!;
        })
        .join("\n\n");
      if (withLead.length <= body) return withLead + footer;

      const headingsOnly = headingIdx.map((i) => lines[i]!).join("\n");
      if (headingsOnly.length <= body) return headingsOnly + footer;

      return headingsOnly.slice(0, body) + " …" + footer;
    }

    // No structure — bounded head.
    return fullText.slice(0, body) + " …" + footer;
  }
}
