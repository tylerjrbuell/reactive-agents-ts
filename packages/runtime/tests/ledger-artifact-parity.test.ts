// Run: bun test packages/runtime/tests/ledger-artifact-parity.test.ts --timeout 30000
//
// The ledger records an `artifact` fact on EVERY execution path (2026-07-26).
//
// Wave C.2 slice 3b made the inline agent loop a first-class ledger writer, but
// only for STEP-derived entries (tool-invocation / tool-result). `artifact`
// entries are not step-derived — they are minted by `deriveArtifactEntries` from
// a tool's DECLARED `produces: "file"`, and that call lived ONLY in the kernel's
// act.ts. So the default path (inline, and the one delegation runs on) grew a
// ledger with no artifact facts at all.
//
// That is the ledger being INCOMPLETE on the path most runs take, which matters
// now that the post-condition spine's success authority reads artifact entries:
// a ledger-preferred reader is only safe if the ledger is path-complete.
//
// RED-ON-CUT: drop the `deriveArtifactEntries` call from inline-act.ts and the
// artifact assertion below fails while the CONTROL still passes.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

interface LedgerShape {
  readonly kind: string;
  readonly seq: number;
  readonly toolName?: string;
  readonly success?: boolean;
  readonly path?: string;
  readonly op?: string;
}

// file-write requires the path to resolve inside the process cwd.
const REL_PATH = "./.ledger-artifact-parity.tmp.md";

describe("the inline path records artifact facts on the ledger", () => {
  // RETITLED (Move 1 merge, 2026-08-13): "the inline path" is now a misnomer
  // -- every builder (bare or .withReasoning()) runs the kernel arm, so
  // there is no separate inline-act.ts path left to guard parity against.
  // The underlying property (the kernel mints an `artifact` fact from a
  // tool's declared `produces:"file"`) is still real and still worth a
  // direct test; this file now exercises it via the kernel path plainly.
  //
  // CORRECTED (2026-08-13, was wrong in an earlier commit this session):
  // this test's CONTROL check failing was NOT a `TestTurn.match`
  // implementation gap -- `match` IS implemented (packages/llm-provider/src
  // /testing.ts's `resolveTurn`, with a proper agent/harness channel split
  // via `channelOf(purpose)` so harness-internal calls like strategy-switch
  // evaluation cannot steal a scripted agent turn). The real cause: bare
  // `.withTools()` with no `required`/`allowedTools` leaves `file-write`
  // REGISTERED but not VISIBLE under the kernel's lazy-disclosure pruning
  // (confirmed via a debug trace: `[tools] visible: recall, discover-tools`
  // -- file-write absent) -- so the scripted `file-write` toolCall was
  // rejected as an unavailable tool name and the run fell through to the
  // trailing text turn. Fixed by declaring `file-write` required, matching
  // every other passing test that scripts a specific tool call.
  it("mints an `artifact` entry for a direct file-write, in BOTH views", async () => {
    const traceDir = await mkdtemp(join(tmpdir(), "ra-artifact-parity-"));
    const agent = await ReactiveAgents.create()
      .withName("artifact-parity")
      .withProvider("test")
      .withModel("test-model")
      .withTools({ required: ["file-write"] })
      .withObservability({ tracing: { dir: traceDir } })
      .withTestScenario([
        {
          match: "WRITE_TRIGGER",
          toolCall: {
            name: "file-write",
            args: { path: REL_PATH, content: "# probe\n\nrows here\n" },
          },
        },
        { text: "Done." },
      ])
      .build();

    try {
      const result = await agent.run(
        "prime the run with a long preamble so the scenario guard matches only the parent task. " +
          "WRITE_TRIGGER: write the report file.",
        { taskId: "artifact-parity-run" },
      );
      await agent.dispose();

      const ledger =
        ((result.metadata as { runLedger?: readonly LedgerShape[] }).runLedger ?? []);

      // CONTROL: the write actually EXECUTED and succeeded. Without this the
      // artifact assertion below could fail for the trivial reason that no tool
      // ran at all — the malformed-probe trap this suite exists to avoid.
      expect(
        ledger.some(
          (e) => e.kind === "tool-result" && e.toolName === "file-write" && e.success === true,
        ),
      ).toBe(true);

      // The fact under test: a `produces: "file"` tool's successful write is an
      // enumerable artifact fact of the run, not merely a tool-result.
      const artifacts = ledger.filter((e) => e.kind === "artifact");
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.some((a) => (a.path ?? "").endsWith(".ledger-artifact-parity.tmp.md"))).toBe(
        true,
      );
      // `op` must survive — a `delete` must never read as "produced".
      expect(artifacts.every((a) => typeof a.op === "string")).toBe(true);

      // Dense, monotonic seq across the merged artifact + step entries.
      expect(ledger.map((e, i) => e.seq === i).every(Boolean)).toBe(true);

      // The announced seam covers the artifact facts too: because they are
      // handed to `growRunLedger` rather than appended by the caller, the
      // published delta is the WHOLE growth. If a caller appended them itself,
      // the object view would carry facts the stream never saw — the exact
      // divergence (GH #188) the seam exists to kill.
      const files = await readdir(traceDir);
      const jsonl = (
        await Promise.all(
          files
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => readFile(join(traceDir, f), "utf-8")),
        )
      ).join("\n");
      const streamed = jsonl
        .split("\n")
        .filter((l) => l.includes('"ledger-entry"'))
        .flatMap((l) => {
          const ev = JSON.parse(l) as { entries?: readonly LedgerShape[] };
          return ev.entries ?? [];
        });
      expect(streamed.some((e) => e.kind === "artifact")).toBe(true);
    } finally {
      await rm(join(process.cwd(), REL_PATH), { force: true });
      await rm(traceDir, { recursive: true, force: true });
    }
  }, 30_000);
});
