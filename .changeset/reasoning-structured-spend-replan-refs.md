---
"@reactive-agents/reasoning": patch
---

One spend rule for structured calls, replan ref events, and a separator in tool-content text.

- Planner spend (plan-execute, blueprint, and the patch/augment replans) now uses the provider-reported usage, including the input/output split. It falls back to the chars/4 estimate only when the provider reported no usage. Before, replans were always estimated. The run budget meter still counts each structured call once.
- Patch and augment replans emit the same `guard-fired{guard:"plan-ref-normalized"}` event as a fresh plan when they rewrite a keyed `{{from_step:sN:key}}` ref. Before, they rewrote it with no event.
- When a `toolContent(...)` result mixes text and media, its observation text joins the text parts with a newline. Text split by an image no longer runs together (`[a, image, c]` gave `"ac"`, now `"a\nc"`). Text-only and plain results are unchanged.
