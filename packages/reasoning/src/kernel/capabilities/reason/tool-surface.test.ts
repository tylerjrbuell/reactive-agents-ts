import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { resolveToolSurface, type ToolSurfaceInputs } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { META_TOOLS } from "../../state/kernel-constants.js";

// Overhaul Phase 2 (2026-07-07). Property tests encode the resolver's
// invariants — the exit criterion is that deleting any ONE input (e.g.
// requiredTools) can never silently change the visibility of an
// explicitly-requested tool, because every floor is enforced here by
// construction.

const schema = (name: string): ToolSchema =>
  ({ name, description: `${name} tool`, parameters: [] }) as ToolSchema;

const FINAL_ANSWER = schema("final-answer");

const DOMAIN_POOL = [
  "web-search", "file-read", "file-write", "http-get", "code-execute",
  "rag-search", "shell-execute", "db-query", "send-email", "translate",
];
const META_POOL = [...META_TOOLS].slice(0, 4);

const arbInputs: fc.Arbitrary<ToolSurfaceInputs> = fc
  .record({
    domain: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { minLength: 0, maxLength: 10 }),
    meta: fc.uniqueArray(fc.constantFrom(...META_POOL), { minLength: 0, maxLength: 4 }),
    required: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 3 }),
    relevant: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 4 }),
    allowed: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 3 }),
    used: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 3 }),
    discovered: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 3 }),
    gateBlocked: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 2 }),
    missingRequired: fc.uniqueArray(fc.constantFrom(...DOMAIN_POOL), { maxLength: 2 }),
    lazyMode: fc.boolean(),
    pressureCritical: fc.boolean(),
    pruneMinTools: fc.constantFrom(0, 2, 15),
  })
  .map((r) => ({
    augmented: [...r.domain.map(schema), ...r.meta.map(schema), FINAL_ANSWER],
    finalAnswerSchema: FINAL_ANSWER,
    lazyMode: r.lazyMode,
    pressureCritical: r.pressureCritical,
    hasClassification: r.required.length > 0 || r.relevant.length > 0,
    requiredTools: r.required,
    relevantTools: r.relevant,
    allowedTools: r.allowed,
    toolsUsed: r.used,
    discovered: r.discovered,
    gateBlockedTools: r.gateBlocked,
    missingRequiredTools: r.missingRequired,
    pruneMinTools: r.pruneMinTools,
  }));

describe("resolveToolSurface — invariants (property-tested)", () => {
  test("callable ⊆ visible ⊆ augmented∪finalAnswer", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        const { visible, callable } = resolveToolSurface(inputs);
        const visibleNames = new Set(visible.map((t) => t.name));
        const allNames = new Set([
          ...inputs.augmented.map((t) => t.name),
          inputs.finalAnswerSchema.name,
        ]);
        for (const t of callable) expect(visibleNames.has(t.name)).toBe(true);
        for (const t of visible) expect(allNames.has(t.name)).toBe(true);
      }),
    );
  });

  test("FLOOR: explicit allowedTools present in augmented always survive to visible (outside the pressure arm)", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        fc.pre(!(inputs.pressureCritical && !inputs.lazyMode));
        const { visible } = resolveToolSurface(inputs);
        const visibleNames = new Set(visible.map((t) => t.name));
        const augmentedNames = new Set(inputs.augmented.map((t) => t.name));
        for (const name of inputs.allowedTools) {
          if (augmentedNames.has(name)) expect(visibleNames.has(name)).toBe(true);
        }
      }),
    );
  });

  test("FLOOR: required tools present in augmented always survive to visible (outside the pressure arm)", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        fc.pre(!(inputs.pressureCritical && !inputs.lazyMode));
        const { visible } = resolveToolSurface(inputs);
        const visibleNames = new Set(visible.map((t) => t.name));
        const augmentedNames = new Set(inputs.augmented.map((t) => t.name));
        for (const name of inputs.requiredTools) {
          if (augmentedNames.has(name)) expect(visibleNames.has(name)).toBe(true);
        }
      }),
    );
  });

  test("META floor: meta tools in augmented are always visible (outside the pressure arm)", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        fc.pre(!(inputs.pressureCritical && !inputs.lazyMode));
        const { visible } = resolveToolSurface(inputs);
        const visibleNames = new Set(visible.map((t) => t.name));
        for (const t of inputs.augmented) {
          if (META_TOOLS.has(t.name)) expect(visibleNames.has(t.name)).toBe(true);
        }
      }),
    );
  });

  test("NEVER-PRUNE-TO-META-ONLY: domain tools pre-prune ⇒ domain tools post-prune (outside the pressure arm)", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        fc.pre(!(inputs.pressureCritical && !inputs.lazyMode));
        const { visible } = resolveToolSurface(inputs);
        const preNonMeta = inputs.augmented.some((t) => !META_TOOLS.has(t.name));
        const postNonMeta = visible.some((t) => !META_TOOLS.has(t.name));
        if (preNonMeta) expect(postNonMeta).toBe(true);
      }),
    );
  });

  test("gate narrowing: while blocking, callable = missing-required + META only", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        fc.pre(inputs.gateBlockedTools.length > 0 && inputs.missingRequiredTools.length > 0);
        const { callable } = resolveToolSurface(inputs);
        for (const t of callable) {
          expect(
            inputs.missingRequiredTools.includes(t.name) || META_TOOLS.has(t.name),
          ).toBe(true);
        }
      }),
    );
  });

  test("every tool in the augmented set gets a reason", () => {
    fc.assert(
      fc.property(arbInputs, (inputs) => {
        const { reasons } = resolveToolSurface(inputs);
        for (const t of inputs.augmented) {
          expect(reasons.has(t.name)).toBe(true);
          expect(reasons.get(t.name)!.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});

describe("resolveToolSurface — pinned scenarios", () => {
  test("rw-9 regression shape: explicit tool visible via allowed-floor even with minimal requiredTools", () => {
    // The 2026-07-07 regression: requiredTools ["file-read"], file-write
    // explicitly requested (allowedTools), empty classifier output, lazy mode.
    const surface = resolveToolSurface({
      augmented: [schema("file-read"), schema("file-write"), schema("web-search"), FINAL_ANSWER],
      finalAnswerSchema: FINAL_ANSWER,
      lazyMode: true,
      pressureCritical: false,
      hasClassification: true,
      requiredTools: ["file-read"],
      relevantTools: ["file-write"], // the kernel-input union hotfix feeds explicit builtins here
      allowedTools: [],
      toolsUsed: [],
      discovered: [],
      gateBlockedTools: [],
      missingRequiredTools: ["file-read"],
      pruneMinTools: 15,
    });
    const names = new Set(surface.visible.map((t) => t.name));
    expect(names.has("file-write")).toBe(true);
    expect(names.has("file-read")).toBe(true);
    expect(names.has("web-search")).toBe(false); // undisclosed — reachable via discover-tools
    expect(surface.reasons.get("file-write")).toBe("visible: relevant");
    expect(surface.reasons.get("web-search")).toContain("lazy-undisclosed");
  });

  test("pressure arm (non-lazy): final-answer only, reasons say why", () => {
    const surface = resolveToolSurface({
      augmented: [schema("web-search"), FINAL_ANSWER],
      finalAnswerSchema: FINAL_ANSWER,
      lazyMode: false,
      pressureCritical: true,
      hasClassification: false,
      requiredTools: [],
      relevantTools: [],
      allowedTools: [],
      toolsUsed: [],
      discovered: [],
      gateBlockedTools: [],
      missingRequiredTools: [],
      pruneMinTools: 15,
    });
    expect(surface.visible.map((t) => t.name)).toEqual(["final-answer"]);
    expect(surface.reasons.get("web-search")).toContain("pressure-critical");
  });

  test("gate narrowing keeps prompt visibility but narrows FC callable", () => {
    const surface = resolveToolSurface({
      augmented: [schema("web-search"), schema("file-read"), FINAL_ANSWER],
      finalAnswerSchema: FINAL_ANSWER,
      lazyMode: true,
      pressureCritical: false,
      hasClassification: true,
      requiredTools: ["web-search"],
      relevantTools: ["file-read"],
      allowedTools: [],
      toolsUsed: ["file-read"],
      discovered: [],
      gateBlockedTools: ["file-read"],
      missingRequiredTools: ["web-search"],
      pruneMinTools: 15,
    });
    expect(surface.visible.map((t) => t.name).sort()).toEqual(["file-read", "final-answer", "web-search"]);
    expect(surface.callable.map((t) => t.name).sort()).toEqual(["final-answer", "web-search"]);
    expect(surface.reasons.get("file-read")).toContain("gate-narrowed");
  });
});
