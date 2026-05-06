---
"@reactive-agents/cortex": patch
---

feat(cortex-ui): load tools dynamically from catalog API

Replaces the hardcoded AVAILABLE_TOOLS list in AgentConfigPanel with a dynamic fetch from `/api/tools/catalog`. This ensures the UI automatically shows all builtin and meta-tools (web-search, crypto-price, file operations, git/gh CLIs, brief, find, discover-tools, etc.) without requiring UI code changes when new tools are added.

The fix also adds comprehensive icon mappings for all tools so they display consistently in the UI.
