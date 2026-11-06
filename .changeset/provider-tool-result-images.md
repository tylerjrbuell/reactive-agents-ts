---
"@reactive-agents/llm-provider": minor
---

Images returned by a tool (for example an MCP screenshot or chart tool) now reach the model as images when the tool message carries image blocks.

- Anthropic sends them as `image` blocks inside the `tool_result` content.
- Ollama sends them in the tool message `images` array (unchanged from the previous release).
- OpenAI and LiteLLM tool messages accept text only, and Gemini uses the same approach. These providers move each tool-result image to one user message placed right after the run of tool messages. The user message is labeled `Image output of tool "<name>" (call <id>):`. The tool message keeps a marker where the image was, for example `[image: image/png, 41 KB; attached in the next user message]`.

An image still becomes a text note, and logs a `content-part-degraded` warning, when it cannot be sent. This happens when the model has no image input, and for URL images on Anthropic, Ollama and Gemini, which take inline base64 only. On Anthropic, the same rules now also apply to images in user messages: a URL image or an image sent to a text-only model becomes a note instead of a malformed request. Text-only requests send exactly the same bytes as before.
