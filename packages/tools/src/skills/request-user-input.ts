import type { ToolDefinition } from "../types.js";
import { questionItemJsonSchema } from "./user-input-questions.js";

// ─── Tool Definition ───────────────────────────────────────────────────────
//
// Agentic-UI meta-tool: lets the model pause a durable run and ask the human
// for structured input (a form, a choice, or a confirmation). The kernel
// intercepts this tool (like `final-answer`) rather than executing it as a
// normal side-effecting tool — the run suspends durably and resumes when the
// human's response arrives. Gated by `KernelMetaToolsSchema.userInteraction`
// and the builder's `.withUserInteraction()` (wiring lands in a later task).

export const REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";

export const requestUserInputTool: ToolDefinition = {
  name: REQUEST_USER_INPUT_TOOL_NAME,
  description:
    "Pause this run and ask the human user for input. Use ONLY when you cannot proceed without " +
    "information or a decision that the user must provide. The run waits until the user responds; their response " +
    "arrives as this tool's result. Do not use it for information you can obtain with other tools. " +
    "Prefer `questions`: several typed questions in one call. Use single-choice/multi-choice when the answers are " +
    "a known set, boolean for yes/no, number for amounts, text only for open answers. " +
    "Each question: { id, prompt, type: text|single-choice|multi-choice|boolean|number, options?: [{label, value}], " +
    "required?, default?, min?, max?, maxLength?, allowOther? }. The result maps each id to its answer.",
  parameters: [
    {
      name: "questions",
      type: "array",
      description:
        "Typed questions to ask in one call. Every item needs id, prompt and type; choice types also need options. Preferred over kind/schema.",
      required: false,
      items: questionItemJsonSchema(),
    },
    {
      name: "prompt",
      type: "string",
      description: "Heading or instruction shown to the user. Required when not using `questions`.",
      required: false,
    },
    {
      name: "kind",
      type: "string",
      description: "Legacy single-question shape: 'form', 'choice' or 'confirmation'. Omit when using `questions`.",
      required: false,
      enum: ["form", "choice", "confirmation"],
    },
    {
      name: "schema",
      type: "object",
      description:
        "Legacy payload for `kind`: form { fields: [{ name, label, type, required? }] }, choice { options: string[] }.",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  mutatesExternalState: false,
  source: "function",
};
