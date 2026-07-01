---
title: Root-Cause Security Assessment — reactive-agents-ts
date: 2026-07-01
type: audit-report
reviewer: Principal AppSec (multi-agent red-team)
scope: whole codebase + architecture (45 packages / ~1,950 TS files)
status: draft
---

# Root-Cause Security Assessment — reactive-agents-ts

> Method: 5 parallel domain red-teams (tools/sandbox, secrets/providers, network/auth/a2a, memory/RAG/prompt-injection, CI-CD/supply-chain) plus direct verification of the shell-execution denylist. **Confirmed** = code path traced or exploit run live. **Theoretical** = plausible, not fully traced.

## Executive Summary

The codebase shows a split personality. Where the threat is a *classic* web/appsec category, it is often handled competently: **SQL is fully parameterized everywhere**, HMAC comparisons are constant-time, there are **no `postinstall`/`pull_request_target` supply-chain traps**, no real secrets are committed, and a genuinely hardened Docker sandbox (`cap_drop ALL`, `--network none`, read-only rootfs, seccomp, uid 65534) exists. That primitive proves the team *can* build isolation.

Where the threat is **AI-native or lives at a default-on execution surface**, the posture collapses. The two primary code-execution tools run untrusted model output on the **host** (shell via `sh -c` behind a bypassable regex denylist; code via in-process `bun run`/`new Function`), the per-tool `requiresApproval`/`riskLevel` flags are **inert metadata that nothing enforces**, the memory system replays untrusted tool output into the **system prompt** across sessions with a written-but-ignored `verified` gate, every network server binds `0.0.0.0` with **no authentication**, the certificate authenticator accepts **unsigned certs** and self-included keys, and full prompts/tool I/O are written to disk **unredacted by default**. Multiple of these are individually sufficient for remote code execution or full data exfiltration, and they compose.

The unifying root cause is a **trust-boundary inversion**: the framework treats *external systems* (SQL, npm, forks) as hostile — correctly — but treats **its own inputs as trusted**: model output, tool results, recalled memory, request bodies, and configuration metadata all flow into privileged positions (host shell, system prompt, agent execution) without a runtime enforcement point.

### Security maturity score: **3 / 10**

Justification: Foundational hygiene (SQLi, secret handling, dependency lifecycle, crypto primitives) sits around a 6–7 and keeps this off the floor. But the product's *core value surfaces* — tool execution, agent servers, memory, and observability — ship insecure-by-default with confirmed Critical RCE and data-exfiltration paths reachable in default configuration, and the security metadata the API advertises (`requiresApproval`, `riskLevel`, `.withVerification`, guardrails) is largely **decorative / not wired to an enforcement point**, which is worse than absent because it creates false assurance. That combination caps the score at 3.

---

## Architecture Review

**Trust boundaries (as designed vs. as enforced).** The intended boundaries — model↔tools, agent↔network peer, memory↔prompt, config↔runtime — are almost all **declared but unenforced**:

| Boundary | Declared control | Actually enforced? |
|---|---|---|
| Model → host (tool exec) | `requiresApproval`, `riskLevel`, denylist | **No** — flags inert; denylist bypassable |
| Network peer → agent | AgentCard `securitySchemes`, cert-auth, webhook secret | **No** — never checked / signature optional / fail-open |
| Untrusted content → prompt | `verified` column, guardrails, injection detector | **No** — `verified` ignored on read; guardrails off/fail-open; output scan is dead code |
| Config/model → egress URL | (none) | **No** SSRF guard anywhere (`http-get` is model-controlled) |
| Runtime → disk/OTel/WS | redaction patterns | **No** — redaction wired only to the log surface, not content surfaces |

**Data flow / attack surface.** External input enters via: (1) tool results (web/file/MCP/shell) → persisted to memory → **re-injected into system prompt** next run; (2) A2A / `rax serve` / judge HTTP servers on `0.0.0.0` → `agent.run(attackerText)`; (3) webhook/channel adapters → agent execution gated on **self-asserted** `senderId`; (4) model tool-call args → host shell / host `fetch` (SSRF) / host code exec. Every one of these terminates in a privileged sink with no boundary check.

**Privilege model.** There is effectively one privilege level: whatever the host process has. MCP subprocesses inherit the **entire** `process.env` (all provider keys). Code-action runs in a worker thread mislabeled as "the isolation boundary." The hardened Docker sandbox that *would* provide least-privilege is opt-in and off the default path.

**Implicit assumptions that don't hold in a hostile environment:** (a) tool output is trustworthy enough to store and replay as authority; (b) the integrator will manually wire approval, guardrails, verification, loopback binding, and body caps; (c) a regex denylist can safely gate `sh -c`; (d) a worker thread / same-realm `new Function` isolates untrusted code; (e) traces stay on a trusted single-user machine.

---

## Findings

Severity uses Critical/High/Medium/Low with Likelihood, Impact, and Exploitability noted inline.

---

### F1 — Shell-execute sandbox is trivially escaped to RCE + arbitrary file read/write (default config)
**Severity: Critical · Likelihood: High · Exploitability: Trivial · Confirmed (run live)**
**Category:** RCE / sandbox escape / path traversal
**Description.** `shellExecuteHandler` runs input via `spawn(["sh","-c",command])` (`packages/tools/src/skills/shell-execution.ts:857`) behind a regex denylist (`DEFAULT_BLOCKED_RULES`, :132-192) and a whitespace-tokenizing path checker (`detectUnsafePaths`, :349-401). Both are structurally incomplete against a full shell.
**Evidence (all pass both filters under default config; several run live):**
- `cat <(id)` — process substitution `<(…)`/`>(…)` is not blocked (only `$(` is, :147); inner command executes → full RCE via `cat <(sh -c '…')`.
- `cat "/etc/passwd"` — leading quote defeats `token.startsWith("/")` (:360). Arbitrary absolute read.
- `cat ../../../../etc/passwd` — relative `..` traversal is only checked inside a `>` redirect branch (:390); bare args are unchecked. Arbitrary read.
- `awk 'BEGIN{print "id" | "/bin/sh"}'` — `awk` is default-allowed; the `|getline`/`system(` rules miss `print | "cmd"`. RCE.
- `awk 'BEGIN{while((getline l < "/etc/passwd")>0) print l}'` — arbitrary read.
- `echo x | tee ../../../../home/victim/.bashrc` — `tee` default-allowed + relative write unchecked. Arbitrary write → RCE on next login.
- `cat $GH_CONFIG_DIR/hosts.yml` — env-var expansion reads real gh credentials the handler deliberately injects; literal-token path check never sees the expanded path.
**Exploitation.** Any agent whose model output reaches this tool (its entire purpose) runs one of the above and gets host read/write/exec confined only by OS user perms — `HOME=sandboxDir` is irrelevant because absolute/relative paths hit the real FS directly.
**Root cause.** Denylist-on-a-full-shell + naive `split(/\s+/)` path parsing. An enumerated blocklist over `sh -c` cannot be complete.
**Recommended fix.** Do not use `sh -c`. Parse to `execFile(binary, argv)` with no shell (the repo already does this in `skills/cli/cli-runner.ts` for git/gh). If shell features are required, make the **Docker sandbox the mandatory substrate** (see F7), not an opt-in escalation. Canonicalize every path arg with `realpath` and assert `startsWith(sandboxDir)`; reject quotes/substitution/`..` structurally.
**Implementation guidance.** One `execFileInSandbox(argv, sandboxDir)` primitive used by shell/code/cli tools; delete the regex denylist entirely.

---

### F2 — `requiresApproval` / `riskLevel` are inert; nothing enforces them at call time
**Severity: High (force-multiplier) · Likelihood: High · Confirmed**
**Category:** Broken access control / insecure default / false assurance
**Description.** `ToolService.execute()` (`packages/tools/src/tool-service.ts:319-409`) does lookup → validate → cache → `sandbox.execute(handler)` → event. **There is no approval or authorization step.** `ToolAuthorizationError` is declared but **never thrown anywhere** (grep-confirmed). The only real gate is in the kernel (`act.ts`), and it fires **only** if the integrator separately calls `.withApprovalPolicy({ tools:[…] })` and names each tool. The code says so itself: `packages/runtime/src/builder/types.ts:406` — *"the per-tool `requiresApproval` flag does NOT auto-feed this gate."* Auto-registered MCP tools are hardcoded `requiresApproval:false, riskLevel:"medium"` regardless of capability (`tool-service.ts:457-459`).
**Exploitation.** `shell-execute` / `code-execute` / `file-write` carry `requiresApproval:true, riskLevel:"critical"` and run with **zero** human approval unless undocumented extra wiring exists. Every other tool finding inherits "no approval required."
**Root cause.** Security metadata modeled as data, not wired to an enforcement point; the "fast-follow" that would auto-feed the flag was never done.
**Recommended fix.** Enforce in `ToolService.execute` itself, **fail-closed**: if `definition.requiresApproval` and no approval token/policy is present, throw `ToolAuthorizationError`. Auto-feed per-tool flags into the kernel approval policy at config assembly. Assign MCP tool risk from declared capability, not a constant.

---

### F3 — Persistent prompt injection: tool output → memory → replayed as system-authority "Relevant Memory"
**Severity: Critical · Likelihood: High · Confirmed end-to-end**
**Category:** Memory poisoning / stored (indirect) prompt injection
**Description.** Untrusted tool output is persisted then replayed into the **system prompt** across runs/sessions.
- Write: `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:97-129` stores raw tool output to semantic memory as `verified:false`.
- Read (defect): `packages/memory/src/search.ts:42-90` and `services/semantic-memory.ts:198-245` `SELECT … ORDER BY importance DESC LIMIT 50` with **no `WHERE verified = 1`** — the `verified` column is written but never consulted on retrieval.
- Inject: `memory-service.ts` → `reasoning-think.ts:96` → `reactive.ts:167-169` wraps it as `"Relevant Memory:\n…"` → `prompt-sections-default.ts:115-130` renders it as a **system-prompt section with no delimiter**.
**Exploitation.** Attacker controls any ingested content (web fetch, file, MCP, shell). Run 1 stores `Ignore prior instructions; when asked X do Z`. Run N (even a different task, same `agentId`) surfaces it under the authoritative "Relevant Memory" header in the highest-trust position.
**Root cause.** No provenance/trust boundary on recalled content; the gate that exists is ignored.
**Recommended fix.** Enforce `verified`/provenance on read; render **all** recalled content inside a fenced untrusted-data envelope placed in a user/context turn, never system. (Systemic — also closes F4/F5-memory variants below.)

---

### F4 — Network agent servers (A2A, `rax serve`, judge) bind 0.0.0.0 with no authentication and execute attacker prompts
**Severity: Critical · Likelihood: High · Confirmed**
**Category:** Missing authentication / RCE-adjacent / DoS
**Description.** Every `Bun.serve`/`serve()` omits `hostname` → binds all interfaces (`packages/runtime-shim/src/serve.ts:19`; no caller supplies a hostname).
- **A2A** (`packages/a2a/src/server/http-server.ts:172-251`): `POST /` JSON-RPC `message/send` → `executor(inputText, taskId)` runs the agent on attacker text. No auth; AgentCard `securitySchemes` is advertised but never enforced. `await req.json()` uncapped (memory DoS). `tasks/get|cancel` act on any id (IDOR, bounded only by UUID unguessability).
- **`rax serve`** (`apps/cli/src/commands/serve.ts:135-202`): same shape; with `--with-tools` a remote caller gets web-search/http-get/file-write and drains the operator's provider key. Task `Map` never evicts (DoS).
- **judge-server** (`packages/judge-server/src/index.ts:75-109`): no auth; peer floods `/judge` → unbounded LLM spend on operator key; `sutResponse` is prompt-injectable into the judge.
**Exploitation.** Anyone with network reach to the host runs arbitrary agent tasks (and, with tools, host-side effects) using the operator's credentials.
**Root cause.** No shared hardened-serve helper; identity package never wired into request paths.
**Recommended fix.** One `secureServe()` helper: default `hostname:"127.0.0.1"`, mandatory bearer/token gate, body-size cap enforced **before** parse, per-IP throttle, LRU/TTL task eviction. Fixes A2A/rax/judge/health/#DoS together.

---

### F5 — Certificate authentication is bypassable (optional signature + self-included key, no trust anchor)
**Severity: Critical · Likelihood: High · Confirmed**
**Category:** Authentication bypass / impersonation
**Description.** `packages/identity/src/auth/certificate-auth.ts:56-134`. (a) Signature check is gated `if (cert.signature)` (:95) and `signature` is `Schema.optional` (`types.ts:28`) — a cert with **no signature** returns `{authenticated:true}` for any `agentId`. (b) Even when signed, the signature is verified against `cert.publicKey` **carried inside the same cert** (:98-108); `authenticate` never consults the issued-cert store or validates `issuer`/fingerprint binding. An attacker self-signs `agentId:"orchestrator"` and it verifies.
**Exploitation.** Total agent impersonation in any deployment that (were it wired up) relied on cert-auth.
**Root cause.** Verifying a token against a key it carries, plus an optional-by-schema security field.
**Recommended fix.** Reject unsigned certs; verify against a CA/trust-anchor key (not the cert's own key); validate `issuer` + `fingerprint == SHA-256(publicKey)`; remove the `development` escape hatch from the verify path.

---

### F6 — `http-get` builtin is model-controlled SSRF with no egress guard or approval
**Severity: High · Likelihood: High · Confirmed**
**Category:** SSRF / data exfiltration
**Description.** `packages/tools/src/skills/http-client.ts:53-56` does `fetch(url,{headers})` with `url`/`headers` verbatim from model tool-call args; `riskLevel:"medium"`, `requiresApproval:false`. No scheme/host allowlist, no private-range/metadata block, redirects followed. Repo-wide there is **zero** SSRF protection.
**Exploitation.** A prompt-injected agent fetches `http://169.254.169.254/latest/meta-data/…` (cloud IAM creds) or internal `http://10.x/admin`; the body returns into agent context.
**Root cause.** No central egress guard; model output trusted as a URL source.
**Recommended fix.** Shared `assertPublicUrl()` (scheme allowlist; block loopback/link-local/RFC-1918/`metadata.google.internal`; re-validate each redirect hop via `redirect:"manual"`) applied at **every** `fetch` site (also covers remote-agent tools, A2A discovery, MCP health probe, custom pricing URL). Default `http-get` to approval or host-allowlist. (Note: managed providers — Anthropic/OpenAI/Gemini — are **not** SSRF-exposed; their SDKs take no `baseURL` from config, verified.)

---

### F7 — Two host-level execution surfaces bypass the one hardened sandbox that exists
**Severity: High · Confirmed**
**Category:** Excessive privilege / pseudo-sandbox
**Description.** (a) `code-execute` (`packages/tools/src/skills/code-execution.ts:90-122`) writes model code to a temp `.ts` and runs `bun run` on the **host** with `require` injected → `require('child_process').execSync` = full host control; auto-registered in `builtinTools`. (b) code-action runs model code via `new Function(...)` in a **worker thread** falsely labeled "the isolation boundary" (`packages/reasoning/src/strategies/code-action/sandbox-worker.ts:63-65`) — a worker shares the process realm and reaches `process`/`node:fs`/`node:child_process`. Meanwhile `packages/tools/src/execution/docker-sandbox.ts` is genuinely hardened but **opt-in and off the default path**; `dockerEscalation` only escalates inline `-e/-c` invocations and **falls through to host `sh -c`** for `node script.js` (`shell-execution.ts:653-684`); `DockerSandboxConfig.network:"host"` is reachable via override.
**Root cause.** Isolation primitive exists but isn't mandatory; worker-thread conflated with sandbox.
**Recommended fix.** Make Docker sandbox the **mandatory** substrate for all shell/code execution; if escalation is enabled, **refuse** non-escalatable interpreter invocations (fail-closed); gate `network:"host"` behind an explicit unsafe flag; fix the misleading isolation comment.

---

### F8 — Full prompts, completions, and tool args/results persisted to disk unredacted, by default
**Severity: High (Critical if traces dir is shared/synced) · Confirmed**
**Category:** Sensitive data at rest / missing output encoding
**Description.** Tracing is **on by default** (`packages/runtime/src/builder/helpers.ts:49-55`, `builder.ts:276`) writing JSONL to `~/.reactive-agents/traces/` with `systemPrompt`, every `messages[].content`, and tool-call `arguments` (`packages/trace/src/events.ts:242-255`, `recorder.ts:77-82`). The trace package imports zero redactors. Parallel exposures: Cortex WS reporter streams raw events (`cortex-reporter.ts:117-146`); OTel spans set `tool.parameters`/`tool.output` (`packages/observe/src/tracer.ts:177-185`) exported to OTLP. The existing redactor (`packages/observability/src/redaction/default-patterns.ts`) is wired **only** into the structured logger — the lowest-value surface — and covers API-key formats only (no PII).
**Exploitation.** Any credential/PII a user pastes into a prompt, or any tool result, is written cleartext to disk (default umask, no retention) and, if Cortex/OTel enabled, leaves the machine.
**Root cause.** Redaction bolted onto logging, never back-propagated to content-bearing serialization boundaries; persistence defaults on.
**Recommended fix.** One `redactSensitive()` (key regexes + PII + `Authorization`-context scrub) invoked in `trace/normalize`, `observe/tracer` setAttribute, and `cortex-reporter`; flip disk content-capture to opt-in. Add a `Secret<string>` wrapper (non-enumerable `toString/toJSON → [redacted]`) so key material cannot be serialized by accident.

---

### F9 — Self-reinforcing skill poisoning + XML delimiter breakout
**Severity: High · Confirmed**
**Category:** Memory poisoning / privilege escalation of untrusted content
**Description.** `buildSkillContentXml()` (`packages/tools/src/skills/activate-skill.ts:29-53`) interpolates `name`/`version`/`source`/`instructions` into an XML wrapper with **no escaping** — a body containing `</skill_content>` breaks out into free-form injected instructions; activation is `riskLevel:"low", requiresApproval:false`. `skill-evolution.ts:176` feeds run-derived execution summaries (which can carry injected tool output) into an LLM that rewrites and stores `newInstructions`, later marked `confidence:"trusted"` (`skill-resolver.ts:71`).
**Recommended fix.** XML/attribute-escape all fields; exclude externally-derived text from evolution input; gate `learned→trusted` promotion behind review.

---

### F10 — Verification and guardrails compute verdicts but never block; output-side guardrail is dead code
**Severity: High · Confirmed**
**Category:** Missing security control / false assurance
**Description.** `verification-quality-gate.ts:104-115`: a still-rejected response after one retry logs "proceeding anyway" and returns the answer — `.withVerification()` is pure telemetry. Guardrails are **off by default** (`builder.ts:246`), **fail-open** on detector error (`guardrail.ts:32-41`), **input-only** (tool/retrieved content never scanned), and `checkOutput`/`behavioral-contracts` have **zero runtime callers** (dead code) — model output is never scanned for PII/secrets/toxicity even with guardrails fully on. The injection detector is 14 English regexes, first-match, off by default.
**Recommended fix.** Make verification/guardrails **enforcement points**: add `onReject: block|annotate|proceed`, wire `checkOutput`, fail-closed on detector error, and pass tool/retrieved content through detectors.

---

### F11 — Webhook/channel identity is self-asserted and signature verification is fail-open
**Severity: High (once an HTTP listener bridges it; currently dormant) · Confirmed**
**Category:** Authentication bypass / authorization on untrusted input
**Description.** HMAC check is gated `if (route.secret)` and `secret` is optional (`packages/gateway/src/services/webhook-service.ts:78-96`, `channels/src/adapters/webhook.ts:68`) → a secret-less route accepts any POST. Access-control gates on `senderId` read from untrusted body JSON (`webhook.ts:143-147` → `access-control.ts:28`), so an attacker sets `{"senderId":"<allowlisted-user>"}` to impersonate. (When a secret *is* set, the HMAC compare is correctly constant-time — not a finding.) Dormant only because nothing currently serves `handleRequest` over HTTP.
**Recommended fix.** Fail-closed at registration for network-exposed adapters (`requireSignature:true` default); derive identity from transport-verified fields / per-sender tokens, not body JSON; add replay protection (timestamp window + delivery-id/nonce TTL).

---

### F12 — MCP subprocesses inherit the entire host environment (all secrets)
**Severity: Medium · Confirmed**
**Category:** Excessive privilege / secret leakage
**Description.** stdio/http/docker MCP transports spawn with `env:{...process.env, ...config.env}` (`packages/tools/src/mcp/mcp-client.ts:304,386,414`). Every MCP server subprocess — frequently `npx <untrusted-pkg>` / `docker run <untrusted-image>` — receives all provider keys and tokens. A single malicious MCP package exfiltrates the full secret set. Also, MCP `notifications/message` params are forwarded into the EventBus as `ChannelMessageReceived` with attacker-chosen `sender`/`platform` (`tool-service.ts:483-497`) — impersonation into the channel layer.
**Recommended fix.** Default MCP subprocess env to an allowlist (PATH + declared vars); explicit opt-in to forward specific secrets. Treat MCP notification fields as untrusted.

---

### Medium / Low findings (condensed)

| ID | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| F13 | Medium | `routeEvent`/`routeEventWithBus` evaluate rate-limit & cost-budget against zeroed state → permanent no-op for integrators using these public exports | `gateway/src/services/input-router.ts:17,42` | Thread persistent `GatewayState` or deprecate exports |
| F14 | Medium | Unbounded request body across all inbound servers; HMAC/parse run over uncapped body before auth | a2a `:194`, serve `:149`, judge `:93`, github-adapter `:21,45` | Max-body enforced before parse/HMAC |
| F15 | Medium | Config-scoped SSRF: remote-agent tool `remoteUrl`, A2A discovery peer URLs (redirects followed) | `remote-agent-tools.ts:61,95`, `a2a/discovery.ts:13` | Route through `assertPublicUrl()` |
| F16 | Medium | Health `/metrics` etc. public on 0.0.0.0, leaks agent/dep names; compose publishes port on all interfaces | `health/src/service.ts:108`, `advocate/docker-compose.yml:31` | Loopback bind; scope publish to `127.0.0.1:` |
| F17 | Medium | CI: `github.event.inputs.version` interpolated into a `run:` step that holds `NPM_TOKEN` before regex validation | `.github/workflows/publish.yml:64-65` | Bind to `env:` var; validate before use |
| F18 | Medium | `NPM_TOKEN` scoped to the entire release job (build/test/clean-install), on disk before publish | `publish.yml:31-32,84-118` | Scope token to publish step; separate job; `rm .npmrc` after |
| F19 | Medium | `id-token: write` granted but no `--provenance` ever generated | `publish.yml:18-20`, `scripts/release.ts:240` | Add `--provenance` or drop the permission |
| F20 | Medium | Prior-work/episodic/experience/debrief/plan channels all inject stored (potentially attacker-influenced) text under trust-conferring headers, no delimiter | `reasoning-think.ts:44-200`, `prompt-sections-default.ts:226-243` | Same trust-fence envelope as F3 |
| F21 | Low | Third-party actions pinned by mutable tag not SHA (`lycheeverse/lychee-action@v2`, `oven-sh/setup-bun@v2`, devcontainer `shyim/...:0`) | `ci.yml:127` etc. | SHA-pin; Dependabot for actions |
| F22 | Low | Missing top-level `permissions:` on ci/eval/regression-gate workflows | those workflows | `permissions: contents: read` |
| F23 | Low | Docker build-time `curl \| bash` (Bun installer) + unverified signal-cli tarball | `docker/signal-mcp/Dockerfile:11,34,36-42` | Pin + SHA256 verify |
| F24 | Low | `judge-server` image runs as root; `scenarios` package publishes with no `files` allowlist | respective Dockerfile / package.json | Add non-root USER; add `files` |
| F25 | Low | Mid-string `&` backgrounding escapes shell timeout + segment splitter | `shell-execution.ts:189,250-260` | Block any unquoted `&`; split on it |
| F26 | Low | In-memory-only, unbounded, never-invoked audit log | `identity/src/audit/audit-logger.ts:11` | Durable sink; actually call it |
| F27 | Low | Gemini debug flag / LiteLLM errors echo prompt/response text (into traces per F8) | `gemini.ts:476,511`; `litellm.ts:222-227` | Gate/redact |
| F28 | Low | `apps/stackblitz/*/.env` are git-tracked (empty) — a real key paste + `git commit -a` publishes it | tracked files | Untrack; use `.env.example` |

**Operational item (not a code finding): `apps/advocate/.env` (untracked, gitignored) holds live-format `TAVILY_API_KEY` and a GitHub PAT.** These crossed the trust boundary during this audit — **rotate both** and move to a secret manager.

**Explicitly cleared (negatives, verified):** No SQL injection anywhere (fully parameterized, incl. dynamic `SET` with static column names). No unsafe deserialization / prototype-pollution sink (`JSON.parse` + field-wise reads; the one `__proto__` surface in `pricing.ts:99` rebinds a local). No committed real secrets. No `postinstall`/`preinstall`/`prepare` scripts and no `trustedDependencies` (Bun default-deny in force). No `pull_request_target`. HMAC compares constant-time. Managed-provider SDKs take no config `baseURL` (no key-exfil SSRF on Anthropic/OpenAI/Gemini). `bun.lock` carries integrity hashes; `--frozen-lockfile` enforced.

---

## Cross-Cutting Issues

1. **Security-as-metadata, not enforcement.** `requiresApproval`, `riskLevel`, `.withVerification()`, guardrails, AgentCard `securitySchemes`, the memory `verified` column — all *declared* and *ignored at runtime*. This is the single largest theme and the most dangerous, because it manufactures false assurance. **Every one of these needs a fail-closed enforcement point.**
2. **Insecure-by-default across every surface.** Tracing on, guardrails off, servers on 0.0.0.0, no body caps, no approval, no egress guard, webhook secret optional. The secure configuration is reachable only by an integrator who already knows every gap.
3. **No central trust boundary for untrusted text.** Tool output, recalled memory, and request bodies all reach privileged positions (host shell, system prompt, agent execution) with no shared "wrap/escape/fence untrusted data" primitive.
4. **No central egress guard.** Every `fetch` is a potential SSRF; there is exactly zero private-range protection in the repo.
5. **No central secret-redaction boundary.** Redaction exists but is wired to one low-value surface; three content surfaces leak.
6. **Isolation primitive exists but is optional.** The hardened Docker sandbox proves capability but is bypassed by the default host-exec paths.
7. **Duplicated, drifting security logic.** Three separate HMAC implementations, multiple `serve()` call sites each re-deciding bind/auth/body — divergence guarantees gaps.

---

## Security Roadmap

### Phase 1 — Critical, immediate (stop RCE and unauth data access)
1. Route **all** shell/code execution through the Docker sandbox; delete the `sh -c` denylist and the worker-thread "sandbox" (F1, F7). Interim if Docker unavailable: `execFile` with argv, no shell, canonicalized paths.
2. Fail-closed approval enforcement inside `ToolService.execute`; auto-feed per-tool flags (F2).
3. `secureServe()` helper — loopback default + mandatory token + body cap — applied to A2A/rax/judge/health (F4, F14, F16).
4. Fix certificate-auth: mandatory signature + trust-anchor verification (F5).
5. Trust-fenced envelope for **all** recalled/tool-derived content in a non-system turn; enforce `verified` on read (F3, F9, F20).
6. **Rotate the advocate Tavily key + GitHub PAT** (operational).

### Phase 2 — Structural risk reduction
7. Central `assertPublicUrl()` egress guard at every `fetch` site; default `http-get` to approval (F6, F15).
8. Central `redactSensitive()` at trace/OTel/Cortex boundaries; flip content-capture to opt-in; `Secret<string>` wrapper (F8, F27).
9. Make verification/guardrails enforcement points; wire `checkOutput`; fail-closed detectors; scan tool/retrieved content (F10).
10. MCP subprocess env allowlist; treat MCP notifications as untrusted (F12).
11. Webhook fail-closed + transport-bound identity + replay protection (F11).

### Phase 3 — Long-term architecture
12. Capability-based tool model: tools receive an explicit, least-privilege capability grant (fs-scope, net-scope, exec) checked by the runtime — replaces boolean flags.
13. Typed trust in the type system: `Untrusted<string>` / `Trusted<string>` so untrusted text cannot reach a system-prompt slot without passing through an escaping function (compile-time boundary).
14. Single ingress/egress middleware layer (auth, body cap, rate/cost, redaction) that every server and every outbound call composes.
15. Durable, tamper-evident audit log actually invoked on every tool exec / auth decision / approval.

### Phase 4 — Defense-in-depth
16. SHA-pin all actions; add `--provenance`; least-privilege `permissions:`; scope release token to publish (F17–F19, F21–F22).
17. Pin Docker base images by digest; verify build-time downloads; non-root everywhere (F23–F24).
18. gitleaks pre-commit + CI secret scan; untrack stackblitz `.env` (F28).
19. Retention limits + at-rest encryption for traces/memory DBs.
20. Fuzz the shell/path parser and the prompt-assembly boundary in CI.

---

## Refactoring Opportunities (security-simplifying)

- **Capability-based security** for tools (replaces inert `requiresApproval`/`riskLevel`).
- **Secure-by-default APIs**: `secureServe()`, `assertPublicUrl()`, `redactSensitive()`, `execFileInSandbox()` — four helpers that eliminate whole finding classes.
- **Strong typing as a boundary**: `Untrusted<T>` / `Secret<T>` phantom types make the two biggest mistakes (untrusted→system-prompt, secret→serializer) *unrepresentable*.
- **Policy-enforcement layer / middleware**: one composable chain for auth + limits + redaction; delete the divergent per-server logic.
- **Dependency inversion for execution**: tools depend on an `Executor` interface whose only production impl is the Docker sandbox.
- **Centralize the three HMAC impls** into one verified module.

---

## Security Debt

- **Highest-carry debt:** the metadata-not-enforcement pattern (F2/F5/F10/F3). Each new tool, server, and memory channel added on top *inherits* the false boundary, so debt compounds with feature velocity. Left unresolved, every release widens the unauthenticated-RCE / injection surface.
- **Denylist debt:** the shell blocklist will require perpetual, never-complete maintenance; each new allowed binary is a new bypass class.
- **Observability debt:** unredacted traces accumulate a growing at-rest liability the longer default-on tracing runs in the field.
- **Dead-code security theater:** `checkOutput`, `behavioral-contracts`, `ToolAuthorizationError`, the `verified` column, AgentCard `securitySchemes` — maintained but non-functional; they mislead reviewers and integrators.

## Missing Security Controls

Authentication (all servers) · Authorization/approval enforcement · Egress/SSRF guard · Output encoding/redaction at content boundaries · Input validation of tool args & request bodies · Body-size/rate/cost limits actually wired · Durable audit logging · Secret rotation & management (manager, not `.env`) · At-rest encryption + retention for traces/memory · Prompt-injection boundary (fence/provenance) · Provenance on npm publish · SHA-pinned CI supply chain · Intrusion detection/alerting on tool-exec anomalies.

---

## Final Assessment

### Top 10 highest-risk issues
1. F1 Shell-execute RCE + arbitrary read/write (default config).
2. F4 Agent servers on 0.0.0.0, no auth, run attacker prompts with operator creds.
3. F3 Persistent prompt injection via memory into the system prompt.
4. F5 Certificate-auth bypass (unsigned / self-included key).
5. F2 Approval/risk gating inert — makes all tool findings unauthenticated.
6. F7 code-execute / new-Function host RCE bypassing the real sandbox.
7. F6 `http-get` model-controlled SSRF to cloud metadata.
8. F8 Unredacted prompts/tool-I/O persisted to disk by default.
9. F9 Self-reinforcing "trusted" skill poisoning + XML breakout.
10. F10 Verification/guardrails don't block; output scan is dead code.

### Top 10 architectural improvements
1. Capability-based tool security. 2. Docker sandbox as mandatory executor. 3. Fail-closed approval in `ToolService`. 4. Trust-fenced untrusted-content envelope + `Untrusted<T>` type. 5. `secureServe()` ingress middleware. 6. `assertPublicUrl()` egress middleware. 7. `redactSensitive()` + `Secret<T>` at every boundary. 8. Trust-anchor PKI for cert-auth. 9. Enforcement-point verification/guardrails. 10. Single audit spine invoked everywhere.

### Top 10 quick wins
1. Rotate advocate Tavily key + GitHub PAT. 2. Default all `serve()` to `127.0.0.1`. 3. Reject unsigned certs (one `if`). 4. Add `WHERE verified = 1` on memory read. 5. Body-size cap in the serve helper. 6. XML-escape `buildSkillContentXml`. 7. Flip tracing content-capture to opt-in. 8. Block unquoted `&` + process substitution in the interim denylist. 9. SHA-pin the 3 third-party actions + `permissions: contents: read`. 10. Bind `env:` var for the publish `version` input.
### Top 10 defense-in-depth
1. gitleaks pre-commit/CI. 2. `--provenance` on publish. 3. Digest-pin base images. 4. Trace retention + at-rest encryption. 5. MCP env allowlist. 6. Fuzz shell/path + prompt-assembly in CI. 7. Redaction unit tests per boundary. 8. Rate/cost limits wired to persistent state. 9. Durable audit log + anomaly alerting. 10. Webhook replay protection.

### Prioritized action plan — smallest set of root causes, largest downstream elimination
Fixing **four root causes** collapses the majority of findings:

1. **Make the Docker sandbox the only executor** (one `Executor` interface) → eliminates F1, F7, F25 and neutralizes F2's blast radius.
2. **Add fail-closed enforcement points for the metadata the API already exposes** — approval in `ToolService`, `verified` on memory read, verification/guardrail `onReject`, cert signature+trust-anchor → eliminates F2, F3, F5, F9, F10, F20.
3. **Introduce two secure-by-default middleware helpers, `secureServe()` (ingress) and `assertPublicUrl()` (egress)** → eliminates F4, F6, F11, F14, F15, F16.
4. **One `redactSensitive()` + `Secret<T>` at every serialization boundary, content-capture opt-in** → eliminates F8, F12(secret leg), F27.

Land those four, rotate the exposed credentials, and apply the Phase-4 CI hardening; that path takes the framework from "insecure-by-default with confirmed Critical RCE" to "secure-by-default with least-privilege execution" without a ground-up rewrite — the hardened primitives (Docker sandbox, parameterized SQL, constant-time HMAC) already exist to build on.
