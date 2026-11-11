// Run: bun test packages/reasoning/tests/kernel/seam-compact-call-facts.test.ts --timeout 15000
/**
 * Compact tool profiles and tool-index promotion share ONE description
 * trimmer (`compactToolDescription`), and the compact profile's call
 * constraints are opt-in (`harness.compactCallConstraints`).
 *
 * Ablation 2026-11-10 (family-disclosure-compact-facts, ledger 41/42): the
 * compact note restored `get_metrics.type` values for mimo (+23/+42pp, below
 * the promotion band, so OPT-IN). Root defect found there: tool-index
 * promotion kept only the first sentence, dropping "type is one of ...".
 *
 * Pins:
 *  - flag off: the compact text format is the pre-change `name(p: type)`
 *    (no enum values, no note);
 *  - flag on: enum values replace the bare type and the value-constraint
 *    sentences follow the signature;
 *  - `"summary"` (promotion) keeps the first sentence and the constraint
 *    sentences, and drops other prose;
 *  - the names-and-types tool reference follows the flag.
 */
import { describe, it, expect } from "bun:test";
import {
  callConstraintNote,
  compactToolDescription,
  formatToolSchemaCompact,
  type ToolSchema,
} from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { buildToolReference } from "../../src/context/context-engine.js";

const GET_METRICS: ToolSchema = {
  name: "umami_get_metrics",
  description:
    "Get ranked metrics for a website. Results are sorted by count. type is one of url, referrer, browser, os, device, country, event.",
  parameters: [
    { name: "websiteId", type: "string", required: true },
    { name: "type", type: "string", required: true },
  ],
};

const ENUM_TOOL: ToolSchema = {
  name: "umami_get_metrics",
  description: "Get ranked metrics for a website.",
  parameters: [
    { name: "websiteId", type: "string", required: true },
    { name: "type", type: "string", required: true, enum: ["url", "referrer", "browser"] },
    {
      name: "unit",
      type: "string",
      description: "Time bucket for the series. Must be hour, day or month.",
    },
  ],
};

describe("compact format: call constraints are opt-in", () => {
  it("flag off: the pre-change format (bare type, no note)", () => {
    expect(formatToolSchemaCompact(ENUM_TOOL)).toBe(
      "- umami_get_metrics(websiteId: string, type: string, unit: string?)",
    );
    expect(formatToolSchemaCompact(GET_METRICS)).toBe("- umami_get_metrics(websiteId: string, type: string)");
  });

  it("flag on: enum values replace the bare type, and the constraint follows", () => {
    const line = formatToolSchemaCompact(ENUM_TOOL, true);
    expect(line).toContain("type: url|referrer|browser");
    expect(line).toContain("websiteId: string");
    expect(line).toContain(" — unit: Must be hour, day or month.");
  });
});

describe("compactToolDescription — the one trimmer", () => {
  it("none: no prose", () => {
    expect(compactToolDescription(GET_METRICS, "none")).toBe("");
  });

  it("constraints: value-constraint sentences only", () => {
    expect(compactToolDescription(GET_METRICS, "constraints")).toBe(
      "type is one of url, referrer, browser, os, device, country, event.",
    );
    expect(compactToolDescription(ENUM_TOOL, "constraints")).toBe("unit: Must be hour, day or month.");
  });

  it("summary: first sentence plus constraint sentences, other prose dropped", () => {
    expect(compactToolDescription(GET_METRICS, "summary")).toBe(
      "Get ranked metrics for a website. type is one of url, referrer, browser, os, device, country, event.",
    );
  });

  it("summary of a one-sentence description is that sentence", () => {
    expect(compactToolDescription(ENUM_TOOL, "summary")).toBe("Get ranked metrics for a website.");
    expect(compactToolDescription({ name: "x", description: "", parameters: [] }, "summary")).toBe("");
  });

  it("a tool with no constraint prose has an empty note", () => {
    expect(
      callConstraintNote({
        name: "web-search",
        description: "Search the web. Returns one of the best pages.",
        parameters: [{ name: "query", type: "string", required: true }],
      }),
    ).toBe("");
  });
});

describe("names-and-types tool reference follows the flag", () => {
  it("flag off: no constraint, no prose", () => {
    const ref = buildToolReference("explore umami", [GET_METRICS], [], "names-and-types", "local");
    expect(ref).not.toContain("type is one of");
    expect(ref).not.toContain("Get ranked metrics");
  });

  it("flag on: the constraint, no prose", () => {
    const ref = buildToolReference("explore umami", [GET_METRICS], [], "names-and-types", "local", true);
    expect(ref).toContain("type is one of url, referrer");
    expect(ref).not.toContain("Get ranked metrics");
  });
});
