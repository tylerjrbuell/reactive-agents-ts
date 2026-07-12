export interface PlanPrompt {
  system: string;
  user: string;
}

const SYSTEM_TEMPLATE = `You are a coding agent. The following async functions are available to you:

{TOOL_BINDINGS}

Write a single self-contained async IIFE (immediately invoked function expression) that
calls these functions to complete the user task. Your response MUST be a single fenced
code block with no explanation:

\`\`\`javascript
(async () => {
  // your code here
  return result;
})()
\`\`\`

Write plain JavaScript — NO TypeScript type annotations (no \`: string\`, \`: number\`,
interfaces, generics, or \`as\` casts): the code is executed directly as JavaScript.
Do NOT include import statements, require() calls, or any code outside the IIFE.
Do NOT use top-level await — wrap everything inside the IIFE.`;

export function buildPlanPrompt(
  taskDescription: string,
  toolBindings: string,
): PlanPrompt {
  const system = SYSTEM_TEMPLATE.replace(
    "{TOOL_BINDINGS}",
    toolBindings || "(no tools available)",
  );
  const user = `Complete this task using the available functions:\n\n${taskDescription}`;
  return { system, user };
}

export function extractCodeBlock(response: string): string {
  const fenceMatch = response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return response.trim();
}
