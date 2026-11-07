---
"@reactive-agents/tools": patch
---

Prose file writes no longer land as one line of literal `\n`. When a model sends `file-write` content for a `.md`, `.markdown`, `.txt`, `.rst` or `.csv` path that has no real newline and at least two literal `\n` sequences (it escaped `\\n` in the tool-call arguments), the healing pipeline's value-shape stage turns `\r\n` and `\n` into line breaks and `\t` into tabs, and records a `value-shape` heal action (`content:literal-newlines` to `content:newlines-unescaped(N)`). An escaped backslash and every other backslash are kept. Code files, JSON files, and content that already has a real newline are never changed. Witness: on the lh-1 bench task, all 5 gpt-4o-mini failures and 2 llama3.2:3b runs wrote `report.md` / `sources.md` this way, which fused the URLs the grader looks for.
