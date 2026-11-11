/**
 * Prompt-fragment contract. Lives under src/ so `tsc --noEmit` checks the
 * type-level assertions: each `Assignable<A, B>` constant is typed with the
 * literal it must equal, so a contract change that flips it fails typecheck.
 */
import { describe, test, expect } from "bun:test";
import {
  resolvePromptFragment,
  promptFragmentHash,
  promptFragmentText,
  type PromptFragmentDefinition,
  type PromptFragmentId,
  type PromptOverrides,
  type SerializablePromptOverrides,
  type ToolDescriptionFragmentId,
} from "../prompt-fragment.js";
import type { AgentEvent, AgentEventTag } from "../agent-event.js";
import type { PromptAssembledEvent } from "../events/harness-events.js";
import { sha256Hex } from "../../utils/sha256.js";

/** `true` when `A` is assignable to `B` (non-distributive). */
type Assignable<A, B> = [A] extends [B] ? true : false;

const finish: PromptFragmentDefinition<{ readonly tool: string }> = {
  id: "guidance.finish.no-contract",
  slot: "guidance",
  owner: "@reactive-agents/reasoning",
  summary: "Tells the model it may answer now.",
  render: ({ tool }) => [{ type: "text", text: `You called ${tool}. ` }, { type: "text", text: "Answer now." }],
};

describe("prompt-fragment types", () => {
  test("ids are dotted strings; undotted keys are rejected", () => {
    const id: PromptFragmentId = "tail.outstanding";
    const toolId: ToolDescriptionFragmentId = "tool.web-search.description";
    const asId: PromptFragmentId = toolId;
    const undotted: Assignable<"outstanding", PromptFragmentId> = false;
    const noSuffix: Assignable<"tool.web-search", ToolDescriptionFragmentId> = false;
    expect([id, asId, undotted, noSuffix].length).toBe(4);
  });

  test("override map: string replaces, null disables, transform sees the default", () => {
    const overrides: PromptOverrides = {
      "guidance.finish.no-contract": null,
      "tail.outstanding": "Still open: the report.",
      "exit-gate.deny": (ctx) => (ctx.slot === "tail" ? ctx.defaultText.toUpperCase() : undefined),
    };
    const numberTransform: Assignable<{ "exit-gate.deny": () => number }, PromptOverrides> = false;
    // Limitation: undotted keys are rejected only in fresh object literals (excess-property
    // check); a pre-built object type passes. The config surface must warn on unknown ids.
    const undottedKey: Assignable<{ outstanding: string }, PromptOverrides> = true;
    expect(Object.keys(overrides).length).toBe(3);
    expect([numberTransform, undottedKey]).toEqual([false, true]);
  });

  test("serialisable overrides refuse transforms", () => {
    const ok: SerializablePromptOverrides = { "tail.outstanding": "x", "guidance.loop": null };
    const transform: Assignable<{ "tail.outstanding": () => string }, SerializablePromptOverrides> = false;
    const widened: PromptOverrides = ok;
    expect([ok, transform, widened].length).toBe(3);
  });

  test("PromptAssembled is an AgentEvent member", () => {
    const tag: AgentEventTag = "PromptAssembled";
    const event: AgentEvent = {
      _tag: "PromptAssembled",
      taskId: "t1",
      iteration: 2,
      fragments: [
        { id: "tail.outstanding", slot: "tail", status: "overridden", hash: "h", defaultHash: "d", chars: 22 },
        { id: "guidance.finish.no-contract", slot: "guidance", status: "disabled", defaultHash: "d2", chars: 0 },
      ],
      toolDescriptions: [{ name: "web-search", hash: "h3", chars: 120, status: "default" }],
      timestamp: 0,
    };
    const minimal: PromptAssembledEvent = { _tag: "PromptAssembled", taskId: "t", iteration: 0, fragments: [], timestamp: 0 };
    expect(event._tag).toBe(tag);
    expect(minimal.toolDescriptions).toBeUndefined();
  });
});

describe("resolvePromptFragment", () => {
  const vars = { tool: "web-search" } as const;

  test("no overrides: default content, status default", () => {
    const r = resolvePromptFragment(finish, vars, undefined);
    expect(r.status).toBe("default");
    expect(promptFragmentText(r.content)).toBe("You called web-search. Answer now.");
    expect(r.content).toEqual(r.defaultContent);
    expect(r.owner).toBe("@reactive-agents/reasoning");
  });

  test("string replaces verbatim", () => {
    const r = resolvePromptFragment(finish, vars, { "guidance.finish.no-contract": "Keep going." });
    expect(r.status).toBe("overridden");
    expect(r.content).toEqual([{ type: "text", text: "Keep going." }]);
    expect(promptFragmentText(r.defaultContent)).toBe("You called web-search. Answer now.");
  });

  test("null disables", () => {
    const r = resolvePromptFragment(finish, vars, { "guidance.finish.no-contract": null });
    expect(r.status).toBe("disabled");
    expect(r.content).toEqual([]);
  });

  test("transform gets id, slot, vars, default text; undefined passes through", () => {
    let seen: unknown;
    const r = resolvePromptFragment(finish, vars, {
      "guidance.finish.no-contract": (ctx) => {
        seen = ctx;
        return undefined;
      },
    });
    expect(seen).toEqual({
      id: "guidance.finish.no-contract",
      slot: "guidance",
      vars,
      defaultText: "You called web-search. Answer now.",
    });
    expect(r.status).toBe("default");
  });

  test("transform return string overrides, null disables", () => {
    const over = resolvePromptFragment(finish, vars, { "guidance.finish.no-contract": (c) => `${c.defaultText}!` });
    expect(promptFragmentText(over.content)).toBe("You called web-search. Answer now.!");
    const off = resolvePromptFragment(finish, vars, { "guidance.finish.no-contract": () => null });
    expect(off.status).toBe("disabled");
  });

  test("a throwing transform keeps the default and reports the error", () => {
    const r = resolvePromptFragment(finish, vars, {
      "guidance.finish.no-contract": () => {
        throw new Error("boom");
      },
    });
    expect(r.status).toBe("default");
    expect(r.overrideError).toBe("boom");
    expect(r.content).toEqual(r.defaultContent);
  });

  test("overrides for other ids do not apply", () => {
    const r = resolvePromptFragment(finish, vars, { "tail.outstanding": null });
    expect(r.status).toBe("default");
  });
});

describe("promptFragmentHash", () => {
  test("is sha256 of the joined text, independent of part split", () => {
    const split = promptFragmentHash([{ type: "text", text: "ab" }, { type: "text", text: "c" }]);
    expect(split).toBe(sha256Hex("abc"));
    expect(promptFragmentHash([{ type: "text", text: "abc" }])).toBe(split);
    expect(promptFragmentHash([])).toBe(sha256Hex(""));
  });
});
