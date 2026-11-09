---
"@reactive-agents/cortex": patch
---

Coalesce live chat TextDelta store writes to one per animation frame (rAF, with a synchronous fallback in tests/SSR), cutting re-renders at high token rates without changing the rendered output.
