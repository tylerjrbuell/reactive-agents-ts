# Bun Team Outreach

Bun's account has highlighted interesting projects before. The SSE streaming
example (24-streaming-sse-server.ts) is a natural Bun showcase: zero dependencies
beyond `reactive-agents`, uses `Bun.serve`, and shows token streaming in 3 lines.

---

## Tweet to @bunjavascript

**Option A (code-focused):**
```
Token-streaming AI agent → SSE endpoint in 3 lines with @bunjavascript:

const agent = await ReactiveAgents.create()
  .withProvider("anthropic").withStreaming().build();

Bun.serve({ fetch: (req) =>
  AgentStream.toSSE(agent.runStream(req.url))
});

Full example: [link to 24-streaming-sse-server.ts]
Built with: reactive-agents + Bun.serve
```

**Option B (gateway-focused):**
```
Persistent autonomous agents on @bunjavascript — no server needed:

await agent.withGateway({
  heartbeat: { intervalMs: 3_600_000 },
  crons: [{ schedule: "0 9 * * MON", instruction: "..." }],
}).build().start()

Runs forever, adaptive heartbeat, budget enforcement, webhooks.
Source: https://github.com/tylerjrbuell/reactive-agents-ts
```

---

## Direct issue/discussion

Alternatively, post in the Bun GitHub discussions under "Show & Tell":
https://github.com/oven-sh/bun/discussions

Title: "Built a TypeScript AI agent framework using Bun.serve for streaming SSE"
