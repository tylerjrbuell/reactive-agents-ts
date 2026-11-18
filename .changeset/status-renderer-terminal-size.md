---
"@reactive-agents/observability": patch
---

The live status line no longer floods terminals that are too small for it. A terminal that reports a size of 0 columns or 0 rows (0x0 ptys in CI runners, web terminals before layout, some IDE panes) now gets plain permanent lines only, with no live redraws or cursor movement. In narrow terminals the status line is clipped to one row (ending in `…`) and the thinking panel wraps to the terminal width, so redraws stop scrolling a new line on every spinner tick. Terminals that report no size keep the 80-column fallback.
