# Grounding-Ceiling Verification — 2026-08-08

**Question asked:** verify empirically whether "deepen ground-truth verification" is the highest-impact path to improving agentic problem-solving.

**Verdict:** the ceiling is REAL and PROVEN; the FIX works and is low-cost; the contract surface mostly already exists. BUT its impact MAGNITUDE is UNMEASURED — the only available corpus is too easy to exhibit it (shows 1/45). The binding prerequisite is Move 0 (a harder, content-graded, T≥5 corpus). Grounding is the top *candidate*, not a proven *winner*.

## What was proven (deterministic, zero tokens)

### 1. The ceiling exists — existence == success, content never checked
`scratchpad/grounding-ceiling-probe.ts` against the real `verifyDelivery`:

| probe | result |
|---|---|
| wrong-content file (`ArtifactProduced`) | **MET (false-success)** |
| empty file | **MET** |
| fabricated claim in model's own output (`OutputContains`) | **MET (belief)** |

Source confirms: `post-conditions.ts` DBC — "NO fs access… judged from the ledger + the assembled output string." `ArtifactProduced` = file written OR exists on disk (Move 2's positive-only override); **content-correctness is never a condition.** The four condition kinds (`ToolCalled`, `ArtifactProduced`, `OutputContains`, `SideEffectLanded`) ground on *existence / an-action-ran / substring-in-belief* — never on *the-right-result*.

### 2. Blast radius is universal
`deriveConditions` maps "write file ./X" → `ArtifactProduced('./X')` + `ToolCalled(writer)`; pathless tasks → `SideEffectLanded` / `OutputContains`. No task class gets content grounding. The authority is shared across all 8 strategies → strategy-independent; no strategy change touches it.

### 3. The fix moves the needle without opening false-fails
`scratchpad/grounding-fix-prototype.ts` — an execution-grounded authority (run a caller-supplied acceptance check, use exit code as ground truth; fall back to existence when no spec):

| case | existence-only (today) | execution-grounded |
|---|---|---|
| wrong work | MET (false-success) | **UNMET (honest fail)** |
| correct work | MET | MET |
| no spec | MET | **MET (byte-identical — no regression)** |
| missing file | UNMET | UNMET |

### 4. The contract surface mostly EXISTS
`RunContract` already carries `AcceptanceTier = "deterministic" | "checker" | "self-critique"` per requirement + a `matcher: PostCondition` per deliverable. **The `"checker"` tier is the exact slot for execution grounding — currently unbacked by any checker-capable PostCondition kind.** So the fix is ADDITIVE (a new `PostCondition` kind + a checker runner), not a new public surface.

### 5. The bench already does what the framework doesn't
`disclosure-ablation.ts:214` grades `correct = readFileSync(...).includes(EXPECTED)` — it content-grades externally by reading the file. The cheap capability the bench relies on to measure correctness is absent from the shipped success authority. The framework reports success on wrong work; the bench (correctly) marks it wrong.

## The honest caveat — incidence is unmeasured

Counted `wroteFile=true ∧ correct=false` (the population the fix converts) across the 45 rung cells (2026-07-28):

| corpus | cells | wrote | correct | wrote-but-wrong |
|---|---|---|---|---|
| rung2 haiku | 15 | 15 | 15 | **0** |
| rung3 granite4 | 15 | 7 | 6 | **1** |
| rung3 qwen35 | 15 | 11 | 11 | **0** |

**1 of 45.** But the corpus is a trivial task (`sum.txt` contains a number; haiku 15/15) — it structurally cannot exhibit the ceiling that hard agentic problems would. The 1/45 is a floor-effect, not a general rate. **This data is uninformative about impact magnitude.**

## Consequence for prioritization

- **Grounding depth** = proven mechanism, working fix, existing contract slot, ~0 token cost. Top candidate.
- **But it cannot be crowned "the" needle-mover on current evidence.** The instrument literally cannot see the ceiling on the current corpus — the same wall as "7 lift attempts, 0 passes," now confirmed from a second angle.
- **Move 0 (trustworthy measurement — a harder, content-graded, T≥5 corpus) is the true first move.** It is the prerequisite for ranking grounding *or any other candidate*. The competitive-edge plan already sequences Move 0 first; this verification independently re-derives why.

## Design note (if grounding proceeds)
The execution-grounded path returns **MET→UNMET** — the first authority that can fail a run on its own judgment, inverting Move 2's positive-only (`fileExists` flips UNMET→MET, "never the reverse") safety property that fixed the 88% false-fail. Safe ONLY when the acceptance check is **caller-supplied and executable** (a `"checker"`-tier condition), never harness-inferred. A heuristic content check would reopen the 88%. Enforce via `check-success-authority.sh` extension.

## Artifacts
- `scratchpad/grounding-ceiling-probe.ts` — probes 1–3 (ceiling exists)
- `scratchpad/grounding-fix-prototype.ts` — the fix table (needle moves, no regression)
