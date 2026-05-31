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

## Status of Phase 3.2
- Assembly seam: ✅ proven live (multi-turn thread accepted).
- Deterministic overflow: ✅ golden-trace.
- **Live-OVERFLOW multi-turn end-to-end: BLOCKED** — the only large-result tool available (MCP github) is unreachable on native-FC until the name bug is fixed. Decision pending (user): fix MCP name-sanitization now (unblocks + fixes a real framework gap) vs file it and complete 3.2 on golden-trace + live-multi-turn proof.
