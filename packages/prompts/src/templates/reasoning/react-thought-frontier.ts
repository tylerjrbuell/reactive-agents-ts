import type { PromptTemplate } from "../../types/template.js";

export const reactThoughtFrontierTemplate: PromptTemplate = {
  id: "reasoning.react-thought:frontier",
  name: "ReAct Thought Instruction (Frontier Models)",
  version: 1,
  template: `{{context}}

Previous reasoning chain:
{{history}}

Instructions:
1. Analyze the current state of the task — what has been accomplished and what remains
2. Consider which tool would be most efficient for the next step
3. If you need information, prefer a single targeted query over multiple broad ones
4. If all information is gathered, synthesize your findings
5. Use ACTION: tool_name({"param": "value"}) with exact parameter names from tool schemas
6. When ready: FINAL ANSWER: <your comprehensive answer>

Reason through this step carefully:`,
  variables: [
    {
      name: "context",
      required: true,
      type: "string",
      description: "Current context including task, tools, and memory",
    },
    {
      name: "history",
      required: true,
      type: "string",
      description: "Previous reasoning steps in the chain",
    },
  ],
};
