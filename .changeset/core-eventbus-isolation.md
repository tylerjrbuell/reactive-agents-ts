---
"@reactive-agents/core": minor
---

EventBus.publish now isolates handler failures and defects: a throwing subscriber no longer interrupts sibling handlers or fails the publisher; the failure is reported as an `ErrorSwallowed` event (tag `EventHandlerFailed:<eventTag>`). New `errorMessage(unknown): string` helper replaces the `instanceof Error ? e.message : String(e)` idiom.
