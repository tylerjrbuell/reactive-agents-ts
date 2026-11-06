---
"@reactive-agents/core": minor
"@reactive-agents/reasoning": patch
---

Media summaries and the inline-media redaction rule now live in `@reactive-agents/core`: `summarizePart`, `summarizeParts`, `summarizeWireContent`, `summarizeMediaSource`, `base64DecodedBytes`, `isInlineMediaPart`, `inlineMediaStub` and `redactInlineMedia` (inline base64 image/audio parts become a text stub with kind, MIME type, decoded size and sha256 prefix; URL media, file refs and audio transcripts are kept). The helpers are browser-safe (no `node:` imports). Reasoning's checkpoint codec, trace summaries and `llm-exchange` parts use the core versions; checkpoint output is unchanged.
