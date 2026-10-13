---
"@reactive-agents/tools": minor
---

W3c parser-coverage fix: `TextParseDriver` tier-1 is now wrapper-tolerant. Real
no-FC models do not always emit the `<tool_call>` wrapper the driver teaches.
Measured on `qwen2.5-coder:14b` (committed W3c traces, `fixtures/post-w3`, 10/10
runs): at temp 0 the coder emits the taught `tool: <name>` + param lines but
drops BOTH wrapper tags, so the wrapped-only regex parsed 0 calls and the model
burned maxIterations (shadow would-have-executed 0/5; act 0/5 executed). Tier-1
now falls back to a bare-block scanner that accepts the SAME taught grammar
minus the wrapper: a block must open with a `tool: <name>` line and carry at
least one `key: value` param line. It is tolerant of prose, `---` rules, code
fences and a leading prose line BETWEEN blocks, and of YAML block-scalar param
values WITHIN a block (`|` literal and `>` folded, with `-`/`+` chomping).
Wrapped blocks still win when present and the wrapped path is byte-unchanged.
Coder:14b measured 0/10 -> 10/10 parseable, all parsed names in the run's
callable surface.

Hardening (review round 1) closes three corruption paths on the bare path:
1. **Indent symmetry** - the tool line and param lines now accept/normalize
   leading indentation symmetrically, so a block nested in an explanation parses
   WITH its params instead of opening an empty-args call.
2. **Prose tolerance scoped** - tolerance is BETWEEN blocks, not within a param
   list: a mid-param interjection (a later `content:` after prose) is DROPPED
   loudly rather than re-attached, because genuine in-list skipping would absorb
   data-sample lines (`ProductA: 100`) that real emissions embed between blocks
   (measured), attaching wrong args. A bare block now REQUIRES >=1 param, so a
   lone `tool:` line in prose can never dispatch an empty-args call.
3. **Block-scalar forms interpreted, not half-accepted** - `>` folding (single
   breaks to spaces, blank lines to paragraph breaks) and `|`/`>` chomping
   (`-` strip, `+` keep, default clip) are implemented to exact values instead
   of preserving the literal header. GH #243 pin preserved: same builder-taught
   grammar, no guessed format, verified by a builder-derived test.
