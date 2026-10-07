# Island Survival Simulation

A watchable, offline-first island-survival story. A deterministic engine owns the world, needs, actions, social trust, alliances, objectives, exile, and daily twists. Survivor portraits, the island map, camp dashboard, and event rail update incrementally as the simulation runs.

## Run

```bash
bun run apps/examples/src/demos/island-sim/index.ts
```

Open `http://localhost:3007` (or the port set with `PORT`). The demo uses scripted survivor decisions and tries Ollama for a compact world blueprint (`ollama/cogito:14b`) when available. World generation falls back to a deterministic island if provider setup or generation fails.

Set `ISLAND_SIM_MODEL` to choose a different Ollama model. Survivor decisions remain deterministic and engine-owned by default.

Two framework-native opt-ins:

- `ISLAND_SIM_LLM_DECISIONS=1` builds a structured-output survivor agent (higher latency/expense); any provider failure degrades that decision to the scripted maker, so the tick loop never stalls.
- A second ReactiveAgents agent writes the day-by-day "🎙️ Narrator's journal" (`GET /api/chronicle`): reality-TV day recaps plus one confessional quote per day. When Ollama is unreachable a deterministic template narrator fills the same shape, so the chronicle always renders.

## Simulation systems

- Castaways have distinct roles, personal objectives, and a shared rescue objective. Completed actions update objective progress and produce story milestones.
- Scarcity: berries and water regrow slowly, fish slower still, and wood/stone are finite (regrowth 0) — long games force longer treks. Storm days salt the land and suppress regrowth.
- Deaths are remembered: castaway cards and the dossier show a 💀 cause-of-death line (`demise` is typed, serializable state).
- Repeated reciprocal trust forms persistent alliances. Members share an exclusive private stash; the public camp cache and island resources remain open to outsiders. When death shrinks an alliance below two survivors it dissolves and its private stash spills into the public camp cache, with grief events for mourning.
- Under starvation pressure castaways can steal from neighbors; theft feeds the relationship-weighted exile-vote machinery. Exile lasts 12 in-world hours, reserves a survival kit, and ends with an automatic return.
- One seeded incident is scheduled each in-world day: a washed-up cache, a distant rescue signal, or a storm front. Incidents are recoverable and replayable.
- Finale: once the rescue objective completes with a signal fire standing in non-storm weather, a boat arrives — the story ends with how many made it home. If everyone dies first, the run ends with an all-lost event, a memorial roll (name · day · cause) and an epilogue chapter in the journal.
- Narration accounts for the actual story: deaths are named with their cause, pacts, exiles, thefts, builds, twists, and rescues are all called out, and the confessional voice belongs to the day's most-affected survivor.
- Hunger, thirst, and fatigue create pressure. Activity increases fatigue, storms make exertion harder, and rest reduces fatigue.

## Controls and viewing

- **🔄 New island** generates a fresh world; **▶ Resume story**, **⏸ Pause**, and **⏭ Advance hour** control time. Pace selects ticks per second.
- The dashboard is a three-column grid (map, castaways + camp, story log) that stacks to two columns and then one on narrow screens.
- Survival bars show a visual fill plus the exact percentage; needs turn amber at 40% pressure and red at 70%. Survivor cards show their current objective and an alliance-colored dot.
- Resource and structure markers use unambiguous emoji glyphs (🫐 🐟 💧 🪵 🪨 ⛺ 🔥 🏕️ 🆘) with a labeled legend and tooltips naming kind, quantity, and tile.
- Alliances are visualized: colored dashed lines connect member markers on the map, member rings adopt the alliance color, and hovering an alliance row highlights only that alliance's link.
- Select or hover a castaway to preview their needs and follow their movement. Map stacks mark co-located survivors; activate `+N` to cycle selection.
- Movement and actions are animated between ticks: markers glide to new tiles, action glyphs (⛏️ 💧 💬 🤝 🏗️ 🆘 🌟 🌀) briefly pop above the acting castaway, and recent movement trails stay faintly visible; the focused survivor's trail is highlighted.
- The camp dashboard shows objectives, public supplies, alliances/private stash totals, and exile countdowns. Search and filter the story rail by castaway and event type.
- The "🎙️ Narrator's journal" is a day timeline: a scrollable strip of mood-tinted day chips over a single comfortable reading pane (headline, recap, confessional). Click a day to read its chapter; the journal resets when you start a new island.
- Endings show a banner with a "🔄 Start a new island" button: a rescue banner with survivors evacuated, or a somber memorial listing every death with its day and cause.

## Verification

```bash
bun test apps/examples/src/demos/island-sim --timeout 15000
bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types bun-types $(find apps/examples/src/demos/island-sim -name '*.ts' -print)
```
