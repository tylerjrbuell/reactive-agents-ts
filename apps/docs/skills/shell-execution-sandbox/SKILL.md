---
name: shell-execution-sandbox
description: Enable and configure the sandboxed shell execution tool with command allowlists, Docker isolation, and audit logging for agents that run terminal commands.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Shell Execution Sandbox

> **Disclaimer — your machine, your risk.** `shell-execute` runs real processes on the host (or in an optional Docker sandbox you configure). Allowlists and blocklists reduce accidents but are not a guarantee. Only enable for trusted codebases and accounts; review allowed command names and working-directory rules before production use. Cortex exposes this as an **explicit opt-in** in the Lab builder with the same warning.

## Agent objective

Produce a builder with shell execution enabled, the correct allowlist for the task, and appropriate safety config — without exposing destructive commands.

## When to load this skill

- Agent needs to run terminal commands (git, file operations, build tools)
- Agent generates and executes code (Node, Bun, Python)
- Task requires reading directory structure, running tests, or processing files
- CI/CD or automation agent workflows

## Implementation baseline

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 15 })
  .withTools({
    allowedTools: ["shell-execute", "file-read", "checkpoint"],
    terminal: true, // registers shell-execute handler (or use .withTerminalTools())
  })
  .withSystemPrompt(`
    You have access to a shell. Use it to explore the codebase and run commands.
    Always checkpoint important findings before continuing.
  `)
  .build();
```

## Default allowlist

The `shell-execute` tool blocks any command not on the allowlist. Default allowed commands:

```
git, ls, cat, grep, find, echo, printf
mkdir, cp, mv, touch
wc, head, tail, sort, uniq, cut, tr, tee, diff, sed, awk, jq
pwd, date, which, basename, dirname, test, true, false
seq, gzip, gunzip, zip, unzip
```

**Explicitly excluded:** `rm`, `chmod`, `chown` — too destructive for agent sandboxes.

## Key patterns

### Opt-in commands for build tasks

Build tools (Node, Bun, npm, Python, curl) are available but not on by default:

```ts
// Available opt-in commands: node, bun, npm, npx, python, python3, curl, env, xargs, tar
// Add via ShellExecuteConfig.additionalCommands when registering the tool:
import { shellExecuteTool, shellExecuteHandler } from "@reactive-agents/tools";

const shellTool = {
  definition: shellExecuteTool,
  handler: shellExecuteHandler({
    additionalCommands: ["bun", "node", "npm"],
    timeoutMs: 60_000,        // default 30s — increase for build commands
    maxOutputChars: 8_000,    // default 4000
    cwd: "/workspace",        // default to project root
  }),
};

const agent = await ReactiveAgents.create()
  .withTools({ tools: [shellTool], allowedTools: ["shell-execute"] })
  .build();
```

### Docker-isolated code execution

When `dockerEscalation` is enabled, inline code (Node `--eval`, Bun `-e`, Python `-c`) automatically routes through a Docker sandbox:

```ts
shellExecuteHandler({
  additionalCommands: ["node", "python3"],
  dockerEscalation: {
    enabled: true,
    // Inline code execution is fully isolated in a fresh container
  },
})
```

### Read-only shell (safest config)

```ts
shellExecuteHandler({
  allowedCommands: ["ls", "cat", "grep", "find", "head", "tail", "wc"],
  // Only listing and reading — no writes, no execution
})
```

### Audit logging

```ts
shellExecuteHandler({
  onAudit: (entry: ShellAuditEntry) => {
    logger.info("shell-execute", {
      command: entry.command,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
    });
  },
})
```

## Shell tool properties

The `shell-execute` built-in tool has these characteristics:

| Property | Value |
|----------|-------|
| `riskLevel` | `"high"` |
| `requiresApproval` | `true` |
| `category` | `"system"` |
| `timeoutMs` (default) | 30,000ms |
| `maxOutputChars` (default) | 4,000 chars |
| `MAX_COMMAND_LENGTH` | 4,096 chars |

## Builder API reference

| Method | Key params | Notes |
|--------|-----------|-------|
| `.withTools({ tools, allowedTools })` | include `"shell-execute"` | Register custom handler for config |
| `.withTools()` | no args | Enables shell-execute but with `requiresApproval: true` |

## Pitfalls

- `shell-execute` has `requiresApproval: true` by default — in automated pipelines, register a custom handler with `requiresApproval: false` if human approval flow is not wired
- Commands are allowlisted by **executable name only** (first word) — `git` is allowed regardless of sub-command args; `curl` is opt-in
- `MAX_COMMAND_LENGTH` is 4,096 — very long piped commands will be rejected
- Docker daemon must be running for `dockerEscalation` — check before enabling in CI
- `rm`, `chmod`, `chown` are hard-excluded and cannot be added via `additionalCommands`
- `maxOutputChars: 4000` truncates long output — increase for commands that produce large output (e.g., `git log`, `find` on large trees)
