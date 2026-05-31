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
}
