---
"@reactive-agents/reasoning": patch
---

A tool that returns `toolContent(parts)` (for example an MCP tool that returns an image) now keeps its parts in the kernel. The tool-result message carries the typed parts, and the observation step, compression and the scratchpad use the text parts only. Before this change the result was serialized to a JSON text view and the image was lost. Provider tool-role content is still text, so an image in a tool result reaches the model as a short placeholder such as `[image omitted: image/png; tool results carry text only]`, never as base64 bytes. Tool results that do not use `toolContent` are unchanged.
