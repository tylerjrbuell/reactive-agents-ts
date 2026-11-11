import { describe, expect, test } from "bun:test";
import {
  COMPACTED_USER_MARKER,
  COMPACTION_SECTIONS,
  compactionRows,
  normalizeSectionHeading,
  parseCompactionSections,
} from "./chat-compaction.js";

test("marker row and the summary after it are identified", () => {
  const { markers, summaries } = compactionRows([
    { role: "user", content: COMPACTED_USER_MARKER },
    { role: "assistant", content: "summary" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ]);
  expect([...markers]).toEqual([0]);
  expect([...summaries]).toEqual([1]);
});

describe("parseCompactionSections", () => {
  test("splits the six structured sections in order", () => {
    const md = [
      "## Goal", "Ship the importer.", "",
      "## Decisions", "None.", "",
      "## Facts & identifiers", "- port 4321", "",
      "## Files & artifacts", "None.", "",
      "## Open questions", "None.", "",
      "## Next steps", "Run the tests.",
    ].join("\n");
    const sections = parseCompactionSections(md);
    expect(sections?.map((s) => s.heading)).toEqual([
      "Goal", "Decisions", "Facts & identifiers", "Files & artifacts", "Open questions", "Next steps",
    ]);
    expect(sections?.[0]?.body).toBe("Ship the importer.");
    expect(sections?.[1]?.body).toBe("None.");
  });
  test("returns null when there are no headings (plain render)", () => {
    expect(parseCompactionSections("Just prose, no headings.")).toBeNull();
  });
  test("keeps preamble text before the first heading as a heading-less section", () => {
    const sections = parseCompactionSections("Intro line\n\n## Goal\nDo it");
    expect(sections).toEqual([
      { heading: "", body: "Intro line" },
      { heading: "Goal", body: "Do it" },
    ]);
  });
  test("reads the observed live summary: drops the empty unstructured wrapper, names the guidance-laden heading canonically", () => {
    // Stored live 2026-11-10 by the old strict server check.
    const md = [
      "## Summary (unstructured)", "",
      "## Goal", "- List octopus facts.", "",
      "## Decisions", "None.", "",
      "## Facts & identifiers (names, numbers, file paths, IDs, versions, verbatim error strings)", "- 30 facts listed", "",
      "## Files & artifacts", "None.", "",
      "## Open questions", "None.", "",
      "## Next steps", "- Summarise in one sentence.",
    ].join("\n");
    const sections = parseCompactionSections(md);
    expect(sections?.map((s) => s.heading)).toEqual([...COMPACTION_SECTIONS]);
    expect(sections?.[2]?.body).toBe("- 30 facts listed");
  });
  test("normalizes case, spacing, trailing colon and parenthetical like the server", () => {
    expect(normalizeSectionHeading("  Facts &  Identifiers (names, IDs) : ")).toBe("facts & identifiers");
    expect(parseCompactionSections("## GOAL:\nDo it")?.[0]?.heading).toBe("Goal");
    expect(parseCompactionSections("## Something else\nx")?.[0]?.heading).toBe("Something else");
  });
  test("keeps an unstructured wrapper that has text under it", () => {
    expect(parseCompactionSections("## Summary (unstructured)\n\nprose")).toEqual([{ heading: "Summary (unstructured)", body: "prose" }]);
  });
  test("ignores ### headings and headings inside code fences", () => {
    expect(parseCompactionSections("### Not a section")).toBeNull();
    const sections = parseCompactionSections("## Goal\n```\n## not a heading\n```");
    expect(sections?.map((s) => s.heading)).toEqual(["Goal"]);
    expect(sections?.[0]?.body).toBe("```\n## not a heading\n```");
  });
});
