---
"@reactive-agents/tools": minor
---

MCP tool results now keep their images, audio and resources. Before, `callTool` kept only the text items and dropped the rest: a result with text and an image returned only the text, and an image-only result returned the raw MCP object. Now image and audio items become typed image and audio parts (base64 plus MIME type), and `resource` and `resource_link` items become file parts that reference the URI, MIME type and name. The value is wrapped with the new `toolContent(parts)` helper. Text-only MCP results return exactly the same string as before.

Custom tools can return `toolContent(parts)` with core `ContentPart`s too. `isToolContent(value)` tells whether a value is typed content. If code that does not know about typed parts calls `JSON.stringify` on the value, it gets a text view (the text plus a short marker per media part, such as `[image: image/png]`), never the base64 bytes. The agent loop does not read typed parts yet: until a later change, the model sees this text view.
