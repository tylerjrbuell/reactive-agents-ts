---
title: Security Hardening
description: >-
  Practical hardening checklist for production agents, tools, and MCP
  transports.
sidebar:
  order: 22
topic: safety
related:
  - guides/tools
  - guides/guardrails
  - guides/durable-hitl
  - guides/production-checklist
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

Transports, auth and Docker options are documented in [MCP Support](/guides/tools/mcp-tools/). This is the checklist:

- Prefer `streamable-http` with explicit auth headers for remote servers.
- For `stdio`/Docker, keep containers minimal and ephemeral (`--rm`).
- Separate host CLI env from container env; only pass required secrets.
- Always use deterministic cleanup (`await using` or `runOnce()`).
- Know which MCP tools an approval policy gates. A tool the server annotates `destructiveHint: true` or `readOnlyHint: false` is gated automatically. A tool with no annotation (effect `unknown`) is not: name it in the policy as `"server/tool"`, or match it with `requireFor`. See [What a policy gates](/guides/durable-hitl/#what-a-policy-gates).

## Secret Management

- Never embed secrets in docs examples committed to source control.
- Keep per-server credentials in environment variables.
- Pass only minimal auth headers per MCP server.

## Tool Risk Reduction

- Disable `code-execute` unless strictly required. By default it runs model-written JavaScript/TypeScript (Bun) or Python 3 (host `python3`) as a subprocess on the host. **It is not isolated:** the code runs as your OS user, can read host files by absolute path and has the host's network access. Only `PATH` and `HOME` are passed in its environment, so your API keys are not. Set `RA_SANDBOX=docker` to run it in a throwaway container instead (no host fallback; the Python path through Docker is untested). See [code-execute](/guides/tools/built-in-tools/#code-execute).
- **`shell-execute` (host terminal)** — runs allowlisted CLI commands on the machine hosting the agent. Treat it as high privilege: only enable when you understand the default allowlist/blocklist, and prefer Docker-isolated or custom-hardened registration for anything user-facing. In **Cortex**, host shell is off by default and must be explicitly enabled in the Lab builder; the UI surfaces this as an at-your-own-risk choice.
- Require approval for state-changing tools where possible — gate them with `.withApprovalPolicy({ tools: [...], mode: "detach" })` so the run waits for a human; add `.withDurableRuns()` when the pause must survive process death. See [Human-in-the-Loop Approval](/guides/durable-hitl/).
- Isolate file-write scope to approved directories.

## Trust Boundaries

Each boundary below is enforced by the framework; know where it ends.

- **File root and secret paths.** `file-read`, `file-write`, `file-edit`, `list-directory` and `grep` are confined to the file root, with symlinks resolved first. They also refuse credential paths inside the root (`.env`, `.env.*`, `.ssh`, `.cortex`, `secret.key`, `provider-keys.json`, ...). A host that needs one opts out explicitly by wrapping the call in `withSecretPathAccess` from `@reactive-agents/tools`.
- **Shell.** `shell-execute` (only with `.withTools({ terminal: true })`) uses a program allow-list. `sed` and `awk` programs are parsed and refused unless every construct is known safe (no `e`/`w`/`r`, `system()`, `getline`, pipes or output redirects), `sort --compress-program` is refused, and option values are path-checked. `gh` and `gws` credentials are forwarded only when that command is granted.
- **SSRF.** `assertPublicUrl` blocks private, loopback, link-local and cloud-metadata targets, including IPv6-mapped, NAT64 and 6to4 forms of them. Metadata addresses stay blocked even with `allowPrivate`. `assertPublicUrl` alone checks one DNS answer and the caller's `fetch()` resolves the name again, so a DNS-rebinding server can answer public first and private second. For a user-controlled URL use `fetchPinned` from `@reactive-agents/runtime-shim`: it resolves once, checks every answer, connects to that address (the `Host` header and TLS server name keep the real hostname), and re-validates and re-pins every redirect hop (default cap 5; credential headers are dropped on cross-origin hops). Refusals reject with a `PublicUrlError` (`_tag: "PublicUrlError"`). It does not decompress responses or honour proxy environment variables.
- **Approval policy.** `requiresApproval` on a tool is not enforced by itself. Call `.withApprovalPolicy()` so the run waits for a human. Once a policy is set, it gates every registered tool with `requiresApproval: true`, MCP tools annotated as writing, `.withAgentTool()` sub-agent tools (their `requiresApproval` defaults to `true`) and `agent.registerTool()` tools that set the flag, under every strategy ([What a policy gates](/guides/durable-hitl/#what-a-policy-gates)). Before 0.19, MCP, sub-agent and `registerTool()` tools ran ungated. Rules match the program that runs, so `git -C dir push` and `env git push` still match a `"git push"` rule.
- **Code-action under a policy.** `code-action` runs tool calls inside a sandbox worker, past the gate, so it refuses the run when a tool it can call is gated, when `commands` rules meet a callable `shell-execute`, or when `requireFor` is set. Check ahead of a run with `codeActionApprovalConflict` from `reactive-agents`. See [Code-action and approval](/guides/durable-hitl/#code-action-and-approval).
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
