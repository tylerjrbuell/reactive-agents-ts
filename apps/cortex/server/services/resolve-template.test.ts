import { describe, test, expect } from "bun:test";
import { resolveTemplate, scanTokens, type VariableDef } from "./resolve-template.js";

const v = (over: Partial<VariableDef> & { name: string }): VariableDef => ({
  type: "string",
  required: true,
  ...over,
});

describe("resolveTemplate", () => {
  test("substitutes a value into a string field", () => {
    const r = resolveTemplate(
      { prompt: "Summarize {{topic}}" },
      [v({ name: "topic" })],
      { topic: "kernels" },
    );
    expect(r.value.prompt).toBe("Summarize kernels");
    expect(r.unresolved).toEqual([]);
  });

  test("falls back to default when no value supplied", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}" },
      [v({ name: "name", default: "world" })],
      {},
    );
    expect(r.value.prompt).toBe("Hi world");
    expect(r.unresolved).toEqual([]);
  });

  test("missing required with no default → unresolved, token left literal", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}" },
      [v({ name: "name" })],
      {},
    );
    expect(r.value.prompt).toBe("Hi {{name}}");
    expect(r.unresolved).toEqual(["name"]);
  });

  test("optional missing → empty string", () => {
    const r = resolveTemplate(
      { prompt: "Hi {{name}}!" },
      [v({ name: "name", required: false })],
      {},
    );
    expect(r.value.prompt).toBe("Hi !");
    expect(r.unresolved).toEqual([]);
  });

  test("unknown token (no VariableDef) → unresolved", () => {
    const r = resolveTemplate({ prompt: "{{ghost}}" }, [], {});
    expect(r.unresolved).toEqual(["ghost"]);
  });

  test("secret namespace → unresolved, left literal", () => {
    const r = resolveTemplate({ prompt: "key={{secret.API}}" }, [], {});
    expect(r.value.prompt).toBe("key={{secret.API}}");
    expect(r.unresolved).toEqual(["secret.API"]);
  });

  test("number value substituted as string", () => {
    const r = resolveTemplate(
      { prompt: "n={{count}}" },
      [v({ name: "count", type: "number" })],
      { count: 7 },
    );
    expect(r.value.prompt).toBe("n=7");
  });

  test("walks nested strings; leaves non-strings untouched; does not mutate input", () => {
    const input = {
      systemPrompt: "You are {{role}}",
      taskContext: { env: "{{env}}" },
      maxTokens: 512,
      nested: { deep: ["{{role}}", 1, true] },
    };
    const r = resolveTemplate(
      input,
      [v({ name: "role" }), v({ name: "env" })],
      { role: "an analyst", env: "prod" },
    );
    expect(r.value.systemPrompt).toBe("You are an analyst");
    expect(r.value.taskContext.env).toBe("prod");
    expect(r.value.maxTokens).toBe(512);
    expect(r.value.nested.deep).toEqual(["an analyst", 1, true]);
    expect(input.systemPrompt).toBe("You are {{role}}"); // unmutated
  });

  test("dedupes repeated unresolved tokens", () => {
    const r = resolveTemplate({ a: "{{x}}", b: "{{x}}" }, [], {});
    expect(r.unresolved).toEqual(["x"]);
  });

  test("whitespace-tolerant tokens", () => {
    const r = resolveTemplate({ p: "{{  topic  }}" }, [v({ name: "topic" })], { topic: "z" });
    expect(r.value.p).toBe("z");
  });

  test("falsy supplied value (0) is honored over default", () => {
    const r = resolveTemplate(
      { p: "n={{count}}" },
      [v({ name: "count", type: "number", default: 99 })],
      { count: 0 },
    );
    expect(r.value.p).toBe("n=0");
  });

  test("supplied empty string is honored (not treated as missing)", () => {
    const r = resolveTemplate(
      { p: "[{{x}}]" },
      [v({ name: "x" })],
      { x: "" },
    );
    expect(r.value.p).toBe("[]");
    expect(r.unresolved).toEqual([]);
  });
});

describe("scanTokens", () => {
  test("extracts and dedupes var tokens, excludes secret namespace", () => {
    expect(scanTokens("{{a}} {{a}} {{b}} {{secret.K}}")).toEqual(["a", "b"]);
  });
});
