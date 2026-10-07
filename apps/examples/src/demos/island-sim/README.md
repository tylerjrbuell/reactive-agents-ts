# Island Survival Simulation

A watchable, offline-first island-survival story. A deterministic engine owns the world, needs, actions, social trust, alliances, objectives, exile, and daily twists. Survivor portraits, the island map, camp dashboard, and event rail update incrementally as the simulation runs.

## Run

```bash
bun run apps/examples/src/demos/island-sim/index.ts
```

Open `http://localhost:3007` (or the port set with `PORT`). The demo uses scripted survivor decisions and tries Ollama for a compact world blueprint (`ollama/cogito:14b`) when available. World generation falls back to a deterministic island if provider setup or generation fails.

Set `ISLAND_SIM_MODEL` to choose a different Ollama model. Survivor decisions remain deterministic and engine-owned.

## Simulation systems

- Castaways have distinct roles, personal objectives, and a shared rescue objective. Completed actions update objective progress and produce story milestones.
- Repeated reciprocal trust forms persistent alliances. Members share an exclusive private stash; the public camp cache and island resources remain open to outsiders.
- Carry-aware choices send full packs back to camp to store supplies instead of repeatedly attempting impossible gathers.
- Repeated theft or sabotage inside an alliance can trigger a relationship-weighted vote. Exile lasts 12 in-world hours, reserves a survival kit, and ends with an automatic return.
- One seeded incident is scheduled each in-world day: a washed-up cache, a distant rescue signal, or a storm front. Incidents are recoverable and replayable.
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

## Verification

```bash
bun test apps/examples/src/demos/island-sim --timeout 15000
bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types bun-types $(find apps/examples/src/demos/island-sim -name '*.ts' -print)
```
