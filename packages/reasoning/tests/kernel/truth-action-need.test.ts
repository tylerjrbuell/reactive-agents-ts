// Run: bun test packages/reasoning/tests/kernel/truth-action-need.test.ts --timeout 15000
//
// Truthfulness audit 2026-11-06, item 1 (wiki/Research/Harness-Reports/
// 2026-11-06-harness-truthfulness-audit.md). The contract compiler rendered
// `[action:create-ticket] task requires a "create-ticket" action` to the model
// from loose word co-occurrence: memory text "files … issues" on a Cortex
// "get the price of xrp" turn, "test file … bug" on a debug task. 45/45
// rendered action lines in the corpus were false, and the same requirement
// drives the iteration-0 abstain path (satisfiability.ts).
//
// Two independent guards, each pinned on its own:
//  - the compile input is the user's own message (history AND trailing
//    prior-context / recalled-memory blocks are cut by extractCurrentTurn);
//  - the verb must govern the object (imperative position, same clause,
//    short plain-word gap) — no anywhere-co-occurrence.
import { describe, expect, it } from "bun:test";
import { compileRunContract, detectActionNeed } from "../../src/kernel/contract/run-contract.js";
import { extractCurrentTurn } from "../../src/kernel/contract/current-turn.js";
import { assessActionSatisfiability } from "../../src/kernel/contract/satisfiability.js";
import { fenceRecalledMemory } from "../../src/strategies/memory-fence.js";

// Recorded Cortex shape (trace 01M5B7HPXACPCV136FDPB0M3RG, abbreviated memory).
const MEMORY = [
  "## (0.90) [robustness, ai-agents, error-handling]",
  "The framework is designed to handle complex real-world issues, including malformed tool calls",
  "## (0.90) [task-definition, user-input, clarification]",
  "To proceed, the user must define the specific task goal related to the files or directory structure.",
].join("\n");
const XRP_TASK =
  "--- Conversation history ---\n" +
  "User: Can you help me convert ./shot.png to a jpg?\n" +
  "Assistant: I cannot convert images directly.\n\n" +
  "--- Current message ---\n" +
  "get the price of xrp\n\n" +
  `Prior context (from earlier work on this task):\n${fenceRecalledMemory(MEMORY)}`;

const actionIds = (task: string): string[] =>
  compileRunContract(task).requirements.filter((r) => r.kind === "action-required").map((r) => r.id);

describe("truth item 1 — phantom action requirements", () => {
  it("Cortex xrp shape: memory text never compiles an action requirement", () => {
    expect(actionIds(XRP_TASK)).toEqual([]);
  });

  it("the current turn excludes trailing prior-context and recalled-memory blocks", () => {
    expect(extractCurrentTurn(XRP_TASK).text.trim()).toBe("get the price of xrp");
    const bare = `Find the price of xrp\n\n${fenceRecalledMemory(MEMORY)}`;
    const t = extractCurrentTurn(bare);
    expect(t.text).toBe("Find the price of xrp");
    expect(t.offset).toBe(0);
    expect(t.historyStripped).toBe(false);
  });

  it("co-occurrence without government compiles nothing (recorded false positives)", () => {
    // memory text as if it were the task: "files" (subject's verb) … "issues"
    expect(detectActionNeed(MEMORY)).toBeUndefined();
    // lh-debug-green: "bug" … "test file" (noun), object before verb
    expect(
      detectActionNeed(
        "Fix the bug in each module in place. Do not edit the tests. You are done only when every test file passes.",
      ),
    ).toBeUndefined();
    // "text" is a noun here, not an imperative verb
    expect(detectActionNeed("Write a short text for the team newsletter into news.md")).toBeUndefined();
    // the object sits in another clause
    expect(detectActionNeed("Open the file report.md and summarize the issues it lists.")).toBeUndefined();
  });

  it("a governed action in the user's own message is kept", () => {
    expect(detectActionNeed("File a bug for the login crash")?.capability).toBe("create-ticket");
    expect(detectActionNeed("Please file a bug for the login crash")?.capability).toBe("create-ticket");
    expect(detectActionNeed("Restart the worker, then send a message to the on-call team")?.capability).toBe(
      "send-message",
    );
    expect(detectActionNeed("Email Bob the weekly report")?.capability).toBe("send-message");
    const task = `${XRP_TASK.split("--- Current message ---")[0]}--- Current message ---\nFile a bug for the login crash`;
    expect(actionIds(task)).toEqual(["action:create-ticket"]);
  });

  it("the iteration-0 abstain path no longer fires on the xrp shape", () => {
    const verdict = assessActionSatisfiability({
      contract: compileRunContract(XRP_TASK),
      task: XRP_TASK,
      availableSchemas: [{ name: "web-search", description: "Search the web", parameters: [] }],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });
});
