import { describe, expect, test } from "bun:test";
import { Either } from "effect";
import { foldAdvisory, type AdvisoryItem, type ChecklistItemFact } from "@reactive-agents/core";
import { requestUserInputTool } from "../src/skills/request-user-input.js";
import { applyTodoChecklistAction } from "../src/skills/todo.js";
import { toParameterJsonSchema } from "../src/function-calling/parameter-json-schema.js";
import {
  QUESTIONS_EXAMPLE,
  QUESTION_TYPES,
  QuestionSchema,
  parseRequest,
  questionItemJsonSchema,
} from "../src/skills/user-input-questions.js";

describe("request_user_input questions item schema (seam)", () => {
  const questions = requestUserInputTool.parameters.find((p) => p.name === "questions");

  test("the questions parameter carries the item schema on the wire", () => {
    const wire = toParameterJsonSchema(questions!);
    expect(wire.items?.type).toBe("object");
    expect(wire.items?.required).toEqual(["id", "prompt", "type"]);
    const props = wire.items?.properties as Record<string, { enum?: readonly string[] }>;
    expect(props.type?.enum).toEqual([...QUESTION_TYPES]);
    expect(Object.keys(props)).toContain("options");
  });

  test("drift: the schema's property set and required set equal QuestionSchema's fields", () => {
    const item = questionItemJsonSchema();
    const fields = Object.keys(QuestionSchema.fields).sort();
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(fields);
    expect([...(item.required ?? [])].sort()).toEqual(["id", "prompt", "type"]);
  });

  test("the example in the rejection text is itself a valid call", () => {
    expect(Either.isRight(parseRequest(JSON.parse(QUESTIONS_EXAMPLE)))).toBe(true);
  });
});

describe("parseRequest healing of the live mixed call", () => {
  const live = {
    prompt: "Which approach should the plan take?",
    kind: "choice",
    questions: [{ options: ["Fast", "Thorough"], type: "choice" }],
  };

  test("promotes prompt, synthesizes id, maps type and string options", () => {
    const r = parseRequest(live);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isLeft(r)) return;
    expect(r.right.questions[0]).toMatchObject({
      id: "q1",
      prompt: "Which approach should the plan take?",
      type: "single-choice",
      options: [{ label: "Fast", value: "Fast" }, { label: "Thorough", value: "Thorough" }],
    });
  });

  test("type implied by options when omitted", () => {
    const r = parseRequest({ questions: [{ id: "a", prompt: "p", options: ["x"] }] });
    expect(Either.isRight(r) && r.right.questions[0]?.type).toBe("single-choice");
  });

  test("a well-formed call is untouched", () => {
    const q = { id: "a", prompt: "p", type: "boolean" };
    const r = parseRequest({ questions: [q] });
    expect(Either.isRight(r) && r.right.questions[0]).toMatchObject(q);
  });

  test("ambiguous calls are still rejected, with the valid example", () => {
    // two questions, neither has a prompt: the top-level prompt cannot be promoted
    const two = parseRequest({ prompt: "p", questions: [{ type: "text" }, { type: "text" }] });
    expect(Either.isLeft(two)).toBe(true);
    if (Either.isLeft(two)) expect(two.left).toContain(QUESTIONS_EXAMPLE);
    // unknown type, no way to infer it
    expect(Either.isLeft(parseRequest({ questions: [{ id: "a", prompt: "p", type: "bogus" }] }))).toBe(true);
    // choice with no options stays invalid
    expect(Either.isLeft(parseRequest({ questions: [{ id: "a", prompt: "p", type: "choice" }] }))).toBe(true);
  });
});

describe("todo edit with items[] (live failure)", () => {
  function session(titles: readonly string[]) {
    const facts: ChecklistItemFact[] = [];
    let seq = 0;
    const run = (args: Record<string, unknown>) => {
      const r = applyTodoChecklistAction(foldAdvisory(facts), args, "execute", facts.map((f) => f.change));
      for (const c of r.changes) facts.push({ kind: "checklist-item", seq: ++seq, iteration: 1, change: c });
      return r;
    };
    run({ action: "add", items: titles });
    return { run, items: (): readonly AdvisoryItem[] => foldAdvisory(facts) };
  }

  test("items:[{id,text}] renames each item", () => {
    const s = session(["one", "two", "three"]);
    const r = s.run({ action: "edit", items: [{ id: 1, text: "uno" }, { id: "3", title: "tres" }] });
    expect(r.ok).toBe(true);
    expect(s.items().map((i) => i.title)).toEqual(["uno", "two", "tres"]);
  });

  test("items of bare strings without an id names the accepted shapes", () => {
    const s = session(["one", "two"]);
    const r = s.run({ action: "edit", items: ["new a", "new b"] });
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain(`todo({action:"edit", id:N, text:"new title"})`);
    expect(r.rendered).toContain(`items:[{id:N, text:"new title"}`);
    expect(s.items().map((i) => i.title)).toEqual(["one", "two"]);
  });

  test("top-level id+text still wins over items", () => {
    const s = session(["one"]);
    s.run({ action: "edit", id: 1, text: "uno" });
    expect(s.items()[0]?.title).toBe("uno");
  });
});
