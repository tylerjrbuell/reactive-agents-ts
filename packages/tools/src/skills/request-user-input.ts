import type { ToolDefinition } from "../types.js";

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
    "information or a decision that the user must provide (a choice between options, a confirmation, " +
    "or structured form values). The run suspends durably until the user responds; their response " +
    "arrives as this tool's result. Do not use it for information you can obtain with other tools.",
  parameters: [
    {
      name: "kind",
      type: "string",
      description:
        "The shape of input being requested: 'form' (structured fields), 'choice' (pick one of a " +
        "list of options), or 'confirmation' (yes/no approval).",
      required: true,
      enum: ["form", "choice", "confirmation"],
    },
    {
      name: "prompt",
      type: "string",
      description: "What to ask the user — the question or instruction shown to them.",
      required: true,
    },
    {
      name: "schema",
      type: "object",
      description:
        "Kind-specific structured payload describing the requested input. " +
        "For kind 'form': { fields: [{ name, label, type: 'text'|'number'|'boolean', required? }] }. " +
        "For kind 'choice': { options: string[] }. For kind 'confirmation': {} (empty object).",
      required: true,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "function",
};
