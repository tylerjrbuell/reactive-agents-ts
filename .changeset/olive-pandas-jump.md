---
"@reactive-agents/runtime": patch
---

Thread explicit `.withModel({numCtx})` into the kernel guard window (GH #241). `createRuntime` (and the light-runtime config) now seeds `contextProfile.explicitNumCtx`, so the head-truncation guard and demand-bucket cap enforce against the override Ollama actually uses instead of the capability recommendation. No-override behavior unchanged.
