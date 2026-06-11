---
"@reactive-agents/reasoning": patch
"@reactive-agents/llm-provider": patch
---

Tool-calling routing hardening across all model tiers. The model capability signal is now the single master input for native-FC vs text-parse routing, eliminating split-brain drift between resolver and driver. Lazy tool pruning floors at `allowedTools` and can never prune down to meta-tools only. Sanitized tool names are rendered in the prompt so the text the model sees always matches the native function-calling array. Reflexion no longer produces empty outputs when generation comes back blank (clean synthesis backfill), and reflexion / tree-of-thought / plan-execute now forward classifier `relevantTools`, so MCP and user-registered tools are visible to the model in every strategy. Verified across local (Ollama), Anthropic, and OpenAI providers.
