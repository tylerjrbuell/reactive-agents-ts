---
"@reactive-agents/llm-provider": minor
---

Images in messages now reach OpenAI, LiteLLM, Ollama and Gemini models. Before, these providers silently dropped image blocks. Now OpenAI and LiteLLM send them as `image_url` parts, Ollama sends them in the message `images` array, and Gemini sends them as `inlineData`. Anthropic is unchanged.

If a provider or model cannot take an image, the image becomes a short text note instead of disappearing, for example `[image omitted: image/png, 41 KB; model has no image input]`. Each such note also logs a `content-part-degraded` warning with the provider, model, media type, size, role and reason. This happens for models with no vision support in a probe or static capability row, for URL images on Ollama and Gemini, and for images in tool results or assistant turns where the provider has no slot for them.

`ProviderCapabilities` gains an optional `inputModalities` field. The text and image `ContentBlock` variants are now derived from core `TextPart` and `ImagePart`, and `isImageSource` narrows a core `MediaSource` to a wire image source. Tool-role messages accept text and image blocks as well as a string. Trace and replay flattening (`messageContentToString`) renders an image as `[image:<media_type>:<sha256-12>]` instead of an empty string, so two requests that differ only in an image no longer get the same replay key. Text-only requests send exactly the same bytes as before.
