import { describe, it, expect } from "bun:test";
import {
  deriveBuilderMethods,
  BUILDER_METHOD_ANNOTATIONS,
} from "../src/capability/builder-methods.js";
import { ReactiveAgentBuilder } from "../src/builder.js";

describe("deriveBuilderMethods", () => {
  it("covers every public with* method on the builder prototype (auto-synced, no drift)", () => {
    const proto = ReactiveAgentBuilder.prototype as unknown as Record<string, unknown>;
    const liveWith = Object.getOwnPropertyNames(proto)
      .filter((n) => /^with[A-Z]/.test(n) && typeof proto[n] === "function")
      .sort();
    const derived = deriveBuilderMethods().map((m) => m.name);
    expect(derived).toEqual(liveWith);
  });

  it("annotates withModelRouting as an overlay method", () => {
    const m = deriveBuilderMethods().find((x) => x.name === "withModelRouting");
    expect(m?.kind).toBe("overlay");
    expect(m?.inferred).toBe(false);
  });

  it("marks unannotated methods as inferred overlays with a generated description", () => {
    const inferred = deriveBuilderMethods().filter((m) => m.inferred);
    for (const m of inferred) {
      expect(m.kind).toBe("overlay");
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("every annotation key is a real builder method (no stale annotations)", () => {
    const live = new Set(deriveBuilderMethods().map((m) => m.name));
    const stale = Object.keys(BUILDER_METHOD_ANNOTATIONS).filter((k) => !live.has(k));
    expect(stale, `stale annotations: ${stale.join(", ")}`).toEqual([]);
  });
});
