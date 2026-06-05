# Market-Fit Research — Best Dogfooding Agent for Reactive Agents

> Date: 2026-06-04. Goal: pick the vertical agent to build on RA that is (a) sellable with high success odds, (b) a good dogfood that surfaces framework gaps. These two goals partly conflict — see §4.

## The discriminator (decides "high chance of success")

RA's structural moat = **local-first + audit/provenance**. Against 8 funded GPT-wrapper startups in any horizontal space, RA wins ONLY where the buyer's structural reality favors it. The single deciding question:

> **Is cloud AI off-limits for this buyer?**

If yes → RA has a moat competitors can't copy (they're all cloud SaaS). If no → RA is in a feature race it has no edge in, and the privacy/audit work is wasted. Speed/accuracy alone is not a moat — incumbents already have it.

## Candidate scoring

| Candidate | Cloud off-limits? (wedge) | Dogfood richness | Solo-reachable buyer | Competition | Verdict |
|---|:--:|:--:|:--:|:--:|---|
| **Bookkeeping reconciliation** | ❌ books already in QB/Xero cloud | ⚠️ low — deterministic diff, thin agent | ✅ | 🔴 red ocean (Maxima $41M targets *exactly* this; Intuit/Xero/Sage AI) | **REJECT** |
| **Security questionnaire / RFP** | ❌ answers go *outward*; trust centers public; pain is speed not privacy | ✅✅ very high (memory/retrieval/HITL/audit) | ✅ | 🔴 red ocean (AutoRFP, Inventive, Skypher, Tribble, Iris, Conveyor $4.8k/yr, Sequesto, Vanta/Drata) | **REJECT** — richest dogfood but wedge doesn't bite |
| **Contract review / redline** | ✅ confidential contracts; firms nervous data leaves | ✅ high (reasoning, playbook, redline, HITL) | ✅ small/solo law reachable | 🟠 crowded; LegalFly owns "privacy-first" positioning | **SHORTLIST** |
| **Healthcare prior-auth / clinical-doc** | ✅✅ HIPAA/PHI — cloud often legally banned | ✅ high (extraction, reasoning, HITL, audit) | ❌ regulated sales, slow | 🟡 moderate | **SHORTLIST (strongest wedge, hardest reach)** |
| **Regulated internal-doc / knowledge agent** (gov, defense, finance back-office, legal discovery) | ✅✅ cloud banned by policy | ✅ high (retrieval, reasoning, HITL, audit) | ⚠️ depends on network | 🟢 thin (incumbents are cloud) | **SHORTLIST (best moat, reach = your network)** |

## Why the two rejected ones fail the SAME way

Reconciliation and security-questionnaire are both real, growing markets — but in both, **the buyer is fine with cloud AI**, so RA's local-first/audit moat gives zero structural edge. Picking either means out-featuring well-funded incumbents on speed/accuracy, where RA has no advantage. (Security-Q is the *best dogfood* of all candidates — but a dogfood that doesn't exercise the wedge doesn't validate RA's actual selling proposition, so it fails the dogfood goal's deeper purpose too.)

## §4 — The genuine conflict to resolve

The two goals point different directions:

- **If priority = "build something that sells, high success odds"** → pick a **wedge-passing** vertical (contract review / healthcare / regulated internal docs). RA's moat is the reason the buyer picks you.
- **If priority = "surface framework gaps fast"** → security-questionnaire honestly wins (it exercises memory + retrieval + HITL + audit + structured output harder than anything else) — but it won't validate the wedge or sell against incumbents.

These don't reconcile by analysis — they depend on (1) which goal is primary, and (2) which buyer segment you can actually *reach* (your network/access), which is a fact only you have.

## Recommendation (pending the fork)

Lead with a **wedge-passing** vertical so the dogfood also proves RA's differentiator. Among the three, ranked by moat strength × reachability:

1. **Contract review for privacy-sensitive small/mid firms** — wedge bites, buyer reachable (solo/small law), proven willingness-to-pay (LegalFly, goHeather $99/mo). Risk: crowded, LegalFly owns the privacy story → differentiate on *fully self-hosted + signed audit trail*, not just "privacy-first scrubbing."
2. **Regulated internal-doc agent** — strongest thin-competition moat, but market = whoever you can reach.
3. **Healthcare prior-auth** — strongest wedge, worst solo-founder access.

All three are richer agentic dogfoods than reconciliation (document reasoning + retrieval + HITL + audit, not a deterministic diff), so they surface real framework gaps regardless.

## Open questions for the user (can't resolve from analysis)

1. **Primary goal:** sellable-with-high-odds, or surface-framework-gaps-fast?
2. **Which buyer can you actually reach** — legal contacts, healthcare/clinic access, a regulated enterprise, or none (pure cold PLG)?

Answers pick the one to scope deeply.

---

## §5 — UPDATE: user answers + the constraint conflict (2026-06-04)

**User answered:** primary goal = **sellable, high success odds**; reachable buyer = **none, pure cold PLG**.

These two answers collide with RA's moat. Cold-PLG research finding:

- Cold-PLG **prosumer "private docs"** = commoditized **free** (AnythingLLM MIT, Jan.ai 5.5M dl, Ollama). No revenue.
- Cold-PLG **vertical (solo law)** = crowded + privacy already won by **cloud zero-data-retention** (Spellbook "ZDR wins", Paxton SOC2/HIPAA cloud). Local-first ≠ differentiator there.
- **Cloud-truly-banned** buyers (gov/health/finance/regulated-eng) = real moat, but **procure — not reachable by cold PLG**.

**Conclusion: "sellable + cold-PLG + local-first moat" is a near-empty intersection.** One constraint must flex:

| Flex | What you get | Cost |
|---|---|---|
| **A. Flex channel** (accept founder-led sales / design partner) | Unlocks real-moat verticals: regulated internal-doc agent, clinical-note agent, regulated-codebase coding agent. Highest success odds. | Not pure cold PLG. |
| **B. Flex moat** (compete on agentic depth + audit, not local) | Cold-PLG dev/prosumer product where RA's composability/audit/multi-step *agent that does the work* (not chat) is the edge. | Feature race vs funded incumbents; weaker moat. |
| **C. Flex "sellable now"** (open-core PLG funnel) | Free, cold-PLG, local-first **agent app that IS the dogfood AND top-of-funnel** for monetizing RA itself (hosted Cortex SaaS, idea #2 in business-ideas doc). Reconciles everything. | Revenue deferred to the framework SaaS, not the agent. |

**Recommendation:** **C**, with the dogfood = a free self-hosted local-first agent app that does a real confidential multi-step job (not chat) — it proves RA's wedge, exercises the framework hard (memory/retrieval/HITL/audit), spreads via cold PLG because it's free + local, and funnels into the open-core Cortex SaaS that is the actual business. If revenue-now is non-negotiable, fall back to **A** and accept a light sales motion for a regulated vertical.

---

## §6 — UPDATE: Option C's revenue terminus fails the same test (2026-06-04)

Vetting the *back* of the funnel (Cortex SaaS = 100% of Option C revenue) against the red-ocean + wedge test used to kill everything else:

- **Agent-observability is a red ocean:** LangSmith, Langfuse, Arize Phoenix, Helicone, Datadog LLM, Honeycomb, Braintrust, Laminar.
- **The self-hostable niche is already free:** Langfuse — open-source, self-hostable, no per-seat, ClickHouse-acquired Jan 2026. RA can't undercut free.
- **RA's only edge = RA-native deep traces** (same shape as LangSmith's LangChain-lock). That moat only pays at scale — **and RA has ~zero adoption today.** Circular: Cortex monetizes RA adoption; RA adoption is what the dogfood is meant to create; revenue is post-adoption, years out.

**Funnel rationale corrected:** end users of one local agent (lawyer/researcher) have no agent fleet → never buy observability. Only real funnel is indirect — **developers** see a "built-with-RA" showcase → adopt RA → maybe buy Cortex. ⇒ audience must be **developers**; a **dev-facing corpus** (private codebase/logs) beats a prosumer research corpus.

### Honest meta-finding (whole thread)

> RA's moat (local-first + audit) commands a premium **only where cloud is banned** — and those buyers **procure, they don't cold-PLG.** Every cold-PLG-reachable market is a red ocean where RA has no edge: reconciliation, security-Q, research-agent, **and observability/Cortex.** Option C relocates the red ocean to observability and defers revenue behind a zero-base adoption bet.

**⇒ "high odds" + "pure cold PLG" are in genuine tension with a moat-based play.** Two clean resolutions:

- **(A) Flex the channel** → light sales motion, sell the real-moat vertical to cloud-banned buyers. **Only path where high-odds + RA-moat both hold.**
- **(B) Hold cold-PLG, drop the moat** → best free RA showcase (dev-facing: local codebase/log analyst), pure framework marketing, revenue = long uncertain post-adoption bet. Honest label: *low-to-moderate odds, long horizon.*

**P0 (local ingestion + retrieval core) is common to every branch** — build-ready now regardless of A/B.
