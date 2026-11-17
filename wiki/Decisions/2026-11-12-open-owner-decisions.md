---
type: decision
status: proposed
created: 2026-11-12
tags: [decision, pii, structured-output, harness, ablation]
---

# Open owner decisions (2026-11-12)

Four calls the owner has not yet made. Each shipped with a default; none is irreversible.

## 1. SSN detection loosened (commit 5e79e5d5a)
- **Shipped:** a bare 9-digit number is an SSN only when SSN wording is nearby; cards need a Luhn pass; Amex, international phones and UK postcodes are now detected.
- **Why:** the old rule blocked order numbers and ids as SSNs.
- **Risk:** an SSN written with no wording and no dashes is no longer caught.
- **Decide:** keep, or restore bare 9 digits as a block with a warn-only tier.

## 2. In-house JSON Schema validator (`json-schema-contract.ts`)
- **Shipped:** a dependency-free subset validator; unsupported keywords raise `OutputSchemaError` at build time (now also in Cortex).
- **Alternative:** ajv or @cfworker/json-schema (full spec, one dependency).
- **Decide:** keep the subset (zero deps, honest errors) or adopt a library for full coverage.

## 3. Final write-up counts as model-written (a0e150074)
- **Shipped:** a synthesized final answer is labelled model-written, so the runtime no longer blanks it; a sub-agent finishing this way is `completed`, not `partial`.
- **Decide:** confirm that semantic, or keep a distinct label such as `synthesized` that is released but flagged.

## 4. Default-on evidence missing
- **To-do wrap-up turn** (7d273d564): one extra model call when a run ends with open to-dos. Not ablated; plan V5 recorded an earlier rejection of a similar verify-retry. Needs a cross-tier ablation before default-on is ratified.
- **Learned calibration after 5 runs:** applies automatically; never ablated.
- **Decide:** approve a benchmark spend for both, or flag them opt-in until measured.
- **Decided 2026-11-17 (wrap-up):** opt-in until measured. `RA_TODO_WRAPUP=1` enables it (`6a94f6eeb`). A `.withHarness({ todoWrapUp })` field and a `run-started.config` entry are a runtime follow-up. Returning it to default-on needs a cross-tier ablation.
- **Decided 2026-11-17 (calibration):** learned and community calibration are both opt-in (`24f53da9a`), enabled with `.withCalibration("auto", { learned: true, community: true })`. Observations are still recorded locally. The docs must state the benefits clearly (owner requirement). Community fetch honors DO_NOT_TRACK (`6bdf002b6`). Telemetry is opt-in too (`aa92c22fb`).
