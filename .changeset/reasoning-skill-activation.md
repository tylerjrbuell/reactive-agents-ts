---
"@reactive-agents/reasoning": patch
"@reactive-agents/reactive-intelligence": patch
---

The agent can load a skill with `activate-skill` (skills spec step 4).

- When a run has skills to load (`KernelInput.skillsContext.skills`), the kernel offers `activate-skill` on the tool surface and runs it inline. Runs without skills get the same tool array and system prompt as before.
- `activate-skill({ name })` returns the skill's `<skill_content>` envelope as a tool result. The result is protected from compaction, so it stays in context for the rest of the run, and the activation is recorded as a `skill-activated` ledger fact (`name`, `sha256`, `source`, `via`, `tokens`). A second call for the same skill, or for a skill already pinned in the system prompt, returns "already loaded".
- Budget: one skill body may take at most `min(5,000 tokens, 10% of the context window)`, and all loaded skill bodies together at most 20% of the window. Over the limit, the call is refused with a message that points to `activate-skill({ name, file })`.
- `activate-skill({ name, file })` reads one file inside the skill's directory. It is an ordinary tool result: compressed like any other, not protected, no ledger fact.
- The skills section of the system prompt now starts "Skills: call `activate-skill` to load one before you start that kind of work." when the run can load skills. The old "do NOT call them as tools" line is gone.
- reactive-intelligence: the skill catalog no longer appends a `get_skill_section(...)` hint, because that tool no longer exists. `generateCatalogXml`'s `catalogOnlyHint` option is deprecated and has no effect.
