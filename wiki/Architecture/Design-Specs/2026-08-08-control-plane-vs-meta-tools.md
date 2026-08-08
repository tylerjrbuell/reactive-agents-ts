# The domain-only FC channel — one invariant that dissolves the meta-tools

**Status:** DESIGN (proposed, elegant form). Supersedes the per-tool framing of the earlier draft (context-plane) — same evidence, one unifying invariant.
**Answers:** what is the *better overall* design, vs gating meta-tools one at a time.
**Does NOT** write a new north-star (amend [[../Specs/09-UNIFIED-PROGRAM|09]] §6 if the invariant becomes program law), use resolver relevance-prediction, or bundle into the Move 1 branch.

---

## 1. The one root (structural, grounded)

RA has **no type-level distinction between a DOMAIN tool (the agent calls it to affect the world) and a HARNESS-CONTROL affordance (agent↔harness coordination: terminate, discover tools, recall context).** Grep confirms: `ToolSchema` has no meta/scope marker; `META_TOOLS` is a name set, not a type. So control affordances get jammed into the provider's function-calling `tools:` array alongside real tools — **the control plane leaked into the domain channel.**

Every symptom this investigation found is that one leak:
- **Token tax** — meta-tool schemas ride the FC array every call. Measured (RA_WIRE_PROBE, gemma4 native-fc): `final-answer` ≈ 1713 chars ≈ 428t/call, `discover-tools` ≈ 1000 chars; tool schemas dominate the ~950t/call input. (`recall` is gated out of the wire array — not the tax; earlier claim was a visible≠wire confound.)
- **Extra-step temptation** — a control affordance in the tool slot invites the model to *call* it.
- **Dialect-blindness #1** — "meta-tools flattened into domain tool list… flat map incl. meta into provider `tools:`" (catalogued open). Same leak, named.

## 2. The invariant (the whole design in one line)

> **The FC array is a DOMAIN-ONLY channel. Anything the harness needs from the agent is read from the agent's natural output (native-FC: response shape) or rendered as an explicit sentinel (text-parse). No `scope:"harness"` tool occupies a provider tool slot when `dialect === "native-fc"`.**

Everything below is a *consequence* of this invariant, not a separate proposal.

## 3. The enabling change — make it mechanical, not a naming convention

Add **`scope: "domain" | "harness"`** to `ToolSchema` (this is exactly what dialect-blindness #1 said was missing: "`ToolSchema` has NO meta marker"). Then the invariant is enforced by a type, not by grepping `META_TOOLS`.

- Edge case that validates the field: **`write_result_to_file`** is in `META_TOOLS` today but `produces:"file"` — it does world work. `scope` reclassifies it **`domain`** (it was mis-bucketed). The type forces the disambiguation the name set blurred.

**Enforcement (09 §6 — one owner, one script):** `scripts/check-domain-only-fc.sh` — fails CI if any `scope:"harness"` schema reaches `llmTools` (`think.ts:735`) under `dialect==="native-fc"`. Red-on-cut.

## 4. The three consequences (two prediction-free, one reframed)

### 4a. `final-answer` → Assessment reads the natural terminal (PREDICTION-FREE)
Native-FC already terminates by response shape: `end_turn` / no-tool-call → `arbitrator.ts:286/427` exits with `output: ctx.thought.trim()` (`agent-final-answer via "end-turn"`, a first-class path). Grounding already exists (`verifyDelivery` — F6/Move2). Structure already has its own rail (`.withOutputSchema` → `result.object`). `final-answer` is offered-not-forced (dynamic injection `think.ts:223`, not in `requiredTools`), and no prompt hard-instructs it. So on native-FC the model stops, Assessment adjudicates against the contract, done — **no termination tool.** ~428t/call saved.
- **Retained for text-parse + critical-pressure:** there the model can't signal "done" by response shape (it just emits text), so the explicit sentinel + `looksLikeFinalAnswer` heuristic + the final-answer-only pressure arm are load-bearing. This is the sentinel rendering of the same control concern.

### 4b. `recall` → Projector + reproducible refs (PREDICTION-FREE for the stable column)
Results from **stable** sources (file/dir/scratchpad reads) get a ref = `source + locator`; re-fetch is the original domain tool. Feasible: args available at `gather-dedup.ts:96`. **Drifting** sources (search/http/price — value is a historical fact) keep the store. `recall` disappears for the stable majority; the residue keeps the store with **auto-rehydration as a lift-gated candidate** (§4d), never load-bearing.

### 4c. `discover-tools` → DECLARED, not predicted (PREDICTION-FREE)
The fix is NOT "a smarter resolver curates per step" — that IS the tool-relevance classifier (0pp lift, demoted opt-in) and lazy pruning (deliverable failure on small models, 2/12 vs 11/12, p≈3.2e-4). **The fix is: respect the caller's *declared* tool set and drop the discovery escape hatch.** When the set is declared (`builtins:"file-write"`, measured 1/1), there is nothing to discover and no prediction to get wrong. Resolver-driven narrowing stays a **separate, lift-gated** question — explicitly NOT part of this design.

### 4d. NOT load-bearing here: auto-rehydration / resolver prediction
Any harness *prediction* of what the agent needs (rehydrate this result, hide that tool) is gated by the lift rule with the classifier/pruning failures as the prior. The elegant design stands entirely on prediction-free parts (4a/4b-stable/4c); prediction is upside, never the foundation.

## 5. Why this is what leading harnesses do
Native tool-use loop (Claude Code, Anthropic API, OpenAI): continue while the model returns tool calls; **stop on a plain text message** (`stop_reason:end_turn`/no `tool_calls`) — the final text is the answer. Structured output is a *separate* mechanism (`response_format`/schema). Provenance is the message role. **None ship a termination/discovery/recall tool** — because their FC channel is domain-only and control is read from the response or owned by the harness. §2 is that invariant, made explicit and dialect-adaptive (RA must serve text-parse models too, which they mostly don't).

## 6. Relation to the meta-loop and Move 1 (honest dependency)
RA's meta-loop (Contract→Ledger→Assessment→Control→Actuators→Projector) is the natural owner of the control plane — Assessment owns termination (4a), Projector owns context (4b). BUT the meta-loop is **dark by default** (`_enableReasoning=false`, 7 vs 12 events); "the meta-loop is the control plane" is only true on the kernel path, i.e. **after Move 1** routes the default there. Until then this invariant applies to the kernel path only. Sequencing: the invariant (§2/§3) + 4a/4c are prediction-free and land independently; full "meta-loop owns control" follows Move 1.

## 7. What ships, in order
1. `scope` on `ToolSchema` + `check-domain-only-fc.sh` (the invariant, mechanical). Reclassify `write_result_to_file` → domain.
2. **4a** final-answer: native-FC drops it from the wire array, `end_turn`+Assessment terminates; retain for text-parse/pressure. Re-probe to confirm the ~428t/call drop + termination still fires (gemma4).
3. **4c** discover-tools: declared-set respected, discovery hatch off on native-FC.
4. **4b** reproducible refs (stable column), when `recall` is surfaced.
5. **4d** any prediction — lift-gated, separate.

## 8. Non-goals
- No new north-star (amend 09 §6 if the invariant becomes law).
- No resolver relevance-prediction folded into the elegant design (§4c/§4d).
- No bundling into the Move 1 branch (separate work; §6 states the dependency direction).
- `final-answer`/`recall` NOT removed — dialect/stability-gated retain.
