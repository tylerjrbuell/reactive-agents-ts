/**
 * Template compilation tests — verify all built-in templates register,
 * compile, and estimate tokens without errors.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  allBuiltinTemplates,
  interpolate,
  estimateTokens,
  PromptService,
  createPromptLayer,
} from "../src/index.js";

describe("Template Compilation", () => {
  it("all built-in templates exist and have valid structure", () => {
    expect(allBuiltinTemplates.length).toBeGreaterThanOrEqual(20);

    for (const template of allBuiltinTemplates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(typeof template.version).toBe("number");
      expect(template.version).toBeGreaterThanOrEqual(1);
      expect(template.template).toBeTruthy();
      expect(Array.isArray(template.variables)).toBe(true);
    }
  });

  it("each template compiles with dummy variables", async () => {
    for (const template of allBuiltinTemplates) {
      const dummyVars: Record<string, unknown> = {};
      for (const v of template.variables) {
        switch (v.type) {
          case "string":
            dummyVars[v.name] = "test-value";
            break;
          case "number":
            dummyVars[v.name] = 42;
            break;
          case "boolean":
            dummyVars[v.name] = true;
            break;
          case "array":
            dummyVars[v.name] = ["item1", "item2"];
            break;
          case "object":
            dummyVars[v.name] = { key: "value" };
            break;
        }
      }

      const result = await Effect.runPromise(
        interpolate(template, dummyVars),
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      // Should not contain unresolved required variables
      for (const v of template.variables) {
        if (v.required) {
          expect(result).not.toContain(`{{${v.name}}}`);
        }
      }
    }
  });

  it("token estimation returns reasonable values", () => {
    for (const template of allBuiltinTemplates) {
      const estimate = estimateTokens(template.template);
      expect(estimate).toBeGreaterThan(0);
      // Token estimate should be roughly 1/4 of character count (±factor of 3)
      const charCount = template.template.length;
      expect(estimate).toBeLessThan(charCount); // fewer tokens than chars
    }
  });

  it("PromptService registers all built-in templates", async () => {
    const program = Effect.gen(function* () {
      const prompts = yield* PromptService;

      // Try to compile each built-in template
      for (const template of allBuiltinTemplates) {
        const dummyVars: Record<string, unknown> = {};
        for (const v of template.variables) {
          if (v.type === "string") dummyVars[v.name] = "test";
          else if (v.type === "number") dummyVars[v.name] = 1;
          else if (v.type === "boolean") dummyVars[v.name] = true;
          else if (v.type === "array") dummyVars[v.name] = ["a"];
          else if (v.type === "object") dummyVars[v.name] = {};
        }

        const compiled = yield* prompts.compile(template.id, dummyVars);
        expect(compiled.content).toBeTruthy();
        expect(compiled.tokenEstimate).toBeGreaterThan(0);
        expect(compiled.templateId).toBe(template.id);
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(createPromptLayer())));
  });

  it("templates have unique IDs", () => {
    const ids = allBuiltinTemplates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("template variables have valid types", () => {
    const validTypes = ["string", "number", "boolean", "array", "object"];
    for (const template of allBuiltinTemplates) {
      for (const v of template.variables) {
        expect(validTypes).toContain(v.type);
        expect(v.name).toBeTruthy();
        expect(typeof v.required).toBe("boolean");
      }
    }
  });
});
