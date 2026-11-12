---
"@reactive-agents/cortex": minor
---

Cortex chat composer is decluttered, with `/mcp`, `/btw` and a Context view.

- **Composer bar.** The chip row shows the model plus only settings changed from their defaults (at most four); a new **Config** button opens a popover grouping every setting (Model, Reasoning, Tools, Workspace, Limits) with its current value. Each row opens the same slash picker its chip did.
- **Tool disclosure is visible.** The Config popover and the builder's Tools section state the disclosure in force (`all`, `index`, `discover` or tier default) with a short explainer, and a closed Tools section shows a Disclosure badge when a mode is set.
- **`/mcp`** turns a saved MCP server on or off for the chat; `/mcp add <command or URL>` saves a new one, lists its tools and turns it on. Lab Tools has the same one-line add, and the command palette has "Add an MCP server".
- **`/btw <question>`** asks a read-only side question about the run in progress (or the last reply). A separate tool-less call on the chat's provider and model answers from a snapshot of the task, tool calls and draft; it shows as a collapsible aside and never enters the history, the running turn or memory. New route `POST /api/chat/sessions/:id/btw`.
- **Context tab** in the run view and the chat inspector now lists the skills the run had active (with why) and the memories it wrote. The framework publishes no memory-recalled event, so recalled memory is not shown and the tab says so.
