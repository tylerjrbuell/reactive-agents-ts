---
"@reactive-agents/reasoning": patch
---

Audio and file parts in user and assistant turns now reach the provider as content blocks instead of kernel text stubs, so the provider wires them, uses the transcript, or records its own degrade. Tool-result audio and file parts are still stubbed by the kernel (the tool message block has no audio or file shape).
