---
"create-reactive-agent": patch
"@reactive-agents/cli": patch
---

Every project scaffolded by `create-reactive-agent` or `rax init` now includes an `AGENTS.md` for coding agents (Claude Code, Cursor, Codex). It points them at the current docs instead of training data: the docs index at `https://docs.reactiveagents.dev/llms.txt`, markdown versions of docs pages, and `npx skills add https://docs.reactiveagents.dev` for the agent skills. It also lists the project's real scripts, a few rules that keep generated code on the current builder API, and `npx rax diagnose cause latest` for explaining a failed run. The post-scaffold output mentions the file in one line.
