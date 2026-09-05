---
"@reactive-agents/runtime": minor
"@reactive-agents/reasoning": minor
---

Add `.withHarness({...})`, a typed, per-agent control surface for the harness's internal mechanisms (tool disclosure, tool discovery, tool index, verbose rules, context budgets, and more). Config passed to `.withHarness()` now takes precedence over `RA_*` environment variables, which take precedence over the default, and the resolved config is inherited by sub-agents. `ContextProfile.toolDisclosureMode` is wired through to the resolved harness, so a tier's disclosure preset actually changes tool-visibility behavior instead of being computed and discarded.
