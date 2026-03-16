/**
 * Error type tests — verify tagged error structures and properties.
 */
import { describe, test, expect } from "bun:test";
import {
  PromptError,
  TemplateNotFoundError,
  VariableError,
} from "../src/errors/errors.js";

describe("PromptError", () => {
  test("has correct tag", () => {
    const err = new PromptError({ message: "something went wrong" });
    expect(err._tag).toBe("PromptError");
    expect(err.message).toBe("something went wrong");
  });

  test("includes optional templateId", () => {
    const err = new PromptError({ message: "fail", templateId: "test.tpl" });
    expect(err.templateId).toBe("test.tpl");
  });

  test("includes optional cause", () => {
    const cause = new Error("root cause");
    const err = new PromptError({ message: "wrapped", cause });
    expect(err.cause).toBe(cause);
  });
});

describe("TemplateNotFoundError", () => {
  test("has correct tag", () => {
    const err = new TemplateNotFoundError({ templateId: "missing.tpl" });
    expect(err._tag).toBe("TemplateNotFoundError");
    expect(err.templateId).toBe("missing.tpl");
  });

  test("includes optional version", () => {
    const err = new TemplateNotFoundError({ templateId: "tpl", version: 3 });
    expect(err.version).toBe(3);
  });
});

describe("VariableError", () => {
  test("has correct tag and fields", () => {
    const err = new VariableError({
      templateId: "my.tpl",
      variableName: "task",
      message: "Required variable missing",
    });
    expect(err._tag).toBe("VariableError");
    expect(err.templateId).toBe("my.tpl");
    expect(err.variableName).toBe("task");
    expect(err.message).toBe("Required variable missing");
  });
});
