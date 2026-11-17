---
"@reactive-agents/tools": minor
---

Tools can declare a deterministic `preflight` that runs before any approval is requested. `ToolDefinition.preflight(args)` returns the refusal text the tool would return at execution, or `undefined` to proceed; `defineTool({ preflight })` passes it through and `preflightToolCall(tool, args)` runs it safely (a throwing preflight means proceed). `shell-execute` implements it with the same input policy its handler enforces, so a command outside the allowlist (for example `gh` when it is not granted) is refused with the identical message and no approval prompt. The checks moved to `skills/shell-input-denial.ts`; `sanitizeCommand` and `findDisallowedCommand` keep their exports.
