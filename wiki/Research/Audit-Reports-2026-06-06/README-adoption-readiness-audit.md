---
title: README Adoption-Readiness Audit
date: 2026-06-06
type: audit-report
scope: README.md + first-run survivability (pre-launch / Show-HN readiness)
verdict: NOT launch-ready — 2 P0 first-run breakers; P1/P2 README fixes shipped
---

# README Adoption-Readiness Audit — 2026-06-06

**Trigger:** User created TikTok (@reactive_agents) + advocate agent for article generation; wants the framework "ready for adoption and won't be ridiculed immediately." Audit scoped to README + first-run survivability.

**Method:** Read README as a cold stranger, then verified every falsifiable headline claim against (a) local source and (b) the **published** npm artifact a hostile reader actually installs. The discriminating test is not "are the claims sloppy" — it's "does `bun add reactive-agents` + copy-paste the README example survive."

## Verdict

README writing/design = strong. Problem = **claims outrun the published artifact + a few falsifiable boasts.** That combination is exactly what gets a launch shredded on HN/Reddit. **Do not Show-HN until P0s closed.** ~1 day work.

---

## 🔴 P0 — first-run breakers (gate the launch)

### P0-1 — Published npm ≠ documented API (the discriminating finding)
- npm `reactive-agents` = **0.11.1**. README on `main` is ahead.
- `HarnessProfile` / `packages/runtime/src/capabilities/profile.ts` **did not exist at the v0.11.1 tag** — verified: `git cat-file -e v0.11.1:packages/runtime/src/capabilities/profile.ts` → `ABSENT@TAG`. Not exported at tag either.
- README's flagship **"Add Capabilities"** block (`HarnessProfile.balanced()`, `.withProfile()`) → **import error on first run** for anyone who `bun add reactive-agents` today. Exactly the user's stated fear.
- **Fix = PUBLISH, not edit.** Cut a release where `main == npm`. (Owner: release-warden / `bun run release:dry`.)

### P0-2 — Default Anthropic model may be retired
- `packages/llm-provider/src/provider-defaults.ts:8` default = `claude-sonnet-4-20250514` (May-2025 id, ~13 months stale).
- Rest of code (`capability.ts`, `complexity-router.ts`, `create-reactive-agent`) uses `claude-sonnet-4-6`. Internal split-brain.
- If `20250514` is retired by Anthropic → **every default Anthropic agent throws**. Live → cosmetic.
- **Must verify (needs API key):**
  ```bash
  ANTHROPIC_API_KEY=... bun -e "import {ReactiveAgents} from 'reactive-agents'; const a=await ReactiveAgents.create().withProvider('anthropic').build(); console.log((await a.run('hi')).output)"
  ```
- **Fix either way:** align `provider-defaults.ts` (+ `fallback-chain.ts`, `token-counter.ts` examples) to `claude-sonnet-4-6`. (Owner: provider-warden.)

---

## 🟠 P1 — dishonesty-tier (top-comment bait) — FIXED in README

### P1-3 — "Zero `any`" asserted 3× but FALSE — ✅ fixed
- `grep` of `packages/*/src` (excl. tests) = **123 `: any` / `as any` hits** (`db: any` in eval-store, `as any` in gemini/openai providers, `any[]` varargs in benchmarks).
- A skeptic finds in 30s → "they lie in their own README."
- **Shipped:** dropped the absolute "zero `any`" boast at README lines 11, 21, 127; replaced with "strict TypeScript / schema-validated boundaries / explicit tagged errors" (defensible, non-falsifiable).
- **Residual code debt (not blocking):** 123 `any` in src is real. Worth a later sweep if "no `any`" is to become a true claim — would need to scope to public-API surface.

### P1-4 — README claimed `.withX()` are "`@deprecated` aliases" — FALSE — ✅ fixed
- Clean count: `@deprecated` in `packages/runtime/src/` = **0**. The dep-tags were reverted (no-metric-gaming course-correction, see memory `project_canonical_refactor_2026_05_28`). README prose wasn't updated.
- Double harm: telling new adopters the API they're learning is deprecated = confidence-kill, AND it's untrue.
- **Shipped:** rewrote the paragraph — `.withX()` methods are "fully supported and compose cleanly with presets."

### P1-5 — Comparison-table `--` entries wrong — ✅ softened
- "LangChain JS reasoning strategies = 1 (ReAct)" — false (it has many). Vercel AI SDK multi-agent = "--" — they shipped agent/workflow abstractions.
- Competitor fans fact-check hardest here.
- **Shipped:** LangChain reasoning → "Multiple"; Vercel reasoning + multi-agent → "Partial"; added a dated `<sub>` footnote: "`--` means we found no first-party equivalent, not that none exists. Corrections welcome — PR." The humility footnote defuses most of the ridicule by inviting correction instead of attack.

---

## 🟡 P2 — sloppy / vanity — FIXED in README (except #8)

- **P2-6 model-id prose inconsistency** — ✅ README quickstart example + `LLM_DEFAULT_MODEL` env now `claude-sonnet-4-6` (was `…-20250514`). Zero `20250514` left in README.
- **P2-7 test-count drift** (README "5,320" vs actual ~5,790) — ✅ softened to "5,300+ tests · 600+ files" (drift-proof under-claim) in header, Confidence section, and comparison row.
- **P2-8 stale `QUICK_START.md`** — ⚠️ NOT done (outside README scope). Says v0.10.0 / 28 packages / 4,730 tests / `bun run changeset` (command removed). Human evaluator may open it expecting a getting-started guide. **Recommend:** rename to `AGENTS-QUICKSTART.md` (it's agent-onboarding, not user-facing) or refresh the stale facts.
- **P2-9 vanity badges** — ✅ removed npm-downloads badge + Star-History section. They publicly advertise low traction for a pre-traction project; re-add once traction exists.

---

## Remaining work (post-audit)

| Item | Priority | Owner | Blocker |
|------|----------|-------|---------|
| Publish release so `main == npm` | P0 | release-warden | gates launch |
| Verify + align default model id `4-6` | P0 | provider-warden | needs ANTHROPIC_API_KEY |
| `QUICK_START.md` rename/refresh | P2 | — | none |
| `any`-sweep to make a true "no any" claim | P3 | — | optional |

## Strategic note

advocate ships articles **from a framework that import-errors on install**. Those articles age into liabilities the moment a reader tries the quickstart. **Fix the bucket (P0s) before pouring marketing in.** Marketing a leaky funnel wastes the awareness TikTok/advocate generate.

## Evidence log
- `git cat-file -e v0.11.1:…/profile.ts` → ABSENT@TAG
- `npm view reactive-agents version` → 0.11.1
- `grep -c "@deprecated" packages/runtime/src/` → 0
- `grep -E ":\s*any|as any" packages/*/src` (excl tests) → 123
- `provider-defaults.ts:8` → `claude-sonnet-4-20250514`; `capability.ts:151` → `claude-sonnet-4-6`
- README edits applied + verified clean (no 20250514, no any-boast, no @deprecated, no downloads/star badges).
