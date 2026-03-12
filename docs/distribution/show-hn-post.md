# Show HN Post (Draft)

**Title (60 chars max):**
Show HN: Reactive Agents – composable TypeScript AI agent framework

**Body:**

I've been building Reactive Agents for the past 6 months — a TypeScript AI agent
framework that takes a different approach to the usual "wrap LangChain" pattern.

The core idea: 19 independent packages that compose via Effect-TS layers. You
enable exactly what you need — reasoning, memory, guardrails, cost tracking,
streaming — and nothing you don't. `agent.run()` works without knowing Effect at all.

The differentiator I'm most excited about is the Gateway: a persistent autonomous
agent harness with adaptive heartbeats, crons, and webhooks. No custom server needed.
I actually built a community growth agent on it that monitors HN and Reddit for
TypeScript AI framework discussions and drafts responses for me to review.

Key features:
- 5 reasoning strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive)
- 6 LLM providers: Anthropic, OpenAI, Gemini, Ollama, LiteLLM (local + cloud)
- Real-time token streaming → SSE in one line: AgentStream.toSSE(agent.runStream(...))
- A2A multi-agent protocol for typed agent-to-agent communication
- Production guardrails, cost tracking, real Ed25519 identity
- 1,381 tests, CI green

24 runnable examples work without an API key (test mode).

GitHub: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://docs.reactiveagents.dev/
npm: https://npmjs.com/package/reactive-agents

Happy to answer questions about the architecture or the Effect-TS approach.

---
**Post timing:** Tuesday–Thursday, 9–11am EST
**Best moment:** After first real-world usage story (meta-agent has been running live)
