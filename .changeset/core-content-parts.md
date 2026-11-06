---
"@reactive-agents/core": minor
---

Typed content parts: `ContentPart` (text, image, audio, file reference), `MessageContent` (`string | ContentPart[]`) and the helpers `contentText`, `contentParts` and `normalizeContent`. Content made only of text is canonically one string. Nothing consumes these yet; they are the shared type for multimodal messages and tool results (Plan 9 Phase 4).
