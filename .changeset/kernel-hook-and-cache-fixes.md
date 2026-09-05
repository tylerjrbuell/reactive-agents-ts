---
"@reactive-agents/reasoning": patch
---

Fix three lifecycle-hook gaps found in a hook-firing audit: the kernel's `bootstrap`-`after` hook was never fired, `think` hooks incorrectly fired on tool-execution passes (not just reasoning passes), and the kernel's own `observe` hook was missing entirely. Fix a post-condition steer that could re-loop a tool-free chat turn. Move harness guidance text (required-tool reminders, nudges, hints) out of the system prompt and into the message tail, restoring the Anthropic prompt-cache breakpoint that guidance text was invalidating on every iteration.
