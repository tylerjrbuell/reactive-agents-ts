---
"@reactive-agents/tools": minor
---

W3c parser-coverage fix: `TextParseDriver` tier-1 is now wrapper-tolerant. Real
no-FC models do not always emit the `<tool_call>` wrapper the driver teaches.
Measured on `qwen2.5-coder:14b` (committed W3c traces, `fixtures/post-w3`, 10/10
runs): at temp 0 the coder emits the taught `tool: <name>` + param lines but
drops BOTH wrapper tags, so the wrapped-only regex parsed 0 calls and the model
burned maxIterations (shadow would-have-executed 0/5 in act-gated arms; act 0/5
executed). Tier-1 now falls back to a bare-block scanner that accepts the SAME
taught grammar minus the wrapper: a block still must open with a `tool: <name>`
line and carry `key: value` param lines. It is tolerant of interleaved prose,
`---` rules, code fences, a leading prose line, and YAML block-scalar param
values (`content: |` plus indented lines, blank lines preserved). It never
invents a call from prose (no `tool:` line, no call), so it is tolerant of the
wrapper, not of the grammar (GH #243 pin preserved: the same builder-taught
grammar, no guessed format). Wrapped blocks still win when present and the
wrapped path is byte-unchanged. Coder:14b measured 0/10 -> 10/10 parseable, all
parsed names in the run's callable surface.
