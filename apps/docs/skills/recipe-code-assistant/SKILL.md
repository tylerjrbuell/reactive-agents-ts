---
name: recipe-code-assistant
description: Full recipe for a code assistant with shell execution, file read/write, git integration, and sandboxed code running.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Code Assistant

## What this builds

A code assistant that can read and write files, run shell commands (git, build tools, tests), and execute code in a sandboxed environment. Suitable for CI/CD automation, code review, and iterative development tasks.

## Skills loaded by this recipe

- `shell-execution-sandbox` — shell tool with allowlist and opt-in build commands
- `reasoning-strategy-selection` — plan-execute-reflect for multi-step coding tasks
- `tool-creation` — tool registration and allowedTools
- `observability-instrumentation` — verbose live output for development

## Complete implementation

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";
import { shellExecuteTool, shellExecuteHandler } from "@reactive-agents/tools";

// Configure the shell tool with build commands enabled
const shellTool = {
  definition: shellExecuteTool,
  handler: shellExecuteHandler({
    additionalCommands: ["bun", "node", "npm", "git"],
    timeoutMs: 60_000,       // 60s for build/test commands
    maxOutputChars: 8_000,   // increase for verbose test output
    cwd: process.cwd(),
  }),
};

const agent = await ReactiveAgents.create()
  .withName("code-assistant")
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "plan-execute-reflect",
    maxIterations: 30,
  })
  .withTools({
    tools: [shellTool],
    allowedTools: ["shell-execute", "file-read", "file-write", "checkpoint", "final-answer"],
  })
  .withObservability({ verbosity: "verbose", live: true })
  .withCostTracking({ perSession: 2.0, daily: 20.0 })
  .withSystemPrompt(`
    You are a code assistant with shell and file access.

    Workflow for coding tasks:
    1. Read relevant files with file-read before making changes.
    2. Checkpoint your plan before starting significant edits.
    3. Make targeted, focused changes — do not rewrite files unnecessarily.
    4. After writing files, run tests with shell-execute to verify.
    5. Use "git status" and "git diff" to review changes before finalizing.
    6. Report what you changed and whether tests passed.

    Allowed shell commands: git, ls, cat, grep, find, bun, node, npm, mkdir, cp, mv, touch, wc, head, tail, diff
    Blocked: rm, chmod, chown (use mv to "delete" files if needed)
  `)
  .build();

// Example: fix a bug
const result = await agent.run(`
  Fix the failing test in packages/auth/tests/login.test.ts.
  The test expects validateToken to return null for expired tokens,
  but the current implementation throws an error instead.
`);

console.log(result.output);
await agent.dispose();
```

## Key variations

### Read-only code review (no writes)

```ts
const reviewTool = {
  definition: shellExecuteTool,
  handler: shellExecuteHandler({
    allowedCommands: ["git", "ls", "cat", "grep", "find", "head", "tail", "wc", "diff"],
  }),
};

const reviewer = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    tools: [reviewTool],
    allowedTools: ["shell-execute", "file-read", "checkpoint"],
  })
  .withSystemPrompt("Review code for issues. Do not make any changes. Report findings only.")
  .build();
```

### Docker-sandboxed code execution

```ts
const sandboxTool = {
  definition: shellExecuteTool,
  handler: shellExecuteHandler({
    additionalCommands: ["node", "python3"],
    dockerEscalation: { enabled: true },
    // Inline code (node --eval, python -c) runs in isolated Docker containers
  }),
};
```

### Audit logging for production

```ts
import type { ShellAuditEntry } from "@reactive-agents/tools";

const auditedTool = {
  definition: shellExecuteTool,
  handler: shellExecuteHandler({
    additionalCommands: ["bun", "git"],
    onAudit: (entry: ShellAuditEntry) => {
      logger.info("shell-execute", {
        command: entry.command,
        exitCode: entry.exitCode,
        durationMs: entry.durationMs,
      });
    },
  }),
};
```

## Expected output shape

```ts
const result = await agent.run("Fix the failing test...");
// result.output   — description of changes made and test results
// result.steps    — full trace of file reads, writes, and shell commands
// result.cost     — USD cost for the session
```

## Pitfalls

- `rm` is hard-blocked and cannot be enabled via `additionalCommands` — use `mv` to archive files instead
- `maxOutputChars: 4000` (default) truncates long command output — increase to 8000+ for `bun test` on large test suites
- `timeoutMs: 30_000` (default) is too short for `bun install` — set 60_000+ for package management commands
- Always read files before writing them — the agent must understand the existing code structure before making changes
- `file-write` overwrites the entire file — ensure the agent reads the file first and preserves non-modified sections
