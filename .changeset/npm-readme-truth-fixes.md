---
"reactive-agents": patch
---

The npm README now states that Bun is recommended and Node.js 22.5+ is supported (it previously said Bun was required), links the working Discord invite, and drops an absolute type-safety claim and the downloads badge. It also says "adaptive strategy selection" (switching is opt-in) and describes the 18 bundled packages accurately (16 re-exported from the root, `observe` via sub-path, `cli` as the `rax` binary).

The README was also rewritten to the shared package template: shorter, with the unsourced healing and token-savings percentages and hand-typed counts removed, and strategy, tools and environment detail replaced by docs links.

The quickstart snippets now opt in with `.withTools({ builtins: "research" })` instead of an empty `.withTools()`, and the pitch no longer claims signed receipts by default (they are unsigned unless `.withReceiptSigning()` or `RA_RECEIPT_KEY` is set).
