---
"@reactive-agents/observability": patch
"@reactive-agents/reasoning": patch
---

Fixed — status renderer no longer breaks a host app's readline (arrow-key history)

The status renderer's keyboard handler unconditionally took over stdin raw
mode, with no awareness that a host script's own `readline.createInterface()`
might already own it. That left arrow-key history printing a literal
`^[[A` after any run. It now defers entirely when stdin already has a
listener attached.

Improved — verifier rejection warnings are plain-English

The terminal status line used to print the verifier's internal check-id and
diagnostic phrasing verbatim (e.g. `output-is-model-authored`). It now shows
a plain-English sentence, with the raw diagnostic still available to
verbose/debug log consumers via the event's `context` field.

Improved — status renderer glyphs are now colorized (✓ green, ✗ red, ⚠
yellow, ℹ cyan), respecting `NO_COLOR`.
