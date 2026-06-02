import { createHash } from "node:crypto";
import { renderValue, describeShape, type ResultFormat } from "@reactive-agents/tools";

export interface StoredResult {
  readonly ref: string;
  readonly tool: string;
  readonly value: unknown;
}

export class ResultStore {
  private readonly map = new Map<string, StoredResult>();

  put(tool: string, value: unknown): string {
    const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
    const ref = `res_${hash}`;
    if (!this.map.has(ref)) this.map.set(ref, { ref, tool, value });
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
    if (!this.map.has(ref)) this.map.set(ref, { ref, tool, value });
    return ref;
  }

  get(ref: string): StoredResult | undefined {
    return this.map.get(ref);
  }

  has(ref: string): boolean {
    return this.map.has(ref);
  }

  summarize(ref: string): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return (
      `${s.tool} result stored as result_ref="${ref}" (${describeShape(s.value)}). ` +
      `Full data held system-side; act on it by reference (e.g. write_result_to_file(result_ref="${ref}", path)). Do not retype it.`
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
  preview(ref: string, budgetChars: number): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    const fullText = renderValue(s.value, "bullets");
    if (fullText.length <= budgetChars) return fullText;

    const footer =
      `\n\n[content truncated — ${fullText.length} chars total; full data held ` +
      `system-side as result_ref="${ref}". Summarize from the sections shown above; ` +
      `act on the complete data by reference (e.g. write_result_to_file(result_ref="${ref}", path)). ` +
      `Do not retype it.]`;
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
