---
"@reactive-agents/cortex": minor
---

Cortex Lab in the "Bench" design (step 6 of the modernization plan), plus fixes found while checking Beacon.

- The **Builder** has three columns: a section nav (Model, Persona, Reasoning, Tools, Shell and workspace, Sub-agents, Skills, Memory, Guardrails, Execution, Reliability, Observability, All framework options) with **Find a setting**, the chosen section's settings, and **Run this agent**: On demand or Gateway process, name, task, a summary of what will run (model, strategy, tools, workspace) and **Save and run**, **Save** or **Run without saving**. Shell and workspace and All framework options are now sections of their own.
- The Lab header has **Import**, **Export** and **Load example**; the stat cards are gone. Tabs show counts: Builder, **Saved agents** (now `/lab#agents`; old `#gateway` links still open it), Skills, Tools, Prompts.
- Saved agents, Skills, Tools (catalog, inspector, test runner, custom tool and MCP server forms) and Prompts use Cortex's own components and icons: readable sizes, sentence-case labels, both themes.
- Desk **Stop** now ends a run that is busy inside a long model call: if it has not stopped a few seconds after Stop, Cortex ends it like Terminate. **Terminate** no longer leaves the run **Failed** with "ManagedRuntime disposed"; both end the run as **Stopped**.
- A desk run paused at an approval gate (or on a question) reads **Waiting on you** in Runs, the run view and Beacon instead of Running.
- Toasts no longer cover the Run button on Beacon's prompt bar; they sit above it.
- The run view title no longer shows an agent id used as the run's label; it falls back to the chat or the task, as Runs does.
- Fixed: confirm dialogs (Terminate, delete), the workspace picker, the export dialog and the command palette lost their layer and layout after the token update and could open under the page.
