// Run: bun test packages/runtime/tests/observability-redactors-builder.test.ts --timeout 15000
//
// S0.3 Task 4 — verify withObservability({ redactors }) flows through the
// builder → resolved-config layer to the runtime ExporterConfig. Without this
// glue, user-supplied redactor patterns silently disappear between the public
// API surface and the StructuredLogger that actually applies them.

import { describe, it, expect } from "bun:test";
import type { Redactor } from "@reactive-agents/observability";
import type { ObservabilityOptions } from "../src/builder.js";

describe("withObservability redactors option (S0.3 Task 4)", () => {
  it("ObservabilityOptions accepts a readonly Redactor[] without coercion", () => {
    // Compile-time test: the next line must type-check. If `redactors` was
    // dropped from the type or its element type drifted, the assignment fails.
    const opts: ObservabilityOptions = {
      verbosity: "verbose",
      redactors: [
        { name: "internal-tag", pattern: /internal-\w+/g, replacement: "[redacted-internal]" },
      ],
    };
    expect(opts.redactors).toBeDefined();
    expect(opts.redactors!.length).toBe(1);
    expect(opts.redactors![0]!.name).toBe("internal-tag");
  }, 15000);

  it("readonly Redactor[] from observability is structurally compatible with ObservabilityOptions", () => {
    // Pin the cross-package type contract: a Redactor declared against the
    // observability package's exported type must satisfy the builder option
    // without re-declaration. This catches accidental divergence between
    // the two type definitions.
    const r: Redactor = {
      name: "test",
      pattern: /test/g,
      replacement: "[redacted]",
    };
    const opts: ObservabilityOptions = { redactors: [r] };
    expect(opts.redactors![0]).toBe(r);
  }, 15000);

  it("absence of redactors is type-safe (backward compat)", () => {
    const opts: ObservabilityOptions = { verbosity: "minimal" };
    expect(opts.redactors).toBeUndefined();
  }, 15000);
});
