---
"@reactive-agents/llm-provider": patch
"@reactive-agents/tools": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

fix: 2026-10-23/24 introspective harness-loop batch (bonsai-2:27b self-report x trace cross-check)

- llm-provider: honor explicit `thinking:false` on Ollama default-think models via tri-state `think` param (off-switch now reaches the wire; no more paying the +6000 thinking widening for a disabled feature)
- tools: MCP namespaced tool names resolve from the provider-sanitized form (token-sequence match; fixes the umami_get_website_stats vs get_event_stats last-token collision that dead-looped native FC)
- tools: tool-service honors handler-reported failures (`{success:false}` payloads now produce failed observations - trace ok=false, recovery guidance, honest durable effect records); shell-execute policy denials carry the flag
- tools: denial messages made actionable (allowlist named on unlisted-command denial, dedicated `cd` reason naming the sandbox root, honest `rm` reason)
- tools: file-write payloads document/return the resolved absolute path
- reasoning+runtime: an explicit `.withReasoning({maxIterations})` cap always wins over the tier context-profile hint (was silently min()'d to 8 on local tier); clamp emits a visible structured signal
- reasoning: recovery steering no longer advises alternate tools for policy-blocked failures (block/allowlist/sandbox/path-traversal refusals re-surface the tool's own remedy instead)
