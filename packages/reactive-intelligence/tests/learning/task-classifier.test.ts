import { describe, expect, test } from "bun:test";
import { classifyTaskCategory } from "../../src/learning/task-classifier.js";

describe("classifyTaskCategory", () => {
  test("code-write: 'Write a Python function'", () => {
    expect(classifyTaskCategory("Write a Python function")).toBe("code-write");
  });

  test("code-debug: 'Fix the authentication bug'", () => {
    expect(classifyTaskCategory("Fix the authentication bug")).toBe("code-debug");
  });

  test("quick-lookup: 'Explore what is known about climate change'", () => {
    expect(classifyTaskCategory("Explore what is known about climate change")).toBe("quick-lookup");
  });

  test("data-analysis: 'Analyze the sales data'", () => {
    expect(classifyTaskCategory("Analyze the sales data")).toBe("data-analysis");
  });

  test("communication: 'Send a Signal message'", () => {
    expect(classifyTaskCategory("Send a Signal message")).toBe("communication");
  });

  test("multi-step: 'Fetch commits, summarize, and send a message'", () => {
    expect(classifyTaskCategory("Fetch commits, summarize, and send a message")).toBe("multi-step");
  });

  test("general: 'Hello'", () => {
    expect(classifyTaskCategory("Hello")).toBe("general");
  });

  test("case insensitive: 'WRITE A FUNCTION'", () => {
    expect(classifyTaskCategory("WRITE A FUNCTION")).toBe("code-write");
  });

  test("deep-research: 'Investigate the root cause'", () => {
    expect(classifyTaskCategory("Investigate the root cause")).toBe("deep-research");
  });

  test("multi-step: 'Search for data and create a report'", () => {
    expect(classifyTaskCategory("Search for data and create a report")).toBe("multi-step");
  });

  test("communication: 'Email the team about the update'", () => {
    expect(classifyTaskCategory("Email the team about the update")).toBe("communication");
  });

  test("general: empty string", () => {
    expect(classifyTaskCategory("")).toBe("general");
  });
});
