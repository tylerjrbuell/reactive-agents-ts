import { describe, it, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";
import type { AnswerPolicyOptions } from "../src/builder/types.js";

describe(".withAnswerPolicy", () => {
  it("stores requireCitations mode on the builder config", () => {
    const builder = new ReactiveAgentBuilder().withAnswerPolicy({ requireCitations: "block" });
    const stored = (
      builder as unknown as { _answerPolicyConfig?: AnswerPolicyOptions }
    )._answerPolicyConfig;
    expect(stored?.requireCitations).toBe("block");
  });

  it("returns `this` for chaining", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withAnswerPolicy({ requireCitations: "warn" });
    expect(result).toBe(builder);
  });

  it("supports the warn mode", () => {
    const builder = new ReactiveAgentBuilder().withAnswerPolicy({ requireCitations: "warn" });
    const stored = (
      builder as unknown as { _answerPolicyConfig?: AnswerPolicyOptions }
    )._answerPolicyConfig;
    expect(stored?.requireCitations).toBe("warn");
  });
});
