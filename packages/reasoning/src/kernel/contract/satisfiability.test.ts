// Run: bun test packages/reasoning/src/kernel/contract/satisfiability.test.ts --timeout 15000
//
// GH #244 satisfiability preflight — pure-function pins.
//
// A task that requires an EXTERNAL ACTION (send a message, open a ticket, ...)
// must compile an `action-required` requirement carrying the capability it
// needs, so the harness can check it against the tool surface at iteration 0
// instead of looping until the zero-evidence stand-down fires at iteration 2.
//
// Boundary law: information verbs (search/read/fetch/summarize) and bare
// questions NEVER compile an action requirement — the model can answer those
// from weights, so there is no capability to be missing.
import { describe, expect, it } from "bun:test";
import {
  compileRunContract,
  detectActionNeed,
} from "./run-contract.js";
import { assessActionSatisfiability } from "./satisfiability.js";
import type { ToolSchema } from "../capabilities/attend/tool-formatting.js";

const SLACK_TASK = "Send a slack message to #general saying 'Hello team'";

const schema = (name: string, description: string): ToolSchema => ({
  name,
  description,
  parameters: [],
});

describe("GH #244 — action-need detection (task text only)", () => {
  it("RED: a messaging task compiles an action-required requirement carrying its capability", () => {
    const contract = compileRunContract(SLACK_TASK, {});
    const actions = contract.requirements.filter((r) => r.kind === "action-required");
    expect(actions.length).toBe(1);
    expect(actions[0]!.id).toBe("action:send-message");
    expect(actions[0]!.spec.description.toLowerCase()).toContain("send-message");
  });

  it("detectActionNeed names the capability for a ticket task", () => {
    const need = detectActionNeed("Open a bug ticket for the login crash");
    expect(need?.capability).toBe("create-ticket");
  });

  it("a bare question compiles NO action requirement", () => {
    expect(detectActionNeed("What is the capital of France?")).toBeUndefined();
    const contract = compileRunContract("What is the capital of France?", {});
    expect(contract.requirements.some((r) => r.kind === "action-required")).toBe(false);
  });

  it("information verbs are NOT action needs (search/read/summarize answer from weights or try tools)", () => {
    expect(detectActionNeed("Search the web for the current price of XRP")).toBeUndefined();
    expect(detectActionNeed("Read ./notes.md and summarize it")).toBeUndefined();
    expect(detectActionNeed("Summarize recent AI news")).toBeUndefined();
  });

  it("a question ABOUT an action is still a question (conservative: no preflight)", () => {
    expect(detectActionNeed("How do I send a slack message?")).toBeUndefined();
    expect(detectActionNeed("Can you send a slack message to #general?")).toBeUndefined();
  });

  it("file-write tasks stay artifact-produced (no double requirement)", () => {
    const contract = compileRunContract("Write a haiku about spring to ./haiku.md", {});
    expect(contract.requirements.some((r) => r.kind === "action-required")).toBe(false);
    expect(contract.requirements.some((r) => r.id === "artifact:./haiku.md")).toBe(true);
  });
});

describe("GH #244 — satisfiability assessment (contract × tool surface)", () => {
  const slackContract = () => compileRunContract(SLACK_TASK, {});

  it("zero relevant tools + action requirement → UNSATISFIABLE with a named capability reason listing available tools", () => {
    // NOTE: file-read is (correctly per the shared ranking) "relevant" to
    // almost any task — the keyword expansion maps single letters onto its
    // description words. crypto-price is genuinely irrelevant, the
    // unsatisfiable shape.
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: [schema("crypto-price", "current market value of digital coins")],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toContain("send-message");
    expect(verdict!.reason).toContain("crypto-price");
    expect(verdict!.missing).toEqual(["capability:send-message"]);
  });

  it("a capable tool on the surface → SATISFIABLE (null), no preflight misfire", () => {
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: [
        schema("file-read", "read content from a file"),
        schema("slack-post", "Send messages to Slack channels"),
      ],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });

  it("a tool NAMED in the task is relevant even when its description is terse", () => {
    const task = "Send a slack message via webhook-relay to #general";
    const verdict = assessActionSatisfiability({
      contract: compileRunContract(task, {}),
      task,
      availableSchemas: [schema("webhook-relay", "relay")],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });

  it("unknown surface (schemas undefined) → null (cannot judge; stand-down still owns it)", () => {
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: undefined,
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });

  it("empty surface (no ToolService wired) is unknown, not proof of tool-lessness → null", () => {
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: [],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });

  it("declared required tools → null (the required-tools guard owns that path)", () => {
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: [schema("file-read", "read content from a file")],
      requiredTools: ["slack-post"],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });

  it("a nominated plausible tool → null (another path exists)", () => {
    const verdict = assessActionSatisfiability({
      contract: slackContract(),
      task: SLACK_TASK,
      availableSchemas: [schema("file-read", "read content from a file")],
      requiredTools: [],
      nominatedNames: ["slack-post"],
    });
    expect(verdict).toBeNull();
  });

  it("reasoning-only question with an impoverished surface → null (unaffected)", () => {
    const task = "What is the capital of France?";
    const verdict = assessActionSatisfiability({
      contract: compileRunContract(task, {}),
      task,
      availableSchemas: [schema("file-read", "read content from a file")],
      requiredTools: [],
      nominatedNames: [],
    });
    expect(verdict).toBeNull();
  });
});
