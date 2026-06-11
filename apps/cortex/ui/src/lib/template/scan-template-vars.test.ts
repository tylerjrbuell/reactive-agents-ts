import { describe, test, expect } from "bun:test";
import { scanTemplateVars } from "./scan-template-vars.js";

describe("scanTemplateVars", () => {
  test("collects tokens from all string fields, deduped", () => {
    const cfg = {
      prompt: "Summarize {{topic}} for {{audience}}",
      systemPrompt: "Tone for {{audience}}",
      taskContext: { env: "{{env}}" },
      maxTokens: 512,
    };
    expect(scanTemplateVars(cfg).sort()).toEqual(["audience", "env", "topic"]);
  });

  test("excludes the secret namespace", () => {
    expect(scanTemplateVars({ prompt: "{{a}} {{secret.K}}" })).toEqual(["a"]);
  });

  test("whitespace tolerant", () => {
    expect(scanTemplateVars({ p: "{{  x  }}" })).toEqual(["x"]);
  });

  test("no tokens → empty", () => {
    expect(scanTemplateVars({ prompt: "plain" })).toEqual([]);
  });
});
