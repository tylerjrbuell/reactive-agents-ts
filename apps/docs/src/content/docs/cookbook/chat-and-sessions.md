---
title: Chat & Sessions
description: >-
  Build conversational agents with multi-turn memory using agent.chat() and
  agent.session().
sidebar:
  order: 9
---

`agent.chat()` enables multi-turn conversation with capability-based routing — an agent with tools runs the ReAct loop for each message (and can answer directly in one iteration), an agent without tools goes straight to the LLM. `agent.session()` wraps a conversation with persistent context. When **`.withTools()`** is on, the **`recall`** meta-tool (Conductor's Suite) is the supported way for the model to read/write working notes across turns — not legacy note builtins.

## Single-Turn Chat

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withTools({ builtins: true })
  .build();

const reply = await agent.chat("What is the capital of France?");
console.log(reply.message);    // "Paris"
```

## Multi-Turn Session

`agent.session()` maintains conversation history across turns:

```typescript
const session = agent.session();

const r1 = await session.chat("My name is Alex.");
console.log(r1.message); // "Nice to meet you, Alex!"

const r2 = await session.chat("What's my name?");
console.log(r2.message); // "Your name is Alex."

// Inspect current history
console.log(session.history());
// [
//   { role: "user", content: "My name is Alex." },
//   { role: "assistant", content: "Nice to meet you, Alex!" },
//   ...
// ]
```

Turns on one session are serialized. If you call `session.chat()` (or stream a turn) while another is in flight, it queues first-in-first-out, so each turn sees the previous turn's reply and history is never interleaved. A turn that fails releases the queue and the next one proceeds. A streaming turn holds its place until the stream ends, so close or finish streams you no longer need.

## Routing: Direct vs. Tool Path

Routing follows the agent's **capability**, not the message wording. An agent with any capability tool (a custom tool, an MCP server, a sub-agent, the terminal, an opted-in built-in, or documents) sends every message through the tool loop, so "what is the price of bitcoin?" reaches the price tool. The model can still answer a plain message directly via `final-answer` in one iteration. An agent with no capability tools stays on the direct LLM path.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ builtins: ["web-search"] })
  .build();
const session = agent.session();

const r1 = await session.chat("What's the latest AI news?");
console.log(r1.toolsUsed); // ["web-search"]
```

Override routing explicitly with `useTools`:

```typescript
const reply = await session.chat("Summarize the README", { useTools: false }); // direct path
```

### Overriding the Default

`.withToolIntent()` replaces the capability default for every call on that agent:

```typescript
// Your own classifier: return true to take the tool loop.
const custom = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ builtins: true })
  .withToolIntent((message) => !/\b(joke|opinion|what if)\b/i.test(message))
  .build();

// Legacy wording heuristic (requiresTools): only action phrasing such as
// "search for" or "fetch" takes the tool loop. Misroutes "what is the price of bitcoin?".
//   .withToolIntent("message")

// The default, spelled out:
//   .withToolIntent("capability")
```

Precedence: `chat(msg, { useTools })` (explicit, per call) > `.withToolIntent()` (agent-level) > capability default.

**Cost note.** A tools agent runs a kernel iteration even for "hi": still one LLM call and no tool call, but with the tool schemas and harness prompt in the request, so the prompt is larger than on the direct path. Use `{ useTools: false }` or `.withToolIntent(...)` for latency-critical small talk.

## Persisted Sessions

Sessions can be persisted to SQLite so they survive process restarts. Enable persistence when calling `agent.session()`:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory()   // memory layer required for SQLite-backed session persistence
  .build();

// Create or resume a session by ID
const session = agent.session({ id: "user-123-support", persist: true });

const reply = await session.chat("Where were we?");
// On subsequent runs with the same ID, prior history is restored from the DB

// Flush to storage when done
await session.end();
```

Sessions are stored in the memory database under the `chat_sessions` table. Calling `session.end()` flushes the final history to storage — the database record is kept, so the session can still be resumed later by ID.

## Compacting Long History

By default, history windowing (40 turns / 8,000 chars, whichever is smaller) simply drops the oldest turns once a session exceeds it — early-mentioned facts are lost. Pass `onOverflow` to `agent.session()` to fold dropped turns into a running summary instead:

```typescript
let storySoFar = "";
let summarizedTurns = 0;

const session = agent.session({
  onOverflow: async (dropped) => {
    const newTurns = dropped.slice(summarizedTurns);
    summarizedTurns = dropped.length;
    if (newTurns.length === 0) return storySoFar;

    const transcript = newTurns.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = storySoFar
      ? `Existing summary:\n${storySoFar}\n\nMerge in:\n${transcript}`
      : `Summarize:\n${transcript}`;

    const summary = await agent.chat(prompt, { useTools: false });
    storySoFar = summary.message.trim();
    return storySoFar;
  },
});
```

The framework owns the windowing threshold and splice mechanics — `dropped` is always the exact turns that fell outside the window, oldest-to-newest, and the returned string is spliced back in as a synthetic leading turn (`Summary of earlier conversation: ${summary}`) ahead of the windowed turns on every subsequent call. `onOverflow` owns the summarization content only: no prompt or LLM call is baked into the framework, so keep an incremental cache (like `summarizedTurns` above) if you don't want to re-summarize the whole dropped prefix on every call — `dropped` grows across the session, it isn't reset once summarized. Omitting `onOverflow` keeps today's drop-only behavior unchanged.

## Verifying Citations

For tool-grounded agents that are expected to cite sources, pass `verifyCitations: true` to check every URL in the reply against the run's tool-observation evidence:

```typescript
const reply = await session.chat("What's the latest on the Mars mission?", {
  verifyCitations: true,
});

if (reply.citationCheck && !reply.citationCheck.ok) {
  console.warn("Uncited/fabricated URLs:", reply.citationCheck.uncitedUrls);
}
```

`citationCheck` is only populated on the tool-capable path — the direct-LLM path has no tool evidence to check against, so the field is omitted there rather than falsely reporting `ok: true`. Default is off (no cost unless opted in).

## Session with System Context

Give the agent standing context at build time with `.withTaskContext()` — the key-value pairs are injected into the system context of every chat turn:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTaskContext({
    user: "Senior engineer at Acme Corp",
    project: "TypeScript monorepo with Bun",
    style: "Answer in a direct, technical style",
  })
  .build();

const session = agent.session();
const reply = await session.chat("How do I add a new package?");
// Agent knows it's a Bun monorepo and answers accordingly
```

For one-off context on a single turn, pass `extraContext` in the chat options (used on the direct-LLM path):

```typescript
const reply = await session.chat("What should I check first?", {
  extraContext: "The deploy failed with a TLS handshake error.",
});
```

## Streaming Chat

Stream tokens from a chat turn using `agent.runStream()`:

```typescript
process.stdout.write("Assistant: ");
for await (const event of agent.runStream("Explain recursion with an example")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCompleted") console.log("\nDone!");
}
```

## Interactive CLI Loop

Build a terminal chatbot in a few lines:

```typescript
import * as readline from "readline";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("cli-bot")
  .withProvider("anthropic")
  .withTools({ builtins: true })
  .build();

const session = agent.session();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = () => {
  rl.question("You: ", async (input) => {
    if (input.trim() === "exit") return rl.close();
    const reply = await session.chat(input.trim());
    console.log(`Assistant: ${reply.message}\n`);
    ask();
  });
};

ask();
```

## Chat Reply Shape

```typescript
interface ChatReply {
  message: string;             // the assistant's response text
  toolsUsed?: string[];        // tools called (when tools were needed)
  fromMemory?: boolean;        // true if response used prior run context
  tokens?: number;             // token count for this turn (when available)
  steps?: number;              // reasoning steps taken (tool path only)
  cost?: number;                // estimated cost in USD (when available)
  citationCheck?: {             // only set when verifyCitations:true was passed
    ok: boolean;
    uncitedUrls: readonly string[];
    citedUrlCount: number;
  };
}
```

## Session Cleanup

Call `session.end()` to flush history to memory (if persistence is enabled) and clear the in-memory conversation:

```typescript
const session = agent.session({ persist: true, id: "user-123" });

await session.chat("Hello, what can you do?");
await session.chat("Search for TypeScript best practices");

// Flush to storage and clear in-memory history
await session.end();
```
