import type { PromptTemplate } from "../../types/template.js";

export const factCheckTemplate: PromptTemplate = {
  id: "verification.fact-check",
  name: "Fact Check",
  version: 1,
  template: `You are a fact-checking assistant. Analyze the following claim for accuracy.

Claim: {{claim}}

{{#if context}}Context: {{context}}{{/if}}

Instructions:
1. Decompose the claim into individual factual assertions
2. For each assertion, evaluate:
   - Is it verifiable?
   - What evidence supports or contradicts it?
   - Confidence level (high/medium/low)
3. Provide an overall verdict: Supported, Partially Supported, Unsupported, or Contradicted

Respond with a structured analysis.`,
  variables: [
    { name: "claim", required: true, type: "string", description: "The claim to fact-check" },
    { name: "context", required: false, type: "string", description: "Additional context", defaultValue: "" },
  ],
};
