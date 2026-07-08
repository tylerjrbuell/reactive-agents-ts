# Decision: Harness Meta-Loop Architecture RATIFIED (2026-07-08)

**Status:** RATIFIED by user 2026-07-08 ("yes let's overhaul the harness and reshape our systems to properly fix all the audit issues and failure modes to create a powerful, flexible and canonical Agentic harness").

**What was ratified:** [[../Architecture/Design-Specs/2026-07-08-harness-meta-loop-missing-pieces|the harness meta-loop spec]] — the four missing architectural pieces identified from the [[../Research/Audit-Reports-2026-07-08/00-SYNTHESIS-deliverables-longhorizon-sweep|2026-07-08 deliverable-truth + long-horizon sweep]]:

1. **RunContract** — typed goal object (requirements / deliverables / constraints / horizon / acceptance), compiled at run start; the single source of "what does done mean". Kills D3 (deliverable-blindness).
2. **RunAssessment** — one pure estimator `assess(contract, ledger, budget)` per iteration; the only home for counters/thresholds; contains the run-phase model (orient → gather → execute → synthesize → verify). Kills D2 (no shared progress currency) and D4 (no upward gear).
3. **Projector** — single rendering authority for the LLM-visible window; two-way contract (every ledger entry reachable via one ref vocabulary; every rendered line traceable). Kills D1 (write-only harness).
4. **Meta-loop DAG wiring** — Contract → Ledger → Assessment → (Control Plane + Policy recompile) → Actuators → Projector, strictly one-directional; control actions re-enter only as ledger entries; one module / one owner / one enforcement script per subsystem.

**Plan restructure (supersedes the phase shapes in the 2026-07-07 plan):**
- Phase 3.6 hotfix wave (H1–H6) and Phase 3.5 instrument (lh-1, horizon guard profile, cost-per-verified-deliverable lift rule) execute FIRST, unchanged.
- Phase 4 → **4a RunContract → 4b RunLedger → 4c Projector**.
- Phase 5 → **5a RunAssessment → 5b Control Plane**.
- Phases 6 (Policy Compiler) and 7 (Strategy→Policy) unchanged in scope; Phase 6 consumes RunAssessment.
- Durability rule stands: a phase without its grep-able enforcement script is not done.

**Acceptance (from the spec):** mid-run outstanding/artifacts query on lh-1; long-gathering false-positive test (15 distinct successful calls → zero termination pressure); iteration-30 read-back of iteration-3 evidence; rw-8 1-of-3-files terminates `partial` with missing deliverables named; full meta-loop replay from trace events.

**Continuity:** builds on [[2026-07-07-adaptive-harness-architecture-ratified|the 2026-07-07 ratification]] — nothing shipped (gateway, tool surface, terminal gate, bench validity) is discarded; all fold into the actuator row of the meta-loop.
