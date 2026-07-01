---
title: Reactive Agents vs the OpenAI / Claude Agent SDKs
description: >-
  When a vendor Agent SDK is enough — and when a framework earns its keep. An
  honest look at raw SDKs vs Reactive Agents for building TypeScript agents.
sidebar:
  order: 24
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: >-
    docs(accuracy): fix strategy IDs, withModelRouting section, sub-package
    import
  hash: 1216d5f
  date: '2026-07-01'
since: v0.12
---

A real 2026 question: vendor Agent SDKs (OpenAI Agents SDK, the Claude Agent SDK) got good, model APIs converged, and "just call the SDK" is now legitimate advice. So before reaching for *any* framework — including this one — it's worth being honest about when you don't need one.

This page is that honest take.

## The altitude difference

A vendor Agent SDK is a **first-party toolkit for one provider**: a clean tool-calling loop, structured output, handoffs, and tracing, tuned for that vendor's models. Reactive Agents is a **vendor-neutral agent harness**: a typed runtime and execution engine that wraps *any* provider and adds the production layers an SDK leaves to you.

Neither is strictly "better" — they sit at different altitudes. The SDK is the right floor for a lot of apps. The question is whether your problem needs the floor above it.

## At a glance

| | Reactive Agents | Vendor Agent SDK |
|---|---|---|
| Scope | Multi-provider harness | Single vendor, first-party |
| Provider lock-in | None (Anthropic, OpenAI, Gemini, Ollama, LiteLLM) | Tied to the vendor |
| Local models | First-class — same code on 4B Ollama and frontier | Generally not a goal |
| Type model | Typed effect runtime (errors as values, structured concurrency) | Idiomatic SDK types |
| Execution model | Deterministic 12-phase engine + per-phase hooks | The SDK's loop |
| Reasoning strategies | 6 (ReAct, Reflexion, Plan-Execute, ToT, Adaptive, Code-Action) | The SDK's loop |
| Tools | MCP-native + typed builder | Vendor tools (+ MCP on some) |
| Guardrails / cost routing / budgets | Built in | Bring your own |
| Durable execution + crash-resume | Built in | Bring your own |
| Observability | OpenTelemetry + local studio, no SaaS tether | Vendor tracing (often hosted) |
| Best at | Portable, governed, multi-step agents | Fast first-party loops on one vendor |

<sub>"Vendor Agent SDK" generalizes the OpenAI Agents SDK and the Claude Agent SDK; specifics differ and both evolve fast. Corrections welcome via PR.</sub>

## When a vendor SDK is the right call

Be honest with yourself — reach for the raw SDK when:

- **You're committed to one provider** and happy there. The first-party SDK will always track that vendor's newest features first.
- **Your loop is simple** — a few tools, a few steps, no durability or governance requirements.
- **You want the fewest dependencies** and the most direct path to that vendor's models.
- **You're prototyping.** Start with the SDK; reach for a harness when the production requirements show up.

If that's you, use the SDK. A framework would be overhead.

## When Reactive Agents earns its keep

The harness pays for itself when you need things the SDK leaves to you:

- **Portability across providers — including local.** The same agent code runs on a 4B Ollama model on your laptop and on Claude/GPT/Gemini, one line different. Develop and test locally and privately; swap to a frontier model for production. A single-vendor SDK can't do this by design.
- **A typed runtime, not just typed calls.** Built on Effect-TS: an LLM or tool failure is a value in an explicit error channel, concurrency is structured, retries and fallbacks compose. You inherit those guarantees through a plain async API — you don't write Effect.
- **Determinism and inspectability without a SaaS.** Every run is a 12-phase lifecycle with before/after/error hooks on each phase, inspectable locally. No hosted tracing subscription required.
- **Production layers built in.** Guardrails, cost routing and budgets, durable crash-resume, human-in-the-loop approvals, and multi-agent (A2A) — composable layers, not things you reassemble per project.

In short: use the SDK for a loop on one vendor; use Reactive Agents when you need a portable, typed, governed agent across vendors and local hardware.

## You can use both

These aren't mutually exclusive. A vendor SDK is a fine way to talk to one provider; Reactive Agents is how you make an agent out of it that's portable, observable, and safe to run unattended. Many teams start on an SDK and adopt a harness when the production requirements arrive.

Honest note: Reactive Agents is early access (v0.12.0, MIT). The vendor SDKs are backed by their providers and move fast. The bet here is the architecture — typed runtime, local-to-frontier portability, observable-by-construction — and it's real and testable today.

Ready to try it? Start with the [Quickstart](/guides/quickstart/), or see [Build AI Agents in TypeScript](/guides/build-ai-agents-typescript/) for the full picture.
