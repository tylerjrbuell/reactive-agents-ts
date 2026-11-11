---
"@reactive-agents/core": minor
---

New prompt-fragment contract, so harness-authored model-visible text (guidance lines, the outstanding-requirements tail, exit-gate text, tool descriptions) can be inspected, replaced or disabled by id. `@reactive-agents/core` now exports:

- `PromptFragmentId` (a dotted id such as `"tail.outstanding"` or `"tool.web-search.description"`), `PromptFragmentSlot` and `PromptFragmentDefinition` (a registry entry: id, slot, owner, summary, and a `render(vars)` that returns text parts).
- `PromptOverrides`: a map from fragment id to a string (replace the text), `null` (disable it), or a transform that receives the default text and returns a string, `null`, or `undefined` (keep the default). `SerializablePromptOverrides` is the JSON-safe subset, with no transforms.
- `resolvePromptFragment(definition, vars, overrides)`, plus `promptFragmentText` and `promptFragmentHash` (SHA-256 of the text), so every package resolves and hashes fragments the same way.
- A new `PromptAssembled` event that records, per model request, each fragment's id, slot, status (`default` | `overridden` | `disabled`), hashes and character count, plus optional tool-description hashes.

These are types and helpers only. No package uses them yet, so no prompt text or run behavior changes in this release.
