---
title: Security Hardening
description: >-
  Practical hardening checklist for production agents, tools, and MCP
  transports.
sidebar:
  order: 22
---

This guide focuses on secure defaults and common mistakes in real deployments.

## Baseline Security Profile

`.withBehavioralContracts()` has no declarative `AgentConfig` key, so this baseline profile is builder-only:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withGuardrails()
  .withBehavioralContracts({
    deniedTools: ["code-execute"],
    maxIterations: 10,
  })
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
- **`shell-execute` (host terminal)** — runs allowlisted CLI commands on the machine hosting the agent. Treat it as high privilege: only enable when you understand the default allowlist/blocklist, and prefer Docker-isolated or custom-hardened registration for anything user-facing. In **Cortex**, host shell is off by default and must be explicitly enabled in the Lab builder; the UI surfaces this as an at-your-own-risk choice.
- Require approval for state-changing tools where possible — gate them with `.withApprovalPolicy({ tools: [...], mode: "detach" })` so the run waits for a human; add `.withDurableRuns()` when the pause must survive process death. See [Human-in-the-Loop Approval](/guides/durable-hitl/).
- Isolate file-write scope to approved directories.

## Trust Boundaries

Each boundary below is enforced by the framework; know where it ends.

- **File root and secret paths.** `file-read`, `file-write`, `file-edit`, `list-directory` and `grep` are confined to the file root, with symlinks resolved first. They also refuse credential paths inside the root (`.env`, `.env.*`, `.ssh`, `.cortex`, `secret.key`, `provider-keys.json`, ...). A host that needs one opts out explicitly by wrapping the call in `withSecretPathAccess` from `@reactive-agents/tools`.
- **Shell.** `shell-execute` (only with `.withTools({ terminal: true })`) uses a program allow-list. `sed` and `awk` programs are parsed and refused unless every construct is known safe (no `e`/`w`/`r`, `system()`, `getline`, pipes or output redirects), `sort --compress-program` is refused, and option values are path-checked. `gh` and `gws` credentials are forwarded only when that command is granted.
- **SSRF.** `assertPublicUrl` blocks private, loopback, link-local and cloud-metadata targets, including IPv6-mapped, NAT64 and 6to4 forms of them. Metadata addresses stay blocked even with `allowPrivate`.
- **Approval policy.** `requiresApproval` on a tool is not enforced by itself. Call `.withApprovalPolicy()` so the run waits for a human. Rules match the program that runs, so `git -C dir push` and `env git push` still match a `"git push"` rule.
- **Redaction.** Traces, logs and OTel exports redact common API-key formats, PEM private keys, `Basic` credentials and `password=` / `secret=` / `token=` assignments. Redaction is pattern-based: keep unusual secret formats out of prompts and tool output.
- **File modes.** Traces, logs, durable runs (`runs.db`), memory, scratchpad spill files and `.cortex/` are created owner-only (directories `0700`, files `0600`). Existing files keep their modes.
- **Gateway access control.** Set `accessControl` on the gateway explicitly, with `accessPolicy: "allowlist"` and platform-prefixed `allowedSenders` (`signal:+15551234567`). Do not rely on defaults for a channel that reaches a tool-using agent. Empty webhook secrets fail closed. See [Gateway](/features/gateway/).
- **SDK server.** `rax deploy --mode sdk` generates a server that requires `Authorization: Bearer <RAX_API_KEY>` on `/chat` and `/chat/stream`. Set `RAX_API_KEY` yourself; otherwise a random key is printed once at startup.
- **Cortex.** Loopback needs no token. Any other bind requires `CORTEX_TOKEN`. See [Settings and keys](/features/cortex/settings-and-keys/#access-token).

## Audit

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
- [ ] `.withApprovalPolicy()` set for state-changing tools
- [ ] Gateway `accessControl` set; `RAX_API_KEY` / `CORTEX_TOKEN` set where those servers are exposed
- [ ] MCP transports authenticated and scoped
- [ ] Agent disposal guaranteed
- [ ] Audit logging enabled
- [ ] Budget limits configured
- [ ] On-call alerts wired

## What's Next

- [Guardrails](/guides/guardrails/) — the injection/PII/toxicity detection layer this checklist builds on
- [Production Checklist](/guides/production-checklist/) — the full deployment checklist, security is one section of
- [Production Deployment](/cookbook/production-deployment/) — a worked example applying this hardening
