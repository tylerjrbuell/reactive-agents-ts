import { describe, expect, it } from "bun:test";
import {
  COMPACTION_SECTIONS,
  SUMMARY_TRANSCRIPT_CHAR_CAP,
  UNSTRUCTURED_SUMMARY_HEADING,
  boundTranscript,
  compactionContextEstimate,
  compactionInstruction,
  compactionPrompt,
  normalizeSectionHeading,
  structureCompactionSummary,
} from "../services/compaction-summary.js";
import {
  COMPACTION_SECTIONS as UI_SECTIONS,
  normalizeSectionHeading as uiNormalize,
} from "../../ui/src/lib/chat-compaction.js";

const FULL = COMPACTION_SECTIONS.map((s) => `## ${s}\nNone.`).join("\n\n");

describe("compactionInstruction", () => {
  it("names every required section heading, in order", () => {
    const text = compactionInstruction();
    let at = -1;
    for (const s of ["## Goal", "## Decisions", "## Facts & identifiers", "## Files & artifacts", "## Open questions", "## Next steps"]) {
      const idx = text.indexOf(s);
      expect(idx).toBeGreaterThan(at);
      at = idx;
    }
  });
  it("says an empty section is None.", () => {
    expect(compactionInstruction()).toContain("None.");
  });
  it("writes every heading line bare: section guidance sits on its own bullet, never in the heading", () => {
    const headings = compactionInstruction().split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual(COMPACTION_SECTIONS.map((s) => `## ${s}`));
    expect(compactionInstruction()).toContain("- (names, numbers, file paths, IDs, versions, verbatim error strings)");
  });
});

describe("normalizeSectionHeading", () => {
  it("matches the UI mirror (section list and normalization)", () => {
    expect([...UI_SECTIONS]).toEqual([...COMPACTION_SECTIONS]);
    for (const h of ["Facts & identifiers (names, IDs):", "  GOAL ", "Next steps (soon) (later)", "Odd: (x)"]) {
      expect(uiNormalize(h)).toBe(normalizeSectionHeading(h));
    }
  });
  it("ignores case, spacing, a trailing parenthetical and a trailing colon", () => {
    expect(normalizeSectionHeading("  Facts &  Identifiers (names, IDs) : ")).toBe("facts & identifiers");
    expect(normalizeSectionHeading("Goal:")).toBe("goal");
    expect(normalizeSectionHeading("Next steps")).toBe("next steps");
  });
});

/** Summary observed live (2026-11-10): the model copied the old prompt's guidance into one heading. */
const OBSERVED_LIVE = [
  "## Goal", "- List octopus facts.", "",
  "## Decisions", "None.", "",
  "## Facts & identifiers (names, numbers, file paths, IDs, versions, verbatim error strings)", "- 30 facts listed", "",
  "## Files & artifacts", "None.", "",
  "## Open questions", "None.", "",
  "## Next steps", "- Summarise in one sentence.",
].join("\n");

describe("structureCompactionSummary", () => {
  it("keeps a summary that has every section in order", () => {
    expect(structureCompactionSummary(`  ${FULL}  `)).toBe(FULL);
  });
  it("wraps unstructured prose under the fallback heading instead of failing", () => {
    expect(structureCompactionSummary("The user wanted a CSV importer.")).toBe(
      `${UNSTRUCTURED_SUMMARY_HEADING}\n\nThe user wanted a CSV importer.`,
    );
  });
  it("wraps a summary missing one section", () => {
    const missing = FULL.replace("## Open questions\nNone.\n\n", "");
    expect(structureCompactionSummary(missing).startsWith(UNSTRUCTURED_SUMMARY_HEADING)).toBe(true);
  });
  it("wraps a summary whose sections are out of order", () => {
    const swapped = ["## Goal", "## Next steps", "## Decisions", "## Facts & identifiers", "## Files & artifacts", "## Open questions"]
      .map((h) => `${h}\nNone.`)
      .join("\n\n");
    expect(structureCompactionSummary(swapped).startsWith(UNSTRUCTURED_SUMMARY_HEADING)).toBe(true);
  });
  it("accepts the observed live summary whose heading carries the guidance parenthetical, and writes the exact heading", () => {
    const out = structureCompactionSummary(OBSERVED_LIVE);
    expect(out.startsWith(UNSTRUCTURED_SUMMARY_HEADING)).toBe(false);
    expect(out).toContain("\n## Facts & identifiers\n- 30 facts listed");
    expect(out).not.toContain("(names, numbers");
  });
  it("accepts headings that differ only in case or a trailing colon", () => {
    const loose = COMPACTION_SECTIONS.map((s) => `## ${s.toUpperCase()}:\nNone.`).join("\n\n");
    expect(structureCompactionSummary(loose)).toBe(FULL);
  });
  it("does not take a ### heading as a section", () => {
    const deeper = FULL.replace("## Decisions", "### Decisions");
    expect(structureCompactionSummary(deeper).startsWith(UNSTRUCTURED_SUMMARY_HEADING)).toBe(true);
  });
  it("returns empty text unchanged so the caller can refuse it", () => {
    expect(structureCompactionSummary("   ")).toBe("");
  });
});

describe("boundTranscript", () => {
  const turn = (role: "user" | "assistant", content: string) => ({ role, content });

  it("renders a short transcript whole, labelled by role", () => {
    expect(boundTranscript([turn("user", "hi"), turn("assistant", "hello")])).toBe("User: hi\n\nAssistant: hello");
  });

  it("caps a long transcript, keeps head and tail, and counts the elided messages", () => {
    const mid = "x".repeat(15_000);
    const middle = Array.from({ length: 8 }, (_, i) => turn(i % 2 === 0 ? "assistant" : "user", mid));
    const turns = [turn("user", "FIRST"), ...middle, turn("assistant", "LAST")];
    const out = boundTranscript(turns, 60_000);
    expect(out.length).toBeLessThanOrEqual(60_000);
    expect(out.startsWith("User: FIRST")).toBe(true);
    expect(out.endsWith("LAST")).toBe(true);
    // Several middle messages lie wholly between the kept head and tail.
    expect(out).toMatch(/\[\.\.\. [1-9]\d* earlier messages elided \.\.\.\]/);
  });

  it("keeps roughly 20% head and 80% tail", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i % 2 === 0 ? "user" : "assistant", `m${i}-` + "y".repeat(9_000)));
    const out = boundTranscript(turns, 30_000);
    const marker = out.indexOf("[...");
    expect(marker).toBeGreaterThan(0);
    expect(marker).toBeLessThan(30_000 * 0.25);
    expect(out.length - marker).toBeGreaterThan(30_000 * 0.7);
  });

  it("bounds a single oversized message without dropping the whole transcript", () => {
    const out = boundTranscript([turn("user", "z".repeat(200_000))], 60_000);
    expect(out.length).toBeLessThanOrEqual(60_000);
    expect(out.length).toBeGreaterThan(50_000);
  });

  it("uses the module cap by default", () => {
    expect(SUMMARY_TRANSCRIPT_CHAR_CAP).toBe(60_000);
    const out = boundTranscript([turn("user", "q".repeat(100_000))]);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_TRANSCRIPT_CHAR_CAP);
  });
});

describe("compactionPrompt", () => {
  it("bounds the quoted history so a long chat cannot overflow the summariser", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i} ` + "w".repeat(20_000) }));
    const prompt = compactionPrompt(turns);
    expect(prompt.length).toBeLessThan(SUMMARY_TRANSCRIPT_CHAR_CAP + 2_000);
    expect(prompt).toContain("--- Current message ---");
    expect(prompt).toContain("## Next steps");
  });
});

describe("compactionContextEstimate", () => {
  it("estimates tokens over the transcript and derives the window numbers when the window is known", () => {
    const ctx = compactionContextEstimate([{ content: "a".repeat(400) }], 1000);
    expect(ctx.estimated).toBe(true);
    expect(ctx.tokensUsed).toBeGreaterThan(0);
    expect(ctx.windowTokens).toBe(1000);
    expect(ctx.utilizationPct).toBe(Math.round((ctx.tokensUsed / 1000) * 100));
    expect(ctx.level).toBeDefined();
  });
  it("omits the window numbers entirely when the window is unknown (no fake percentage)", () => {
    const ctx = compactionContextEstimate([{ content: "hello there" }], undefined);
    expect(ctx.estimated).toBe(true);
    expect(ctx.tokensUsed).toBeGreaterThan(0);
    expect(ctx).not.toHaveProperty("windowTokens");
    expect(ctx).not.toHaveProperty("utilizationPct");
    expect(ctx).not.toHaveProperty("level");
  });
});
