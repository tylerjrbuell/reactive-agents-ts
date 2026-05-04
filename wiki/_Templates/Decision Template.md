---
aliases: [Decision Title]
tags: [decision, architecture, trade-off]
date: YYYY-MM-DD
status: ACCEPTED|DEFERRED|SUPERSEDED
owner: Team Name
phase: Phase N
---

# Decision: [Title]

**Date:** [YYYY-MM-DD]

**Owner:** [Team or individual making this decision]

**Status:** [ACCEPTED|DEFERRED|SUPERSEDED]

**Phase:** [When this decision applies]

---

## Problem Statement

[1-2 paragraphs describing the problem this decision addresses.]

### Context

- **Constraint 1:** [What limits our options]
- **Constraint 2:** [What limits our options]
- **Stakeholder:** [Who is affected by this decision]

---

## Options Considered

### Option 1: [Brief name]

**Description:** [2-3 sentences describing this approach]

**Pros:**
- [Pro 1]
- [Pro 2]

**Cons:**
- [Con 1]
- [Con 2]

**Cost:** [Token, latency, complexity, maintenance burden]

### Option 2: [Brief name]

[Same structure as Option 1]

### Option 3: [Brief name]

[Same structure as Option 1]

---

## Chosen Solution

### Decision

**We choose Option N: [Brief name]** because [one sentence rationale].

### Rationale

[2-3 paragraphs explaining why this option best balances the trade-offs.]

### Trade-off

- **We gain:** [What we get]
- **We accept:** [What we give up]
- **Mitigation:** [How we address the downside]

---

## Implementation

### Affected Components

- `packages/package-name` — [What changes here]
- `packages/package-name` — [What changes here]

### Key Files

- `key/file/path.ts` — [Implementation details]
- `key/file/path.test.ts` — [Test location]

### Validation

- **Test:** [How we verify this decision works]
- **Metric:** [What we measure to prove it's the right call]
- **Evidence:** [Link to validation results]

---

## Superseded Decisions

[If this decision replaces a prior decision, note it here with context.]

---

## Phase Gates & Dependencies

- **Blocked by:** [Other decisions that must be made first]
- **Blocks:** [Decisions that depend on this one]
- **Phase gate:** Phase [N] — [Specific gate this enables]

---

## Audit & Compliance

- **Aligns with:** [[Decisions/North Star v3.0|North Star Design]]
- **Enforced by:** [CI lint rule, test suite, manual code review]
- **Review cadence:** [When this should be re-evaluated]

---

## References

- [[MOCs/Decisions MOC|Decisions MOC]] — All architecture decisions
- [[Decisions/North Star v3.0|North Star Design]] — Design principles this supports
- [[MOCs/Architecture MOC|Architecture MOC]] — System design context

---

**Last Updated:** [Date]  
**Phase:** Phase N  
**Status:** [ACCEPTED|DEFERRED|SUPERSEDED]
