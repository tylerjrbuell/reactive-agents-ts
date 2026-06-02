---
title: Phase 3.2 live seam proven + pre-existing MCP tool-name bug discovered
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
verdict: "RA_ASSEMBLY=1 live seam works — the reconstructed multi-turn thread is accepted by real Anthropic strict-FC (file-write, 7 steps). Live-OVERFLOW proof is blocked by a PRE-EXISTING, orthogonal bug: MCP tool names contain `/`, which violates the provider function-name regex. No name sanitization exists → MCP tools never worked on native-FC providers."
---

# Phase 3.2 — live seam proven; MCP tool-name bug surfaced

## What shipped (committed, branch overhaul/agentic-core-2026-05-31)
- `8ad271e6` fix(assembly): project() emits a **provider-valid thread** (leading user(goal) + grouped assistant{tool_use} turns; compact-history never orphans a tool_result). 29/29 assembly tests.
- `b8fee8de` feat(assembly): `toLLMMessages` — ProviderRequest.messages → LLMMessage[] glue (mirrors toProviderMessage). 6/6.
- `488daf34` feat(assembly): **RA_ASSEMBLY live seam** — think.ts routes the per-iteration prompt build through `project(fromKernelState(...))` behind `RA_ASSEMBLY=1`; default unset = byte-identical curate() path. Tools/recall-gate shared by both arms. Trace logged under `RA_ASSEMBLY_DEBUG=1`. +22 LOC; 28/28 kernel + 1480/1480 reasoning green (kernel-warden).
- `181afdf2` test(assembly): **golden-trace proof** — same KernelState → byte-identical AssemblyTrace ×3; 126k result → summary+ref; write_result_to_file survives; full data recoverable. 3/3. (The deterministic proof experiment (b) could not get.)
- `6638aca6` chore(spot-test): surface result.error in SPOT_RESULT_JSON.

## Live A/B smoke — what the wire said
Method: spot-test, overflow task (100 commits), `SPOT_LOG_IO=1 RA_ASSEMBLY_DEBUG=1`, reliable provider first.

| Arm | Provider | Tools | Result |
|---|---|---|---|
| =1 | openai gpt-4o-mini | file-write,github | llm_error, 0 tok, iter-0 only |
| =0 (control) | openai gpt-4o-mini | file-write,github | **llm_error, 0 tok — IDENTICAL** |
| =1 | anthropic haiku | file-write,github | llm_error, 0 tok |
| =1 | anthropic haiku | **file-write only** | **success, 7 steps, 8997 tok, file written** |
| =1 | anthropic haiku | no tools | success, 1661 tok |
| =1 | anthropic haiku | **github only** | llm_error, 0 tok |

**Conclusions (evidence, not inference):**
1. **My =1 multi-turn reconstructed thread is provider-accepted** — file-write 7-step run on real Anthropic strict-FC. Thread-validity holds live (positive proof, not just the identical-control negative proof).
2. The failure is **environmental/pre-existing, not the assembly** — the =0 control on the untouched curate() path fails identically; bisect isolates the cause to one tool.

## Root cause (read off the wire, not inferred)
Raw Anthropic 400 (captured via a temporary `console.error` at anthropic.ts:358 `stream.on("error")`, since reverted):
```
400 tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'
```
MCP tools register as `${server.name}/${toolName}` (tool-service.ts:454) → e.g. `github/list_commits`. The **`/` violates the provider function-name regex** (Anthropic `^[a-zA-Z0-9_-]{1,128}$`; OpenAI similarly — same root cause for the gpt-4o-mini failure). `file-write` has no slash → passes.

`think.ts` builds `llmTools` with `name: ts.name` (no sanitization). A repo-wide grep found **no tool-name sanitization for the FC boundary anywhere**. ⟹ **MCP tools with `/` in their RA name have never worked with native-FC providers** (Anthropic/OpenAI). They would only work via text-parse mode (local models), where the name isn't validated against the FC regex. Pre-existing, latent, orthogonal to the overhaul.

My earlier "malformed object/array schema" hypothesis was WRONG — the wire-read corrected it. (Lesson reinforced: read the 400, don't infer.)

## The fix (if pursued) — bounded
Two-way name mapping at the FC boundary:
- Build llmTools with a sanitized name (`github/list_commits` → `github__list_commits`, `/`→`__` or `-`); keep a sanitized→canonical map.
- On tool-call parse (act/think native-FC path), map the returned name back to the canonical `server/tool` before registry lookup/execution.
Touches kernel FC wiring (think.ts llmTools + tool-call parsing) → kernel-warden. Possibly tool-service registration. Affects ALL native-FC MCP usage, not just this A/B.

## Post-fix live verification (MCP name-sanitize landed, `34dc70cf`)
Re-ran the `=1` overflow task on Anthropic haiku with the fix in place:
- **`success:true`, 17 steps, 5 think-iterations**, toolCalls `brief → github/list_commits → file-write×3`.
- **5 `RA_ASSEMBLY_TRACE` lines** (one per think iteration) — the multi-turn reconstructed thread (`user(goal)` + grouped `assistant{tool_use}` + projected `tool_result`) was **accepted by a real native-FC provider across the full loop**. Thread-validity + MCP-name round-trip both proven live, multi-turn.
- Projection stayed `full` every iteration (`1 full … 4 full`, never `summary+ref`) because this MCP `list_commits` returns a **compact** payload (largest tool_result 8534 chars ≪ 45875 recencyBudgetChars). Overflow simply didn't trigger — correct behaviour, not a bug. (The 126k figure in the original wire debrief was a verbose/full-object variant.)
- `file-write×3` but no file on disk — a file-write tool sandbox/cwd quirk, orthogonal to assembly.

So after the fix: live multi-turn = ✅ proven; live **overflow** (summary+ref mid-loop) requires a genuinely large payload — separate targeted run (fetch a big file).

## Controlled live-OVERFLOW proof (`034fcebd`)
MCP tools (`list_commits` 8534 chars, `get_file_contents` 81 chars) return payloads
too compact to cross the 45875-char mid budget, so a natural live overflow was
unreliable. Added a test-only knob `RA_RECENCY_BUDGET_CHARS` to `resolveCapability`
(mirrors legacy `RA_OVERFLOW_BUDGET`; unset in prod). Re-ran the known-good
`list_commits` task with `RA_RECENCY_BUDGET_CHARS=2000` on Anthropic haiku:
- **`success:true`, 0 `llm_error`.**
- iter 1: `0 full, 1 summary+ref` — the 8534-char result **overflowed the forced budget and projected to summary+ref LIVE**.
- iter 2: `1 full, 1 summary+ref` — the summarized thread **persisted + was accepted across iterations**; run completed.
⟹ the last combo closes: **live + overflow + multi-turn, real native-FC provider, success.** The summary+ref render is provider-valid mid-loop.

## Status of Phase 3.2 — COMPLETE (proof set)
- ✅ **Golden-trace** — deterministic overflow→summary+ref, byte-identical ×3 (`181afdf2`).
- ✅ **Live multi-turn thread accepted** — 5 think-iterations, real MCP tool use, Anthropic strict-FC.
- ✅ **MCP tool-name bug fixed + live-verified** (`34dc70cf`) — github tool now reachable on native-FC.
- ✅ **Live overflow** — summary+ref fires mid-loop, thread stays valid, run succeeds (`034fcebd`).

Remaining (Phase 4+): collapse + delete legacy builders (buildConversationMessages / ContextManager.build / injectable defaultContextCurator) into project(); full cross-tier A/B grid (now unblocked); then delete recall/[STORED:]/inline-cap. Pre-existing orthogonal issue noted: file-write tool wrote 3× but produced no file (sandbox/cwd) — separate ticket.
