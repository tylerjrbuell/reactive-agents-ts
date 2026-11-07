---
"@reactive-agents/tools": patch
---

`code-execute` now refuses shell input such as `bun test`, `npm run build`, `ls -la` or `cd src && bun test` before running anything. It returns `{ executed: false, shellCommand: true, error }`, and the error says that the input is a shell command, that code-execute runs JavaScript/TypeScript with Bun and does not run shell commands, and that nothing was executed. Before, the input ran as JavaScript, failed with a syntax or reference error, and the reply told the model to fix its code. The tool does not name a shell tool, because only the caller knows whether one is offered in the run. New export from the module: `isShellInput`.
