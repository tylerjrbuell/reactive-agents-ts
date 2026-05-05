---
type: implementation-plan
status: active
created: YYYY-MM-DD
completed: null
authored-by: <agent-name>
related: []
---

# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Storage convention:** This plan lives at `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md` per the agent-agnostic storage convention. See [[Planning-Index]] for the full index.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Related:**
- Spec: [[Architecture/Design-Specs/YYYY-MM-DD-related-spec|related spec]]
- Decision: [[Decisions/YYYY-MM-DD-related-decision|related decision]]

---

## File Structure

[Map files to be created/modified before defining tasks]

- Create: `path/to/new-file.ts`
- Modify: `path/to/existing-file.ts:LINE-LINE`
- Test: `tests/path/to/test.ts`

---

## Tasks

### Task 1: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Test: `tests/exact/path/to/test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("specific behavior", () => {
  // ...
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/path/to/test.ts
```

Expected: FAIL with specific error

- [ ] **Step 3: Implement**

```ts
// minimal implementation
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```bash
git add tests/ src/
git commit -m "feat: short description"
```

### Task 2: [...]

[Repeat structure]

---

## Self-Review Checklist

- [ ] All spec requirements have implementing tasks
- [ ] No placeholders (TBD, TODO, "implement later")
- [ ] All file paths are exact
- [ ] Code blocks complete (no ellipses)
- [ ] Type/method names consistent across tasks
- [ ] Tests written for each component
- [ ] Commit points well-defined

---

## After Completion

- [ ] Update frontmatter: `status: completed`, `completed: YYYY-MM-DD`
- [ ] Move row in [[Planning-Index]] from "Active" to "Completed"
- [ ] (Optional) Write debrief: `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md`
- [ ] Update related specs/decisions with link back to this plan
