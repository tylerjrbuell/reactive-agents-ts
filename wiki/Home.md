---
aliases: [Reactive Agents Project Brain]
tags: [MOC, root]
---

# Reactive Agents Project Brain

**Purpose:** Comprehensive knowledge management system for the reactive-agents-ts framework. Maps architecture, tracks research, documents decisions, and enables rapid understanding for agentic coding and research.

**Current Phase:** Phase 1 complete (mechanism validation sweep). Preparing for Phase 2.

---

## Quick Navigation

### 🗺️ Core Maps
- [[Hot.md|Hot (Recent Context)]] — Last 5 session updates, current focus
- [[MOCs/Architecture MOC|Architecture]] — System design, 12-phase kernel, package layers, port system
- [[MOCs/Research MOC|Research & Validation]] — Spike research (M1-M13), failure modes (FM-A–H), improvement loop
- [[MOCs/Concepts MOC|Concepts & Patterns]] — Cognitive architecture, tool integration, safety, memory
- [[MOCs/Decisions MOC|Decisions & Trade-offs]] — Phase gates, north star alignment, strategic choices
- [[MOCs/Packages MOC|Packages & Dependencies]] — 26 packages + 5 apps, layer organization, ownership

### 🏗️ By Category
- **[[MOCs/Architecture MOC|System Architecture]]** — 12-phase kernel, 26 packages + 5 apps, port system, phase details
- **[[Packages/00 Package Index|Package Index]]** — Quick reference for all packages with purposes, dependencies, ownership
- **[[MOCs/Concepts MOC|Core Concepts]]** — Effect-TS, reactive intelligence, tool healing, memory systems, verification
- **[[Failure-Modes/00 FM Catalog|Failure Modes]]** — FM-A through FM-H, empirical evidence, mitigations, integration tests
- **[[MOCs/Decisions MOC|Decisions]]** — Architecture decisions, trade-offs, phase gates, north star alignment
- **[[Decisions/Decision Index|Decision Index]]** — Searchable catalog of all strategic decisions by phase and impact
- **[[Issues/Running Issues Log|Running Issues Log]]** — Critical blockers, known issues, resolutions, historical closure
- **[[MOCs/Research MOC|Research & Validation]]** — All 13 mechanisms (M1-M13), failure mode taxonomy, improvement pipeline

### 🔍 For Different Needs
- **New agent starting work?** → Start with [[Hot.md|Hot]] → [[MOCs/Architecture MOC|Architecture MOC]] → [[Packages/00 Package Index|Package Index]]
- **Understand the kernel?** → [[MOCs/Architecture MOC|Architecture MOC]] (12 phases) → [[MOCs/Concepts MOC|Concepts MOC]] (patterns)
- **Find past decisions?** → [[Decisions/Decision Index|Decision Index]] (searchable by phase & impact) or [[MOCs/Decisions MOC|Decisions MOC]]
- **Validate a mechanism?** → [[MOCs/Research MOC|Research MOC]] → individual M1-M13 notes → [[Failure-Modes/00 FM Catalog|FM Catalog]]
- **Understand failure modes?** → [[Failure-Modes/00 FM Catalog|FM Catalog]] (taxonomy) → [[Failure-Modes/FM-A Tool Engagement|detailed FM notes]]
- **Debug an issue?** → [[Issues/Running Issues Log|Running Issues Log]] (blockers) or [[Failure-Modes/00 FM Catalog|Failure Modes]] (patterns)
- **Learn a design pattern?** → [[MOCs/Concepts MOC|Concepts MOC]] (cognitive, tools, safety, memory, orchestration)
- **Find a package?** → [[Packages/00 Package Index|Package Index]] (all 26 packages + 5 apps) or [[MOCs/Packages MOC|Packages MOC]] (by layer)

---

## Vault Statistics

- **Total Notes:** [auto-calculated by dataview]
- **Architecture Notes:** Packages, concepts, kernel phases, design patterns
- **Research Notes:** 13 mechanism spikes (M1-M13), failure modes (FM-A through FM-H)
- **Decision Notes:** Phase gates, trade-offs, North Star alignment
- **Last Updated:** [auto-calculated]

---

## How to Use This Brain

### Query Examples (for agentic querying)
- "Find all notes tagged #phase-1 that mention 'healing pipeline'"
- "What decisions led to the current kernel architecture?"
- "Which spike research validates the memory system?"
- "Show me all open issues blocking Phase 2"
- "What failure modes does context curation address?"

### Adding to the Brain
1. **New spike research?** → Use [[_Templates/Experiment Template|Experiment Template]] in `Experiments/` folder, tag with mechanism number
2. **Decision made?** → Use [[_Templates/Decision Template|Decision Template]] in `Decisions/` folder with date, context, trade-offs
3. **Discovered a concept?** → Use [[_Templates/Concept Template|Concept Template]] in `Concepts/` folder, link to related mechanisms
4. **New failure mode?** → Add to [[Failure-Modes]] with FM-ID, category, empirical evidence, reproduction steps
5. **Running issue?** → Add to [[Issues/Running Issues Log|Running Issues Log]] with priority, owner, resolution status

### Keeping it Fresh
- Update [[Hot.md|Hot]] at session end with key changes and next steps
- Review [[Issues/Running Issues Log|Running Issues Log]] at phase gates to update status
- Sync [[MOCs]] pages when mechanisms ship or phase gates advance
- Link new notes to existing MOCs (Architecture, Research, Concepts, Decisions, Packages)

---

## Phase Milestones

- ✅ **Phase 0:** Frozen judge validation
- ✅ **Phase 1:** Mechanism validation sweep (13 mechanisms, 8 KEEP / 5 IMPROVE verdicts)
- 🔄 **Phase 1.5:** Improvement iterations (retry tuning, skill persistence, calibration activation)
- 📅 **Phase 2:** Orchestration decomposition (builder/engine/gateway refactor)
- 📅 **Phase 3:** Code-as-action strategy (local model SLM support)
- 📅 **Phase 4-7:** Local model engineering, benchmarking, polish, v1.0 release

See [[Decisions/Phase Gate Log|Phase Gate Log]] for validation criteria.

---

**Last Synced:** 2026-05-04 | **Branch:** refactor/overhaul | **v0.10.0 release-ready**
