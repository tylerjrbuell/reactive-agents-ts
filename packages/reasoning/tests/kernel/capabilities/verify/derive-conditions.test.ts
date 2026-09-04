// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/derive-conditions.test.ts --timeout 15000
//
// deriveConditions(task, requiredTools) — deterministic (NO LLM), conservative.
// Precedence: requiredTools -> ToolCalled(each); a HIGH-PRECISION literal
// deliverable path in the task ("write/create/save/generate a file ./X") ->
// ArtifactProduced('./X') + ToolCalled(<writing tool>). Nothing clear -> EMPTY.
import { describe, it, expect } from "bun:test";
import {
  deriveConditions,
} from "../../../../src/kernel/capabilities/verify/derive-conditions.js";
import {
  toolCalled,
  artifactProduced,
} from "../../../../src/kernel/capabilities/verify/post-conditions.js";

describe("deriveConditions — requiredTools", () => {
  it("derives ToolCalled for each required tool", () => {
    const c = deriveConditions("Search and summarize", ["web-search", "recall"]);
    expect(c).toEqual(
      expect.arrayContaining([toolCalled("web-search"), toolCalled("recall")]),
    );
  }, 15000);
});

describe("deriveConditions — literal deliverable path", () => {
  it("'create a markdown file (./commits.md)' -> ArtifactProduced + writing ToolCalled", () => {
    const c = deriveConditions(
      "Fetch the commits and create a markdown file (./commits.md) summarizing them.",
      ["file-write"],
    );
    expect(c).toEqual(
      expect.arrayContaining([
        artifactProduced("./commits.md"),
        toolCalled("file-write"),
      ]),
    );
  }, 15000);

  it("derives the artifact even with no requiredTools (default writing tool)", () => {
    const c = deriveConditions("write a file ./out.txt with the answer", []);
    expect(c).toEqual(
      expect.arrayContaining([artifactProduced("./out.txt"), toolCalled("file-write")]),
    );
  }, 15000);
});

describe("deriveConditions — conservative (no over-derivation)", () => {
  it("'summarize recursion' -> EMPTY", () => {
    expect(deriveConditions("Summarize the concept of recursion.", [])).toEqual([]);
  }, 15000);

  it("vague 'file' mention without a literal path -> no artifact", () => {
    expect(
      deriveConditions("Tell me about the file system on Linux.", []),
    ).toEqual([]);
  }, 15000);

  it("URL deliverable in parens must NOT derive an ArtifactProduced", () => {
    // Regression: the paren-extract captures `https://example.com` and the
    // PATH_TOKEN strip yields `//example.com`, which the `/https?:/i` guard
    // alone does not catch — it must also be rejected via startsWith("//").
    const c = deriveConditions("save it to (https://example.com/x)", []);
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("is deterministic (same input -> same output)", () => {
    const t = "create a markdown file (./commits.md) summarizing them.";
    expect(deriveConditions(t, ["file-write"])).toEqual(
      deriveConditions(t, ["file-write"]),
    );
  }, 15000);
});

describe("deriveConditions — prose abbreviation precision (no phantom artifact)", () => {
  it("T5 task with '(e.g. AI/ML ...)' must NOT derive an ArtifactProduced", () => {
    // Precision bug: PATH_TOKEN treated the '.g' of 'e.g' as a file extension,
    // yielding a phantom ArtifactProduced('./e.g') for a pure-synthesis task.
    const t =
      "Fetch the top 15 Hacker News posts. Then write a markdown report titled " +
      "'HN Roundup' grouped into 2-4 thematic categories (e.g. AI/ML, Hardware, " +
      "Programming, Other). Summarize each category in 2-3 sentences.";
    const c = deriveConditions(t, []);
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("'see the docs (e.g. the readme)' must NOT derive an ArtifactProduced", () => {
    const c = deriveConditions(
      "Write a summary. See the docs (e.g. the readme) for context.",
      [],
    );
    expect(c.some((x) => x.kind === "ArtifactProduced")).toBe(false);
  }, 15000);

  it("'Save the results to data.csv' still derives ArtifactProduced('./data.csv')", () => {
    const c = deriveConditions("Save the results to data.csv", []);
    expect(c).toEqual(
      expect.arrayContaining([
        artifactProduced("./data.csv"),
        toolCalled("file-write"),
      ]),
    );
  }, 15000);
});

// ── WRITE-anchored deliverable class (2026-05-31) ──────────────────────────────
// The deliverable must bind to a WRITE verb, never a READ input. Caught by the #7
// ablation: read-X-then-write-Y tasks derived ArtifactProduced(<READ input>) — a file
// the run only reads — permanently UNMET → false-blocked the run to max_iterations.
const hasArtifact = (c: ReturnType<typeof deriveConditions>): boolean =>
  c.some((x) => x.kind === "ArtifactProduced");
const artifactPath = (
  c: ReturnType<typeof deriveConditions>,
): string | undefined => c.find((x) => x.kind === "ArtifactProduced")?.path;

describe("deriveDeliverablePath — binds to the WRITE verb, not the first path", () => {
  it("read-then-write summary task -> WRITE target, NOT the read input", () => {
    const t =
      "Read the file ./overflow-fixture.md (in the current directory) then " +
      "write a local markdown file ./agents-summary.md summarizing its " +
      "top-level (##) sections.";
    const c = deriveConditions(t, ["file-read", "file-write"]);
    expect(c).toEqual(
      expect.arrayContaining([
        artifactProduced("./agents-summary.md"),
        toolCalled("file-write"),
      ]),
    );
    expect(artifactPath(c)).toBe("./agents-summary.md");
  }, 15000);

  it("read-then-write: 'Read ./in.md then write ./out.md' -> ./out.md", () => {
    const c = deriveConditions("Read ./in.md then write ./out.md", ["file-write"]);
    expect(artifactPath(c)).toBe("./out.md");
  }, 15000);

  it("fetch-then-save: 'Fetch the commits then save them to ./commits.md' -> ./commits.md", () => {
    const c = deriveConditions("Fetch the commits then save them to ./commits.md", ["file-write"]);
    expect(artifactPath(c)).toBe("./commits.md");
  }, 15000);

  it("write-only: 'write a file ./report.md' -> ./report.md (unchanged)", () => {
    const c = deriveConditions("write a file ./report.md", ["file-write"]);
    expect(artifactPath(c)).toBe("./report.md");
  }, 15000);

  it("parenthesized: 'create a markdown file (./summary.md)' -> ./summary.md (unchanged)", () => {
    const c = deriveConditions("create a markdown file (./summary.md)", ["file-write"]);
    expect(artifactPath(c)).toBe("./summary.md");
  }, 15000);

  it("read-only (no write verb): 'Read ./config.json and explain it' -> NO ArtifactProduced", () => {
    const c = deriveConditions("Read ./config.json and explain it", ["file-read"]);
    expect(hasArtifact(c)).toBe(false);
  }, 15000);

  it("multiple writes: takes the LAST write target", () => {
    const c = deriveConditions("First write ./draft.md, then write the final ./report.md", ["file-write"]);
    expect(artifactPath(c)).toBe("./report.md");
  }, 15000);
});

describe("deriveConditions — non-file mutation (SideEffectLanded)", () => {
  const kinds = (c: ReturnType<typeof deriveConditions>) => c.map((x) => x.kind);

  it("'create a keep note with groceries' -> SideEffectLanded (no file)", () => {
    const c = deriveConditions("Use the gws-cli tool to create a new keep note with groceries: butter, milk, eggs", []);
    expect(kinds(c)).toContain("SideEffectLanded");
  }, 15000);

  it("'send an email to Bob' -> SideEffectLanded", () => {
    const c = deriveConditions("Send an email to Bob about the meeting", []);
    expect(kinds(c)).toContain("SideEffectLanded");
  }, 15000);

  it("READ task 'get my calendar events' -> NO SideEffectLanded", () => {
    const c = deriveConditions("Get my calendar events for today and summarise them", []);
    expect(kinds(c)).not.toContain("SideEffectLanded");
  }, 15000);

  it("'create a function' (no external resource) -> NO SideEffectLanded", () => {
    const c = deriveConditions("Create a function that adds two numbers", []);
    expect(kinds(c)).not.toContain("SideEffectLanded");
  }, 15000);

  it("FILE mutation stays ArtifactProduced, NOT SideEffectLanded", () => {
    const c = deriveConditions("Create a file ./notes.md with my grocery list", ["file-write"]);
    expect(kinds(c)).toContain("ArtifactProduced");
    expect(kinds(c)).not.toContain("SideEffectLanded");
  }, 15000);

  // Regression (2026-08-14): MUTATION_VERB and EXTERNAL_RESOURCE_NOUN used to
  // share "draft"/"invite" -- a SINGLE word present in both lists satisfies
  // both independent .test() calls, so any task mentioning it derives a
  // phantom SideEffectLanded with no real second word required. This bit
  // every .withOutputSchema() task: its auto-injected prompt names the
  // JSON-Schema meta-schema URI (".../draft-07/schema#"), so "draft" alone
  // manufactured an unsatisfiable requirement on a task with nothing to
  // mutate. Once bare builders started throwing on max_iterations (B1,
  // 2026-08-13), this surfaced as a hard failure instead of silent churn.
  it("a lone word present in BOTH lists does not derive SideEffectLanded on its own", () => {
    const c = deriveConditions(
      'Answer this. Schema: {"$schema":"http://json-schema.org/draft-07/schema#"}',
      [],
    );
    expect(kinds(c)).not.toContain("SideEffectLanded");
  });

  it("MUTATION_VERB and EXTERNAL_RESOURCE_NOUN word lists stay disjoint", () => {
    const source = require("node:fs").readFileSync(
      require.resolve("../../../../src/kernel/capabilities/verify/derive-conditions.ts"),
      "utf8",
    ) as string;
    const extract = (name: string): string[] => {
      const m = source.match(new RegExp(`const ${name} =\\s*\\n?\\s*\\/\\\\b\\(([^)]+)\\)\\\\b\\/i`));
      if (!m) throw new Error(`could not locate ${name} pattern in derive-conditions.ts`);
      return m[1]!.split("|");
    };
    const verbs = extract("MUTATION_VERB");
    const nouns = extract("EXTERNAL_RESOURCE_NOUN");
    const overlap = verbs.filter((w) => nouns.includes(w));
    expect(overlap).toEqual([]);
  });
});

describe("deriveConditions — availableWritingTools (FM-15 layer 5)", () => {
  it("legacy behavior when omitted: guesses the builtin file-write", () => {
    const c = deriveConditions("Write the summary to ./out.md.", []);
    expect(c).toContainEqual(toolCalled("file-write"));
  });

  it("requires the run's actual custom writer when declared available", () => {
    const c = deriveConditions("Write the summary to ./out.md.", [], ["write_note"]);
    expect(c).toContainEqual(toolCalled("write_note"));
    expect(c).not.toContainEqual(toolCalled("file-write"));
  });

  it("does NOT demand an unavailable writer — this was FM-15's terminal-gate half", () => {
    // compileRunContract (layer 4) and deriveConditions (layer 5) are two
    // authorities over the SAME fact and must agree, or the terminal gate
    // demands a tool the compiled contract never required — which is exactly
    // what force-failed a correct run: the runner passed the shared
    // availability signal to compileRunContract but not to deriveConditions,
    // so the gate still read the hardcoded guess.
    const c = deriveConditions("Write the summary to ./out.md.", [], []);
    expect(c).not.toContainEqual(toolCalled("file-write"));
    expect(c).toContainEqual(artifactProduced("./out.md"));
  });
});

// Root fix 2026-09-04: `ReactiveAgent.chat()`'s tool-capable path and
// `withHistoryBlock()` both prepend prior-turn prose to the task text before
// the kernel ever sees it — "Context from prior run:\n<debrief>\n\nNew
// request: <message>" and "--- Conversation history ---\n<turns>\n\n
// --- Current message ---\n<message>" respectively, and the two compose. A
// prior turn's rich answer prose routinely contains MUTATION_VERB +
// EXTERNAL_RESOURCE_NOUN combinations (e.g. "shared a summary of the page")
// describing PAST work, not the current ask — deriving an unsatisfiable
// SideEffectLanded condition from it made a plain conversational follow-up
// loop indefinitely (verified live via a real Halopedia-persona 2-turn chat:
// a lore question followed by "Halo lore is so cool and deep" looped 6
// iterations before the loop-detector's grace-period rescue, because the
// post-condition steer could never land a side-effect a banter reply was
// never going to produce).
describe("deriveConditions — prior-context contamination (root fix 2026-09-04)", () => {
  it("ignores mutation-verb+noun combos in a 'Context from prior run' / 'New request:' prefix", () => {
    const task =
      "Context from prior run:\nThe agent shared a summary of the page and posted a comment on the thread.\n\n" +
      "New request: Halo lore is so cool and deep.";
    expect(deriveConditions(task, [])).toEqual([]);
  });

  it("ignores mutation-verb+noun combos in a '--- Conversation history ---' / '--- Current message ---' block", () => {
    const task =
      "--- Conversation history ---\n" +
      "User: Tell me about the SPARTAN-II program.\n" +
      "Assistant: We shared a detailed summary and posted a note about Halsey's role.\n\n" +
      "--- Current message ---\nHalo lore is so cool and deep.";
    expect(deriveConditions(task, [])).toEqual([]);
  });

  it("handles the composed case: chat's 'New request:' wrapping the history block's 'Current message'", () => {
    const task =
      "Context from prior run:\nSummary text.\n\nNew request: " +
      "--- Conversation history ---\nUser: hi\nAssistant: shared a note on the thread\n\n" +
      "--- Current message ---\nHalo lore is so cool and deep.";
    expect(deriveConditions(task, [])).toEqual([]);
  });

  it("still derives a genuine SideEffectLanded condition from the CURRENT request text", () => {
    const task =
      "--- Conversation history ---\nUser: hi\nAssistant: sure thing\n\n" +
      "--- Current message ---\nPlease send an email to the team about the release.";
    expect(deriveConditions(task, [])).toEqual([{ kind: "SideEffectLanded" }]);
  });

  it("byte-identical for a plain task with no prefix markers", () => {
    const task = "Please send an email to the team about the release.";
    expect(deriveConditions(task, [])).toEqual([{ kind: "SideEffectLanded" }]);
  });
});
