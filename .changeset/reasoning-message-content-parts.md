---
"@reactive-agents/reasoning": minor
"@reactive-agents/core": minor
---

Kernel messages carry typed content parts. `KernelMessage.content` (and the core `KernelMessageLike` harness payload) is now `MessageContent`: a string, or `ContentPart[]` when a non-text part is present. A user turn seeded through `initialMessages` with an image part now reaches the provider as an image block instead of being impossible to express. Text-only content is still one string, so text runs send the same bytes as before. Audio parts, file parts and image types the provider wire does not support (anything other than PNG, JPEG, GIF, WebP) become a short deterministic text note, and tool-result parts flatten to text, until per-provider mapping lands.
