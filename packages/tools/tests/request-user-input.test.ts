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

  test("schema declares kind/prompt/schema params", () => {
    const json = JSON.stringify(requestUserInputTool);
    expect(json).toContain("kind");
    expect(json).toContain("prompt");
    expect(json).toContain("schema");
  });
});
