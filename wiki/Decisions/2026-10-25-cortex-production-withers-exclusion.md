---
type: decision
status: accepted
created: 2026-10-25
authored-by: OpenCode
related: "[[Architecture/Design-Specs/2026-10-25-cortex-chat-engine-overhaul-spec|cortex chat engine overhaul spec]]"
tags: [cortex, withers, config-parity, decision]
---

# Cortex production-hardening withers: deliberately excluded

**Status:** accepted (2026-10-25).
**Scope:** `apps/cortex` builder surface (`build-cortex-agent.ts`, `runner-service.ts`, `gateway-process-manager.ts`, `cortex-agent-config.ts`, `cortex-to-agent-config.ts`).

## Decision

Cortex is a **local dev desk** whose job is to let a developer exercise the Reactive Agents framework hands-on. The following builder withers are **deliberately NOT exposed** in the Cortex UI, config schema, or agent builder, and future drift audits MUST NOT re-flag them as missing:

| Wither | Reason |
|---|---|
| `withCircuitBreaker` | Infra-level resilience; cortex runs single-process locally; no multi-tenant traffic to protect |
| `withRateLimiting` | Same as above; no external ingress to throttle |
| `withA2A` | Agent-to-agent networking is a deployment concern; cortex is a single agent desk |
| `withChannels` | External channel layer (webhooks/bots) is gateway territory, not the desk |
| `withReceiptSigning` | Provenance signing matters for production audit trails; cortex runs are ephemeral dev runs |
| `withAudit` | Audit trails are a compliance feature; cortex captures events via its own SQLite store |
| `withContract` | Behavioral contracts are a production guardrail; cortex keeps guardrails as the simpler boolean surface |
| `withCalibration` | Calibration is automatic; no UI knob adds value for a dev desk |
| `withBehavioralContracts` | Same as `withContract` |
| `withSelfImprovement` | Self-improvement consolidates into memory; cortex exposes memory tiers directly |

## Deferred (not excluded, just not yet)

- **Thompson-sampling bandit strategy selector** (opt-in, off by default) — expose when a second strategy-selector consumer exists.
- **RAG document management** (delete/re-ingest, per-document status, progress polling, doc timeline UI) — Phase 5 shipped minimal ingestion only.
- **`withHarness()` partial exposure** — the typed control surface is exposed via the Advanced JSON field; individual toggles beyond the JSON escape hatch are deferred until a second consumer asks.

## Enforcement

The `config-parity` coverage guard (`apps/cortex/server/tests/config-parity.test.ts`, "config coverage guard") codifies this list in its `NOT_APPLICABLE` set. A new wither added to `packages/runtime/src/builder.ts` must be classified into `WIRED`, overlay-reachable, or `NOT_APPLICABLE` with a one-line justification. If a wither on this list becomes worth exposing, remove it from `NOT_APPLICABLE` and add the UI + builder wiring in the same PR.