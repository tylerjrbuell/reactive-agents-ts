---
"@reactive-agents/llm-provider": patch
"@reactive-agents/ui-core": patch
---

Wave 1 (Local-Tier Reliability) thinking channel, provider half: the public `StreamEvent` union gains a `thinking_delta` variant and an optional `thinking` field on `content_complete` (strictly additive, rollback-tolerant). The local (Ollama) stream loop now accumulates and forwards `message.thinking` chunks in the same pass as content, gated by the existing thinking-capability seam; the Anthropic adapter's extended-thinking deltas route through the same event, gated by `resolveThinkingEnabled`. Non-thinking models emit zero `thinking_delta`. ui-core records (comment) why provider thinking is deliberately not mirrored onto the UI wire protocol; a three-binding parity test (react/svelte/vue) pins the #188 divergence class. Kernel consumption lands in the follow-up dispatch (appends `@reactive-agents/reasoning` to this changeset).
