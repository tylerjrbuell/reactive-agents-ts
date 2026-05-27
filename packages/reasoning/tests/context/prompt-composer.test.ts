/**
 * prompt-composer.test.ts — APC-2 substrate pins.
 *
 * Covers:
 *   1. Registry CRUD (register, list, get, duplicate guard, clear)
 *   2. Composer parity mode (`shapeGated: false`) — every section rendered
 *   3. Composer shape-gated mode (`shapeGated: true`) — predicates respected
 *   4. Null/empty render → omitted from output AND counted in omittedSections
 *   5. costTokensApprox accumulated only for included sections
 *   6. Audit surface returns ordered metadata
 *
 * These pins lock the contract APC-3 (wire) and APC-4 (tighten predicates)
 * depend on. Breaking any of these = silent quality or token regression.
 */
import { describe, expect, it } from "bun:test";
import {
  PromptSectionRegistry,
  auditPromptSections,
  composePrompt,
  type PromptSection,
  type PromptSectionContext,
} from "../../src/context/prompt-composer.js";
import type { TaskShape } from "../../src/kernel/capabilities/comprehend/task-shape.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function trivialShape(): TaskShape {
  return {
    complexity: "trivial",
    needsTools: false,
    needsMultiStep: false,
    needsCitation: false,
    needsStructuredOutput: false,
    expectedOutputForm: "fact",
    highConfidence: true,
    reason: "test-trivial",
  };
}

function complexShape(): TaskShape {
  return {
    complexity: "complex",
    needsTools: true,
    needsMultiStep: true,
    needsCitation: true,
    needsStructuredOutput: false,
    expectedOutputForm: "synthesis",
    highConfidence: true,
    reason: "test-complex",
  };
}

function makeCtx(shape: TaskShape): PromptSectionContext {
  return {
    shape,
    // We only need shape for these tests — composer is shape-driven; other
    // fields are passed to section.render which is the section's concern.
    // Casting to satisfy the structural type without building full kernel
    // fixtures (composer doesn't touch them).
    state: {} as never,
    input: {} as never,
    profile: {} as never,
    guidance: {} as never,
  };
}

function section(
  id: string,
  body: string | null,
  requiredWhen: (s: TaskShape) => boolean = () => true,
  costTokensApprox = 10,
): PromptSection {
  return {
    id,
    description: `test-${id}`,
    requiredWhen,
    render: () => body,
    costTokensApprox,
  };
}

// ── Registry CRUD ────────────────────────────────────────────────────────────

describe("PromptSectionRegistry — CRUD", () => {
  it("register + list returns sections in registration order", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA"));
    r.register(section("b", "BBB"));
    r.register(section("c", "CCC"));
    expect(r.list().map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(r.size).toBe(3);
  });

  it("get returns the registered section, undefined when missing", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA"));
    expect(r.get("a")?.id).toBe("a");
    expect(r.get("missing")).toBeUndefined();
  });

  it("register throws on duplicate id (idempotence guard)", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA"));
    expect(() => r.register(section("a", "DUP"))).toThrow(/already registered/);
  });

  it("clear empties the registry", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA"));
    r.register(section("b", "BBB"));
    r.clear();
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
  });
});

// ── Composer — parity mode (shapeGated: false, DEFAULT) ──────────────────────

describe("composePrompt — parity mode (no shape gating)", () => {
  it("renders ALL sections regardless of predicate", () => {
    const sections = [
      section("a", "AAA", () => true),
      section("b", "BBB", () => false), // predicate would skip, but no gating
      section("c", "CCC", () => false),
    ];
    const result = composePrompt(sections, makeCtx(trivialShape()));
    expect(result.text).toBe("AAA\n\nBBB\n\nCCC");
    expect(result.includedSections).toEqual(["a", "b", "c"]);
    expect(result.omittedSections).toEqual([]);
  });

  it("default mode is parity (no opts arg passed)", () => {
    const sections = [
      section("a", "AAA", () => false),
      section("b", "BBB", () => false),
    ];
    const result = composePrompt(sections, makeCtx(complexShape()));
    expect(result.text).toBe("AAA\n\nBBB");
    expect(result.includedSections).toEqual(["a", "b"]);
  });

  it("null/empty renders are omitted from text + counted in omittedSections", () => {
    const sections = [
      section("a", "AAA"),
      section("empty", ""),
      section("null", null),
      section("b", "BBB"),
    ];
    const result = composePrompt(sections, makeCtx(trivialShape()));
    expect(result.text).toBe("AAA\n\nBBB");
    expect(result.includedSections).toEqual(["a", "b"]);
    expect(result.omittedSections).toEqual(["empty", "null"]);
  });

  it("costTokensApprox sums only over included sections", () => {
    const sections = [
      section("a", "AAA", () => true, 100),
      section("empty", "", () => true, 999), // not counted (omitted)
      section("b", "BBB", () => true, 50),
    ];
    const result = composePrompt(sections, makeCtx(trivialShape()));
    expect(result.approxTokens).toBe(150);
  });
});

// ── Composer — shape-gated mode (APC-4 lever) ────────────────────────────────

describe("composePrompt — shapeGated mode (APC-4 lever)", () => {
  it("omits sections whose requiredWhen returns false", () => {
    const sections = [
      section("identity", "I am", () => true), // always
      section("rules", "RULES", (s) => s.needsMultiStep), // trivial → off
      section("tools", "TOOLS", (s) => s.needsTools), // trivial → off
      section("guidance", "GUIDE", () => true), // always
    ];
    const result = composePrompt(
      sections,
      makeCtx(trivialShape()),
      { shapeGated: true },
    );
    expect(result.text).toBe("I am\n\nGUIDE");
    expect(result.includedSections).toEqual(["identity", "guidance"]);
    expect(result.omittedSections).toEqual(["rules", "tools"]);
  });

  it("complex shape keeps all sections that match its needs", () => {
    const sections = [
      section("identity", "I am", () => true),
      section("rules", "RULES", (s) => s.needsMultiStep),
      section("tools", "TOOLS", (s) => s.needsTools),
      section("citation", "CITE", (s) => s.needsCitation),
    ];
    const result = composePrompt(
      sections,
      makeCtx(complexShape()),
      { shapeGated: true },
    );
    expect(result.text).toBe("I am\n\nRULES\n\nTOOLS\n\nCITE");
    expect(result.includedSections).toEqual([
      "identity",
      "rules",
      "tools",
      "citation",
    ]);
    expect(result.omittedSections).toEqual([]);
  });

  it("predicate-omitted sections do NOT count toward approxTokens", () => {
    const sections = [
      section("identity", "I am", () => true, 20),
      section("rules", "RULES", (s) => s.needsMultiStep, 100),
      section("tools", "TOOLS", (s) => s.needsTools, 80),
    ];
    const result = composePrompt(
      sections,
      makeCtx(trivialShape()),
      { shapeGated: true },
    );
    // Only "identity" included (20 tokens).
    expect(result.approxTokens).toBe(20);
  });
});

// ── Audit surface ────────────────────────────────────────────────────────────

describe("auditPromptSections", () => {
  it("returns metadata in registration order", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA", () => true, 30));
    r.register(section("b", "BBB", () => true, 50));
    const audit = auditPromptSections(r);
    expect(audit).toEqual([
      { id: "a", description: "test-a", costTokensApprox: 30 },
      { id: "b", description: "test-b", costTokensApprox: 50 },
    ]);
  });

  it("includes all registered sections regardless of predicates", () => {
    const r = new PromptSectionRegistry();
    r.register(section("a", "AAA", () => true));
    r.register(section("b", "BBB", () => false));
    expect(auditPromptSections(r)).toHaveLength(2);
  });
});

// ── Conservative-default contract ────────────────────────────────────────────

describe("APC contract — conservative defaults (anti-regression)", () => {
  it("trivial shape with all-true predicates → all sections included", () => {
    const sections = [
      section("a", "AAA", () => true),
      section("b", "BBB", () => true),
    ];
    const result = composePrompt(
      sections,
      makeCtx(trivialShape()),
      { shapeGated: true },
    );
    // Even in shape-gated mode, sections without restrictive predicates
    // are kept. This is the safety mechanism: NEW sections default to
    // always-on unless their author explicitly opts into shape-gating.
    expect(result.includedSections.length).toBe(2);
  });

  it("registry default is empty (substrate-only, no implicit consumers)", () => {
    // Import here to ensure module load order doesn't matter.
    const { defaultPromptSectionRegistry } = require("../../src/context/prompt-composer.js");
    // Substrate-only: APC-2 ships no registered sections. APC-3 populates.
    // If this fails, someone wired a consumer prematurely.
    expect(defaultPromptSectionRegistry.size).toBe(0);
  });
});
