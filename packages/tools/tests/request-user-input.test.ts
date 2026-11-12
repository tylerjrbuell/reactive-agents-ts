import { describe, expect, test } from "bun:test";
import {
  requestUserInputTool,
  REQUEST_USER_INPUT_TOOL_NAME,
} from "../src/skills/request-user-input.js";

describe("request_user_input tool definition", () => {
  test("name and shape", () => {
    expect(REQUEST_USER_INPUT_TOOL_NAME).toBe("request_user_input");
    expect(requestUserInputTool.name).toBe("request_user_input");
    expect(requestUserInputTool.description.length).toBeGreaterThan(20);
  });

  test("description holds for both live and durable answering paths", () => {
    // A live answer continues the same run, so the model must not be told it suspends durably.
    expect(requestUserInputTool.description).not.toContain("durabl");
    expect(requestUserInputTool.description).toContain(
      "The run waits until the user responds; their response arrives as this tool's result.",
    );
  });

  test("schema declares kind/prompt/schema params", () => {
    const json = JSON.stringify(requestUserInputTool);
    expect(json).toContain("kind");
    expect(json).toContain("prompt");
    expect(json).toContain("schema");
  });

  test("declares the questions param and keeps description short", () => {
    expect(requestUserInputTool.parameters.map((p) => p.name)).toContain("questions");
    expect(requestUserInputTool.parameters.every((p) => p.required === false)).toBe(true);
    expect(requestUserInputTool.description.length).toBeLessThan(900);
  });
});
