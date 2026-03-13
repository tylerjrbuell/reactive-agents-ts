---
title: Chat & Sessions
description: Build conversational agents with multi-turn memory using agent.chat() and agent.session().
sidebar:
  order: 7
---

`agent.chat()` enables multi-turn conversation with automatic routing — simple questions go directly to the LLM, complex tasks spin up the full ReAct loop. `agent.session()` wraps a conversation with persistent context.

## Single-Turn Chat

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withTools()
  .build();

const reply = await agent.chat("What is the capital of France?");
console.log(reply.text);       // "Paris"
console.log(reply.routed);     // "direct" — no tools needed
```

## Multi-Turn Session

`agent.session()` maintains conversation history across turns:

```typescript
const session = agent.session();

const r1 = await session.chat("My name is Alex.");
console.log(r1.text); // "Nice to meet you, Alex!"

const r2 = await session.chat("What's my name?");
console.log(r2.text); // "Your name is Alex."

// Inspect current history
console.log(session.history());
// [
//   { role: "user", content: "My name is Alex." },
//   { role: "assistant", content: "Nice to meet you, Alex!" },
//   ...
// ]
```

## Routing: Direct vs. ReAct

The session automatically routes each message:

```typescript
const session = agent.session();

// "direct" — pure Q&A, no tools needed → fast, cheap
const r1 = await session.chat("What's 2 + 2?");
console.log(r1.routed); // "direct"

// "react" — tool use required → full ReAct loop
const r2 = await session.chat("Search the web for today's top AI news");
console.log(r2.routed); // "react"
```

The heuristic checks for tool-indicative keywords and task complexity. Override routing explicitly:

```typescript
const reply = await session.chat("Summarize the README", { forceReact: true });
```

## Persisted Sessions

Sessions can be persisted to SQLite so they survive process restarts:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withSession({ persist: true })   // enable persistence
  .build();

// Resume an existing session by ID
const session = agent.session({ id: "user-123-support", persist: true });

const reply = await session.chat("Where were we?");
// Agent recalls previous turns from the database
```

Sessions are stored in the memory database under the `agent_sessions` table.

## Session with System Context

Seed the session with context the agent should always have:

```typescript
const session = agent.session({
  context: `
    The user is a senior engineer at Acme Corp.
    They are working on a TypeScript monorepo with Bun.
    Answer questions in a direct, technical style.
  `,
});

const reply = await session.chat("How do I add a new package?");
// Agent knows it's a Bun monorepo and answers accordingly
```

## Streaming Chat

Combine chat routing with streaming output:

```typescript
const session = agent.session();

process.stdout.write("Assistant: ");
for await (const event of session.chatStream("Explain recursion with an example")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
}
console.log();
```

## Interactive CLI Loop

Build a terminal chatbot in a few lines:

```typescript
import * as readline from "readline";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("cli-bot")
  .withProvider("anthropic")
  .withTools()
  .build();

const session = agent.session();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = () => {
  rl.question("You: ", async (input) => {
    if (input.trim() === "exit") return rl.close();
    const reply = await session.chat(input.trim());
    console.log(`Assistant: ${reply.text}\n`);
    ask();
  });
};

ask();
```

## Chat Reply Shape

```typescript
interface ChatReply {
  text: string;                      // the assistant's response
  routed: "direct" | "react";       // which path was taken
  tokensUsed?: number;               // token count for this turn
  toolsUsed?: string[];              // tools called (react path only)
  confidence?: "high" | "medium" | "low";
}
```

## Session Limits and Cleanup

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withSession({
    persist: true,
    maxAgeDays: 30,    // auto-expire sessions older than 30 days
  })
  .build();

// Clear a session's history
session.clear();
```
