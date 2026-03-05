---
title: Security Hardening
description: Practical hardening checklist for production agents, tools, and MCP transports.
sidebar:
  order: 12
---

This guide focuses on secure defaults and common mistakes in real deployments.

## Baseline Security Profile

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withGuardrails()
  .withBehavioralContracts({
    deniedTools: ["code-execute"],
    maxIterations: 10,
  })
  .withIdentity()
  .withAudit()
  .withKillSwitch()
  .build();
```

## Guardrails and Contracts

- Keep `.withGuardrails()` enabled for all user-facing entry points.
- Use behavioral contracts to constrain tool access by policy, not by prompt text.
- Prefer allowlists/denylists for tools in high-trust environments.

## MCP Hardening

- Prefer `streamable-http` with explicit auth headers for remote servers.
- For `stdio`/Docker, keep containers minimal and ephemeral (`--rm`).
- Separate host CLI env from container env; only pass required secrets.
- Always use deterministic cleanup (`await using` or `runOnce()`).

## Secret Management

- Never embed secrets in docs examples committed to source control.
- Keep per-server credentials in environment variables.
- Pass only minimal auth headers per MCP server.

## Tool Risk Reduction

- Disable `code-execute` unless strictly required.
- Require approval for state-changing tools where possible.
- Isolate file-write scope to approved directories.

## Identity and Audit

- Enable `.withIdentity()` for RBAC and delegation controls.
- Enable `.withAudit()` to preserve action history for investigations.
- Subscribe to security-relevant events and alert in near real-time.

## Incident Readiness

- Wire kill switch activation into on-call procedures.
- Add alerts for repeated guardrail violations and budget exhaustion.
- Keep a tested rollback path for model/provider configuration changes.

## Deployment Checklist

- [ ] Guardrails enabled
- [ ] Behavioral contracts defined
- [ ] Kill switch enabled
- [ ] MCP transports authenticated and scoped
- [ ] Agent disposal guaranteed
- [ ] Audit logging enabled
- [ ] Budget limits configured
- [ ] On-call alerts wired
