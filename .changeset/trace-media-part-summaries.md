---
"@reactive-agents/reasoning": patch
"@reactive-agents/trace": patch
"@reactive-agents/core": patch
---

Traces and checkpoints no longer store image or audio bytes. In an `llm-exchange` trace event, a message that carries an image now has an optional `parts` summary (`type`, `media_type`, `bytes`, `sha256`) instead of the bytes. Text-only messages do not get the field, and traces recorded before this change still load. A new `content-part-degraded` trace event records each part the kernel replaced with a text stub before the provider call: audio parts, file parts and unsupported image types. Durable checkpoints (`serializeKernelState`, `RunHandle.inspect()`) replace each inline base64 image or audio part with a text stub that holds the same summary. A run resumed from a checkpoint therefore sees that stub where the media was. URL sources are kept, and an audio transcript is kept.

A tool result that contains an image is now sent to the provider as text and image blocks on the tool message. Before this change the image became the stub `[image omitted: image/png; tool results carry text only]`. Each provider maps the image to its own format. Tool results that contain only text are still sent as one string, unchanged.
