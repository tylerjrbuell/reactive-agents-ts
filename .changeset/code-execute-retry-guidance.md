---
"@reactive-agents/tools": patch
---

`code-execute` failures where the code never ran (non-JS language, shell input, syntax error) now say how to retry: JavaScript/TypeScript only, a runnable example, and that data must be inlined (each call starts clean in /tmp). The tool description states the stateless/cwd constraint up front.
