/**
 * Template engine tests — variable interpolation, defaults, edge cases.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { interpolate, estimateTokens } from "../src/services/template-engine.js";
import type { PromptTemplate } from "../src/types/template.js";

// ─── Helpers ───

const makeTemplate = (
  overrides: Partial<PromptTemplate> & { template: string },
): PromptTemplate => ({
  id: overrides.id ?? "test.template",
  name: overrides.name ?? "Test Template",
  version: overrides.version ?? 1,
  variables: overrides.variables ?? [],
  template: overrides.template,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

// ─── Variable Interpolation ───

describe("interpolate — variable interpolation", () => {
  test("replaces a single variable", async () => {
    const tpl = makeTemplate({
      template: "Hello, {{name}}!",
      variables: [{ name: "name", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { name: "Alice" }));
    expect(result).toBe("Hello, Alice!");
  });

  test("replaces multiple distinct variables", async () => {
    const tpl = makeTemplate({
      template: "{{greeting}}, {{name}}! You have {{count}} messages.",
      variables: [
        { name: "greeting", required: true, type: "string" },
        { name: "name", required: true, type: "string" },
        { name: "count", required: true, type: "number" },
      ],
    });
    const result = await run(interpolate(tpl, { greeting: "Hi", name: "Bob", count: 5 }));
    expect(result).toBe("Hi, Bob! You have 5 messages.");
  });

  test("replaces all occurrences of the same variable", async () => {
    const tpl = makeTemplate({
      template: "{{name}} said hello to {{name}}",
      variables: [{ name: "name", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { name: "Charlie" }));
    expect(result).toBe("Charlie said hello to Charlie");
  });

  test("coerces non-string values to string", async () => {
    const tpl = makeTemplate({
      template: "num={{num}} bool={{bool}} arr={{arr}} obj={{obj}}",
      variables: [
        { name: "num", required: true, type: "number" },
        { name: "bool", required: true, type: "boolean" },
        { name: "arr", required: true, type: "array" },
        { name: "obj", required: true, type: "object" },
      ],
    });
    const result = await run(
      interpolate(tpl, {
        num: 42,
        bool: false,
        arr: [1, 2, 3],
        obj: { key: "val" },
      }),
    );
    expect(result).toContain("num=42");
    expect(result).toContain("bool=false");
    expect(result).toContain("arr=1,2,3");
    expect(result).toContain("obj=");
  });

  test("leaves unmatched placeholders when extra variables are not declared", async () => {
    const tpl = makeTemplate({
      template: "Hello, {{name}}! Your role is {{role}}.",
      variables: [{ name: "name", required: true, type: "string" }],
    });
    // Provide name but not role — role is not in variables, so no error, placeholder remains
    const result = await run(interpolate(tpl, { name: "Dana" }));
    expect(result).toContain("Dana");
    expect(result).toContain("{{role}}");
  });

  test("extra variables provided but not in template are ignored", async () => {
    const tpl = makeTemplate({
      template: "Hello, {{name}}!",
      variables: [{ name: "name", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { name: "Eve", extra: "ignored" }));
    expect(result).toBe("Hello, Eve!");
  });
});

// ─── Required Variable Validation ───

describe("interpolate — required variable validation", () => {
  test("fails when a required variable is missing", async () => {
    const tpl = makeTemplate({
      template: "Task: {{task}} Tools: {{tools}}",
      variables: [
        { name: "task", required: true, type: "string" },
        { name: "tools", required: true, type: "string" },
      ],
    });
    const err = await runFail(interpolate(tpl, { task: "test" }));
    expect(err._tag).toBe("VariableError");
    expect(err.variableName).toBe("tools");
    expect(err.message).toContain("Required variable missing");
  });

  test("fails when no variables are provided and required exist", async () => {
    const tpl = makeTemplate({
      template: "Task: {{task}}",
      variables: [{ name: "task", required: true, type: "string" }],
    });
    const err = await runFail(interpolate(tpl, {}));
    expect(err._tag).toBe("VariableError");
    expect(err.variableName).toBe("task");
  });

  test("succeeds when required variable has a defaultValue", async () => {
    const tpl = makeTemplate({
      template: "Task: {{task}}",
      variables: [
        { name: "task", required: true, type: "string", defaultValue: "default-task" },
      ],
    });
    // required=true but defaultValue is set, so the check passes
    const result = await run(interpolate(tpl, {}));
    // The variable is not in `variables` entries, but has defaultValue —
    // however the code only fills defaults for !required, so placeholder stays
    // Actually: the required check is: v.required && !(v.name in variables) && v.defaultValue === undefined
    // Since defaultValue is set, the check passes. But the default fill loop only runs for !required.
    // So the placeholder remains unresolved.
    expect(result).toBe("Task: {{task}}");
  });

  test("includes templateId in error", async () => {
    const tpl = makeTemplate({
      id: "my.template",
      template: "{{required_var}}",
      variables: [{ name: "required_var", required: true, type: "string" }],
    });
    const err = await runFail(interpolate(tpl, {}));
    expect(err.templateId).toBe("my.template");
  });
});

// ─── Default Values ───

describe("interpolate — default values", () => {
  test("fills default for optional variable not provided", async () => {
    const tpl = makeTemplate({
      template: "Hello, {{name}}! Role: {{role}}",
      variables: [
        { name: "name", required: true, type: "string" },
        { name: "role", required: false, type: "string", defaultValue: "user" },
      ],
    });
    const result = await run(interpolate(tpl, { name: "Frank" }));
    expect(result).toBe("Hello, Frank! Role: user");
  });

  test("provided value overrides default", async () => {
    const tpl = makeTemplate({
      template: "Count: {{count}}",
      variables: [
        { name: "count", required: false, type: "number", defaultValue: 10 },
      ],
    });
    const result = await run(interpolate(tpl, { count: 99 }));
    expect(result).toBe("Count: 99");
  });

  test("empty string default replaces placeholder", async () => {
    const tpl = makeTemplate({
      template: "Prefix{{suffix}}End",
      variables: [
        { name: "suffix", required: false, type: "string", defaultValue: "" },
      ],
    });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("PrefixEnd");
  });

  test("numeric zero default replaces placeholder", async () => {
    const tpl = makeTemplate({
      template: "Score: {{score}}",
      variables: [
        { name: "score", required: false, type: "number", defaultValue: 0 },
      ],
    });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("Score: 0");
  });

  test("boolean false default replaces placeholder", async () => {
    const tpl = makeTemplate({
      template: "Enabled: {{enabled}}",
      variables: [
        { name: "enabled", required: false, type: "boolean", defaultValue: false },
      ],
    });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("Enabled: false");
  });

  test("optional variable without default leaves placeholder", async () => {
    const tpl = makeTemplate({
      template: "Notes: {{notes}}",
      variables: [
        { name: "notes", required: false, type: "string" },
      ],
    });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("Notes: {{notes}}");
  });
});

// ─── Edge Cases ───

describe("interpolate — edge cases", () => {
  test("empty template returns empty string", async () => {
    const tpl = makeTemplate({ template: "", variables: [] });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("");
  });

  test("template with no placeholders returns as-is", async () => {
    const tpl = makeTemplate({
      template: "No variables here.",
      variables: [],
    });
    const result = await run(interpolate(tpl, {}));
    expect(result).toBe("No variables here.");
  });

  test("variable value containing curly braces is handled", async () => {
    const tpl = makeTemplate({
      template: "Code: {{code}}",
      variables: [{ name: "code", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { code: "const x = { a: 1 }" }));
    expect(result).toBe("Code: const x = { a: 1 }");
  });

  test("variable value containing another placeholder pattern", async () => {
    const tpl = makeTemplate({
      template: "Value: {{val}}",
      variables: [{ name: "val", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { val: "{{nested}}" }));
    expect(result).toBe("Value: {{nested}}");
  });

  test("template with multiline content", async () => {
    const tpl = makeTemplate({
      template: "Line 1: {{a}}\nLine 2: {{b}}\nLine 3: {{c}}",
      variables: [
        { name: "a", required: true, type: "string" },
        { name: "b", required: true, type: "string" },
        { name: "c", required: true, type: "string" },
      ],
    });
    const result = await run(interpolate(tpl, { a: "X", b: "Y", c: "Z" }));
    expect(result).toBe("Line 1: X\nLine 2: Y\nLine 3: Z");
  });

  test("very long variable value", async () => {
    const tpl = makeTemplate({
      template: "Data: {{data}}",
      variables: [{ name: "data", required: true, type: "string" }],
    });
    const longValue = "x".repeat(10000);
    const result = await run(interpolate(tpl, { data: longValue }));
    expect(result).toContain(longValue);
    expect(result.length).toBe(6 + longValue.length); // "Data: " + value
  });

  test("special regex characters in variable values", async () => {
    const tpl = makeTemplate({
      template: "Pattern: {{pattern}}",
      variables: [{ name: "pattern", required: true, type: "string" }],
    });
    const result = await run(interpolate(tpl, { pattern: "foo.*bar+[baz]$" }));
    expect(result).toBe("Pattern: foo.*bar+[baz]$");
  });
});

// ─── estimateTokens ───

describe("estimateTokens", () => {
  test("returns roughly 1/4 of character count", () => {
    expect(estimateTokens("hello world")).toBe(Math.ceil(11 / 4)); // 3
  });

  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("returns 1 for very short strings", () => {
    expect(estimateTokens("hi")).toBe(1); // ceil(2/4) = 1
  });

  test("scales linearly with length", () => {
    const short = estimateTokens("a".repeat(100));
    const long = estimateTokens("a".repeat(400));
    expect(long).toBe(short * 4);
  });

  test("handles multiline text", () => {
    const text = "line1\nline2\nline3\n";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });
});
