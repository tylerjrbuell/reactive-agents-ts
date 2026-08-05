# Code-Smell Class: Dialect-Blindness (2026-08-05)

**Trigger:** the meta-tool finding (meta-tools presented as peer task tools) looked like one instance of a larger class. A fresh, first-principles re-read of the prompt-assembly and output paths confirms it: **four separate defects share one root**, and that root is exactly what makes the harness's token overhead *worst on the best models* (+469 % on Gemini vs +99 % local) and what produces both cross-tier bugs found on 2026-08-05.

## The class, stated once

> **The harness computes a model `dialect` / capability signal, then talks to every model as if it were a lowest-common-denominator "prose model" — prose in, prose out, one flat undifferentiated tool list — because that signal is never threaded to the presentation and output-finalization layers.**

The `dialect: "native-fc" | "text-parse" | "none"` capability exists (`assembly/capability.ts:12`, set in `from-kernel-state.ts:163`) and the tool-surface resolver consumes it. But the system-prompt assembly and the output finalizer do not. So a native-FC model — which reads a structured `tools` array and replies with structured tool calls — is handed a second, prose copy of everything and is then judged as if it should have replied in prose. That is **redundant tokens (cost) AND wrong assumptions (reliability)** on precisely the capable cloud models.

## The four instances

### 1. Meta-tools flattened into the domain-tool list
`context/context-engine.ts` renders one flat "Available Tools:" list (split only required/other; `META_TOOLS` never consulted). `think.ts:725` maps ALL gated schemas — meta + domain — into one flat native-FC `tools:` array. `ToolSchema` (`attend/tool-formatting.ts:28`) has no meta marker. The model gets **zero signal** that `discover-tools`/`final-answer`/`recall` are harness controls, not task tools. → discovery mishandled; and a meta-tool schema in the flat FC array is what Groq's validator rejects (`Failed to call a function`, kernel 0/3).

### 2. Tool schemas rendered TWICE for native-FC models
`assembly/stages/system-prompt.ts:63` calls `buildToolReference(...)` gated on `tier` but **never on `dialect`** — so the full in-prompt tool reference is emitted even when the same schemas are already in the native-FC `tools:` array (`think.ts:783`). The stage's own comment admits the in-prompt copy is only for "weak-FC local models," but nothing gates it. On a large/frontier tier model `buildToolReference` emits FULL schemas (`context-engine.ts:159-164`). **Every iteration, a native-FC model pays for its entire tool surface twice** — a token tax proportional to (tool count × schema verbosity), and it scales with the agent's toolset. This is a prime suspect for the fixed ~3300–3500 t kernel scaffolding measured on 2026-08-05.

### 3. Output finalization assumes prose; native-FC replies structured
`kernel/loop/output-synthesis.ts` `finalizeOutput()` validates the terminal output against the requested FORMAT and fires a "single constrained LLM call" to synthesize/repair when it doesn't match. But a native-FC model answers by CALLING `final-answer` with a structured payload — it does not emit prose. So "no model-authored prose answer" trips the synthesis path, the harness **fabricates** an answer, and the verifier then rejects it: `output-is-model-authored — output was assembled by harness fallback (terminatedBy=harness_deliverable), model never produced a synthesized final answer` (the exact Gemini failure, n=3). An honesty defect that only fires on native-FC.

### 4. CoT persona sent to native-FC models
`attend/context-utils.ts:buildSystemPrompt` is tier-adaptive but **not dialect-aware**: it injects "Think step by step" into every branch (kept "because the reactive contract depends on it"). That contract was shaped for text-parse models that narrate-then-name-a-tool. A native-FC model does not need prose CoT; the instruction wastes tokens and nudges it toward emitting reasoning text instead of a clean tool call — feeding defect #3.

## Why this is the highest-leverage class

- It is the mechanism behind the measured overhead shape. The kernel tax is **fixed** (~3300–3500 t), which is why it is +99 % on a chatty local model and +469 % on an efficient cloud model. Defects #2 and #4 are fixed prose the capable model does not need — fixed cost, worst percentage on the best models. Exactly the observed curve.
- It is the root of BOTH cross-tier bugs (Groq FC reject = #1; Gemini fabrication = #3 + #4), which break the "reliable on every tier" headline on real cloud models.
- It is ONE coherent refactor, not four spot fixes: **thread `dialect`/capability into presentation + output.**

## The refactor (one seam, four payoffs)

Make the assembly and finalizer dialect-aware:

1. **Native-FC → drop the in-prompt tool reference** (the FC array is the interface). Keep the in-prompt reference only for `text-parse`/`none`. Immediate token cut on every cloud/native-FC run (#2).
2. **Mark meta-tools** (`scope:"harness"` on `ToolSchema`, or drive off `META_TOOLS`) and either render them in a separate, framed section (text-parse) or handle them out-of-band / with provider-validated schemas (native-FC). Fixes discovery framing (#1) and likely the Groq reject.
3. **Finalizer: treat a native-FC `final-answer` tool call as the model-authored answer** — do not run prose-format synthesis over a structured reply, and never mark a fabricated fallback as success. Fixes Gemini fabrication (#3).
4. **Gate CoT by dialect** — native-FC gets a terse tool-first persona, not prose CoT (#4).

## Verification plan (decisive, per the measurement discipline)

Before/after on the SAME configs already measured:
- **Groq `llama-3.3-70b`** — does the kernel path stop returning `Failed to call a function`? (binary: 0/3 → >0/3)
- **Gemini `gemini-2.5-flash`** — does the `output-is-model-authored` fabrication stop, and does kernel overhead drop from +469 %? (the in-prompt tool cut should be visible)
- **local `gemma4:12b`** — text-parse/weak-FC must be UNCHANGED (it still needs the in-prompt reference + CoT). Regression guard.
- Rung-1 golden replay for control-flow parity.

A grep enforcement script (`check-dialect-aware.sh`): the system-prompt/finalizer stages must consult `dialect`, and the in-prompt tool reference must not be emitted on the native-FC path — red-on-cut.

## Not yet examined (candidate same-class leads)

- Does the RULES block (default-off) or the standing frame carry text-parse-shaped guidance to native-FC? (volatile-tail itself is well-designed — cache-aware — not a smell.)
- The `synthesize`/extra-think round trips: the kernel makes +1 think and +1 synthesize call vs inline. #3/#4 explain the synthesize call; the extra think call needs its own trace.
