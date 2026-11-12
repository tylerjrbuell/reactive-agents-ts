import { describe, it, expect } from "bun:test";
import type { InteractionQuestion, InteractionResponse } from "../src/index.js";

describe("InteractionQuestion", () => {
  it("accepts a full question and round-trips through JSON", () => {
    const q: InteractionQuestion = {
      id: "env",
      prompt: "Which environment?",
      type: "single-choice",
      options: [{ label: "Prod", value: "prod", description: "live" }, { label: "Dev", value: "dev" }],
      required: false,
      default: "dev",
      allowOther: true,
    };
    expect(JSON.parse(JSON.stringify(q))).toEqual(q);
  });

  it("legacy minimal question and id-keyed response stay valid", () => {
    const q: InteractionQuestion = { id: "a", prompt: "Name?", type: "text" };
    const r: InteractionResponse = { interactionId: "i1", valueJson: JSON.stringify({ [q.id]: "x" }) };
    expect(JSON.parse(r.valueJson)).toEqual({ a: "x" });
  });
});
