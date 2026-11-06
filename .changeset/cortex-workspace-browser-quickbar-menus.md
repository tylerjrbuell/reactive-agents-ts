---
"@reactive-agents/cortex": minor
---

Pick a workspace without typing a path. The chat `/workspace` picker and the Lab builder's Workspace field now suggest the project Cortex was started in (its git root), `CORTEX_SKILL_SCAN_ROOT` and workspaces you used before. **Browse folders…** / **Browse** opens a folder browser: a breadcrumb, the current folder's subfolders (git repos marked; hidden folders behind a toggle) and **Use this folder**. New routes: `GET /api/workspace/candidates` and `GET /api/workspace/browse?path=&hidden=1`. The browse route lists directory names only and refuses relative or missing paths. A new chat still starts with no workspace; the launch project is suggested, never set for you.

The chat quick bar's slash menu now closes on a click outside it or on Escape, and gives back what you had typed in the composer. Clicking another chip switches straight to that picker, and clicking the same chip again closes it. The menu sits above the quick bar, so the chips stay clickable. Multi-value pickers (tools, toolsets, MCP servers, pinned skills, documents) show checkboxes and stay open while you toggle several items. Click or Tab toggles; Enter toggles and closes. Single-value pickers still close when you pick.

Fixed: changing a chat setting no longer empties the composer. Every session reload used to reset it.
