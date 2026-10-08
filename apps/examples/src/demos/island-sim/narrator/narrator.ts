import type { SimEvent } from "../engine/events.js";
import type { WorldState } from "../world/schema.js";
import { Schema } from "effect";

/** Structured output contract the LLM narrator must return each day. */
export const NarrationLogSchema = Schema.Struct({
  headline: Schema.String,
  recap: Schema.String,
  mood: Schema.optional(Schema.String),
  confessional: Schema.Struct({
    name: Schema.String,
    quote: Schema.String,
  }),
});
export type NarrationLog = typeof NarrationLogSchema.Type;

/** Shorthand for one narrated day: headline, recap paragraph, and one confessional voice. */
export type NarrationEntry = {
  day: number;
  headline: string;
  recap: string;
  confessional: { name: string; quote: string; mood: string };
  source: "template" | "llm";
};

export type NarrationInput = {
  world: WorldState;
  day: number;
  dayStartTick: number;
  dayEndTick: number;
  events: Array<{ sequence: number; event: SimEvent }>;
};

/** A narrator produces one entry per in-world day and retains the full chronicle. */
export type Narrator = {
  narrate(input: NarrationInput): Promise<NarrationEntry> | NarrationEntry;
  chronicle(): NarrationEntry[];
  reset(): void;
};

function tally(events: readonly SimEvent[]) {
  const counts = { moved: 0, gathered: 0, talked: 0, helped: 0, stolen: 0, died: 0, built: 0, twists: 0, discovered: 0, objectives: 0, hurt: 0, sick: 0, recovered: 0, votes: 0, exiles: 0, rescued: 0, critical: 0 };
  for (const event of events) {
    if (event.kind === "agent-moved") counts.moved += 1;
    else if (event.kind === "resource-gathered") counts.gathered += 1;
    else if (event.kind === "talked") counts.talked += 1;
    else if (event.kind === "shared" || event.kind === "helped") counts.helped += 1;
    else if (event.kind === "stolen" || event.kind === "sabotaged") counts.stolen += 1;
    else if (event.kind === "agent-died") counts.died += 1;
    else if (event.kind === "built") counts.built += 1;
    else if (event.kind === "island-twist") counts.twists += 1;
    else if (event.kind === "discovered") counts.discovered += 1;
    else if (event.kind === "objective-completed") counts.objectives += 1;
    else if (event.kind === "injured") counts.hurt += 1;
    else if (event.kind === "illness") counts.sick += 1;
    else if (event.kind === "recovered") counts.recovered += 1;
    else if (event.kind === "vote-cast") counts.votes += 1;
    else if (event.kind === "exile-started" || event.kind === "exile-returned") counts.exiles += 1;
    else if (event.kind === "rescue-arrived") counts.rescued += 1;
    else if (event.kind === "needs-critical") counts.critical += 1;
  }
  return counts;
}


function eventActors(event: SimEvent): string[] {
  const ids: string[] = [];
  const record = event as Partial<Record<"agentId" | "from" | "to" | "voterId" | "targetId", unknown>> & { members?: unknown; survivors?: unknown };
  for (const key of ["agentId", "from", "to", "voterId", "targetId"] as const) {
    if (typeof record[key] === "string") ids.push(record[key] as string);
  }
  if (Array.isArray(record.members)) for (const id of record.members) if (typeof id === "string") ids.push(id);
  if (Array.isArray(record.survivors)) for (const id of record.survivors) if (typeof id === "string") ids.push(id);
  return ids;
}

function pickNarrators(world: WorldState, events: readonly SimEvent[]): string | undefined {
  const living = new Set(world.agents.filter((agent) => agent.status !== "dead").map((agent) => agent.id));
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const id of eventActors(event)) {
      if (!living.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const mostActive = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (mostActive) return world.agents.find((agent) => agent.id === mostActive)?.name ?? mostActive;
  return world.agents.find((agent) => agent.status !== "dead")?.name;
}

function dayOf(tick: number): number {
  return Math.floor(tick / 24) + 1;
}

function headlineFor(counts: ReturnType<typeof tally>, alliances: number, deaths: readonly SimEvent[]): string {
  if (counts.rescued > 0) return "A boat on the horizon: rescue";
  if (counts.died > 0) return deaths.length === 1 ? "The island takes one of us" : "The island takes more than one";
  if (counts.exiles > 0) return "Voted off to the exile cay";
  if (counts.votes > 0) return "Tribal council gathers at dusk";
  if (counts.stolen > 0) return "Hands wander when the packs are light";
  if (counts.discovered > 0) return "What the island was hiding";
  if (counts.objectives > 0) return "A goal struck off the list";
  if (alliances > 0) return "Shoreline pacts hold for another day";
  if (counts.gathered > 6) return "A provident day of gathering";
  return "Another drift of tides and hours";
}

/** Turn the day's raw events into named, human-scale beats for the recap. */
function highlightLines(world: WorldState, events: readonly SimEvent[]): string[] {
  const name = (id: string) => world.agents.find((agent) => agent.id === id)?.name ?? id;
  const priority: string[] = [];
  const secondary: string[] = [];
  let voteCount = 0;
  const voteTargets = new Map<string, number>();
  for (const event of events) {
    switch (event.kind) {
      case "agent-died":
        priority.push(`${name(event.agentId)} died of ${event.cause.replace(/_/g, " ")}.`);
        break;
      case "rescue-arrived":
        priority.push(event.survivors.length > 0
          ? `A boat reached the shore: rescue for ${event.survivors.map(name).join(", ")}.`
          : "A boat reached the shore: rescue.");
        break;
      case "all-lost":
        priority.push(`All were lost: ${event.names.join("; ")}.`);
        break;
      case "exile-started":
        priority.push(`${name(event.agentId)} was voted off to the exile cay at ${event.location}, back around Day ${dayOf(event.returnAtTick)}.`);
        break;
      case "exile-returned":
        priority.push(`${name(event.agentId)} returned from exile at ${event.location}.`);
        break;
      case "alliance-formed":
        priority.push(`${event.name} formed around ${event.members.map(name).join(" and ")}.`);
        break;
      case "alliance-dissolved":
        priority.push(`${event.name} broke apart.`);
        break;
      case "grief":
        priority.push(event.description);
        break;
      case "vote-called":
        priority.push("The camp gathered for a tribal council at dusk.");
        break;
      case "vote-cast":
        voteCount += 1;
        voteTargets.set(event.targetId, (voteTargets.get(event.targetId) ?? 0) + 1);
        secondary.push(`${name(event.voterId)} voted to exile ${name(event.targetId)}.`);
        break;
      case "island-twist":
        priority.push(event.twist === "weather-front" ? `A weather front moved in: ${event.description}` : event.twist === "cache-found" ? `A supply cache washed ashore: ${event.description}` : `A rescue signal crossed the horizon: ${event.description}`);
        break;
      case "discovered":
        priority.push(event.description);
        break;
      case "objective-completed": {
        const owner = world.agents.find((agent) => agent.id === event.agentId)?.name;
        priority.push(owner && event.agentId !== "all" ? `${owner} completed "${event.title}".` : `"${event.title}" is done.`);
        break;
      }
      case "injured":
        secondary.push(`${name(event.agentId)} was injured (${event.cause.replace(/_/g, " ")}).`);
        break;
      case "illness":
        secondary.push(`${name(event.agentId)} fell ill (${event.cause.replace(/_/g, " ")}).`);
        break;
      case "recovered":
        secondary.push(`${name(event.agentId)} recovered.`);
        break;
      case "needs-critical":
        secondary.push(`${name(event.agentId)} is critical: ${event.need.replace(/_/g, " ")}.`);
        break;
      case "stolen":
        secondary.push(`${name(event.from)} took ${event.item} from ${name(event.to)}.`);
        break;
      case "sabotaged":
        secondary.push(`${name(event.from)} sabotaged ${name(event.to)}'s ${event.item}.`);
        break;
      case "helped":
        secondary.push(`${name(event.from)} helped ${name(event.to)} with ${event.need}.`);
        break;
      case "built":
        secondary.push(`${name(event.agentId)} built a ${(event.structureKind ?? "shelter").replace(/-/g, " ")}.`);
        break;
      default:
        break;
    }
  }
  // Council ballots are grouped so one long vote list cannot drown deaths, rescue, or exile.
  const votes = secondary.filter((line) => line.includes("voted to exile"));
  const rest = secondary.filter((line) => !line.includes("voted to exile"));
  const topTarget = [...voteTargets.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  const voteLines = topTarget && voteCount > 3
    ? [...votes.slice(0, 2), `${voteCount - 2} more ballots cast, most for ${name(topTarget[0])}.`]
    : votes;
  return [...priority, ...voteLines, ...rest];
}

/** Who is still standing, who was lost, and with what pressures: the ground truth every recap must honor. */
function rosterLines(world: WorldState): { alive: string; lost: string; pressure: string; bonds: string; aims: string } {
  const roleOf = (id: string) => world.agents.find((agent) => agent.id === id)?.beliefs?.find((belief) => belief.subject === "island role")?.claim;
  const living = world.agents.filter((agent) => agent.status !== "dead");
  const dead = world.agents.filter((agent) => agent.status === "dead");
  const describeLiving = living.map((agent) => {
    const role = roleOf(agent.id);
    const flag = agent.status === "alive" ? "" : ` (${agent.status})`;
    const worst: Array<[string, number]> = [["hunger", agent.needs.hunger], ["thirst", agent.needs.thirst], ["energy", 10 - agent.needs.energy]];
    worst.sort((left, right) => right[1] - left[1]);
    const strain = worst[0]![1] >= 7 ? `, weakest: ${worst[0]![0]}` : "";
    return `${agent.name}${role ? ` (${role})` : ""}${flag}${strain}`;
  });
  const alive = living.length > 0 ? `${living.length} alive: ${describeLiving.join("; ")}.` : "No one left alive.";
  const lost = dead.length > 0
    ? `${dead.length} lost: ${dead.map((agent) => `${agent.name} (Day ${dayOf(agent.demise?.tick ?? world.clock.tick)}, ${String(agent.demise?.cause ?? "unknown").replace(/_/g, " ")})`).join("; ")}.`
    : "No one lost yet.";
  const strained = living.filter((agent) => agent.needs.hunger >= 7 || agent.needs.thirst >= 7 || agent.status === "injured" || agent.status === "ill");
  const pressure = strained.length > 0
    ? `Strained: ${strained.map((agent) => `${agent.name}${agent.status !== "alive" ? ` (${agent.status})` : ""} (hunger ${agent.needs.hunger}, thirst ${agent.needs.thirst}, energy ${agent.needs.energy})`).join("; ")}.`
    : "";
  const alliances = world.gameplay?.alliances ?? [];
  const exiles = world.gameplay?.exiles ?? [];
  const bondBits: string[] = [];
  if (alliances.length > 0) bondBits.push(`${alliances.length} pact${alliances.length > 1 ? "s" : ""}: ${alliances.map((alliance) => `${alliance.name} (${alliance.members.map((id) => world.agents.find((agent) => agent.id === id)?.name ?? id).join(", ")})`).join("; ")}`);
  if (exiles.length > 0) bondBits.push(`Exiled: ${exiles.map((exile) => `${world.agents.find((agent) => agent.id === exile.agentId)?.name ?? exile.agentId} at ${exile.location} until Day ${dayOf(exile.returnAtTick)}`).join("; ")}`);
  const lastVote = world.gameplay?.lastVote;
  if (lastVote?.exiledId) bondBits.push(`Last council: ${world.agents.find((agent) => agent.id === lastVote.exiledId)?.name ?? lastVote.exiledId} voted off (${lastVote.votes.length} ballots)`);
  const bonds = bondBits.length > 0 ? `${bondBits.join(". ")}.` : "No loyalty holds sway yet.";
  const objectives = world.gameplay?.objectives ?? [];
  const done = objectives.filter((objective) => objective.completed);
  const discovered = world.gameplay?.discovered ?? [];
  const aimBits: string[] = [];
  if (done.length > 0) aimBits.push(`${done.length}/${objectives.length} goals done (${done.map((objective) => objective.title).join("; ")})`);
  if (discovered.length > 0) aimBits.push(`Found: ${discovered.join("; ")}`);
  if (world.gameplay?.poisonedSpring) aimBits.push(`Poisoned spring: ${world.gameplay.poisonedSpring}`);
  const aims = aimBits.length > 0 ? `${aimBits.join(". ")}.` : "";
  return { alive, lost, pressure, bonds, aims };
}

function recapFor(world: WorldState, counts: ReturnType<typeof tally>, weather: string, rescued: boolean, highlights: readonly string[]): string {
  const roster = rosterLines(world);
  const bits = [
    `Day ${world.clock.day}, ${weather}: ${counts.moved} treks, ${counts.gathered} bundles gathered, ${counts.talked} fireside talks.`,
    roster.alive,
    roster.lost,
    ...highlights.slice(0, 8),
    roster.pressure,
    roster.bonds,
    roster.aims,
    counts.twists > 0 ? "The island shifted under their feet." : "",
    rescued ? "Somewhere out there, a boat has seen the smoke." : "",
  ];
  return bits.filter(Boolean).join(" ");
}

/** Choose the confessional voice: the day's most-affected living survivor, never a corpse. */
function confessionalFor(world: WorldState, events: readonly SimEvent[], mood: string): { name: string; quote: string } {
  const name = (id: string) => world.agents.find((agent) => agent.id === id)?.name ?? id;
  const living = world.agents.filter((agent) => agent.status !== "dead");
  if (living.length === 0) return { name: "the island", quote: "The fire went out, and nobody was left to feed it." };
  const deaths = events.filter((event) => event.kind === "agent-died");
  if (deaths.length > 0) {
    const lostNames = deaths.map((event) => event.kind === "agent-died"
      ? `${name(event.agentId)} (${event.cause.replace(/_/g, " ")})` : "").filter(Boolean);
    const deadIds = new Set(deaths.map((event) => event.kind === "agent-died" ? event.agentId : ""));
    const mourner = living.find((agent) => Object.keys(agent.relationships).some((id) => deadIds.has(id)))
      ?? living.slice().sort((left, right) => Object.keys(right.relationships).length - Object.keys(left.relationships).length)[0]!;
    return {
      name: mourner.name,
      quote: `We lost ${lostNames.join(" and ")} today. The island doesn't care how good a person you are.`,
    };
  }
  const exile = events.find((event) => event.kind === "exile-started");
  if (exile && exile.kind === "exile-started") {
    const voter = events.find((event) => event.kind === "vote-cast" && event.targetId === exile.agentId);
    const speaker = (voter && voter.kind === "vote-cast" ? living.find((agent) => agent.id === voter.voterId) : undefined) ?? living[0]!;
    return { name: speaker.name, quote: `I voted for ${name(exile.agentId)}. Out there, trust is the only currency that matters.` };
  }
  const theft = events.find((event) => event.kind === "stolen" || event.kind === "sabotaged");
  if (theft && (theft.kind === "stolen" || theft.kind === "sabotaged")) {
    const victim = living.find((agent) => agent.id === theft.to) ?? living[0]!;
    return { name: victim.name, quote: "I keep my supplies closer than my friends these days." };
  }
  const objective = events.find((event) => event.kind === "objective-completed");
  if (objective && objective.kind === "objective-completed") {
    const finisher = living.find((agent) => agent.id === objective.agentId) ?? living.find((agent) => agent.name === pickNarrators(world, events)) ?? living[0]!;
    return { name: finisher.name, quote: `We finished "${objective.title}". Proof we can still do this together.` };
  }
  const speaker = pickNarrators(world, events) ?? "the camp";
  const quote = mood === "wary"
    ? "I keep my supplies closer than my friends these days."
    : mood === "hopeful"
      ? "That signal fire better be tall enough to be seen from the moon."
      : mood === "grieving"
        ? "We buried another one today. The tide keeps taking more than it gives."
        : "One more day. That's all we do out here. One more day.";
  return { name: speaker, quote };
}

/** Stand-in narrator with deterministic humane prose when no LLM provider is reachable. */
export function makeTemplateNarrator(): Narrator {  const chronicleEntries: NarrationEntry[] = [];
  return {
    narrate(input: NarrationInput): NarrationEntry {
      const events = input.events.filter((item) => item.event.tick >= input.dayStartTick && item.event.tick <= input.dayEndTick).map((item) => item.event);
      const counts = tally(events);
      const alliances = input.world.gameplay?.alliances.length ?? 0;
      const deaths = events.filter((event) => event.kind === "agent-died");
      const highlights = highlightLines(input.world, events);
      const mood = counts.died > 0 ? "grieving" : counts.stolen > 0 ? "wary" : counts.built > 0 || counts.objectives > 0 ? "hopeful" : "steady";
      const entry: NarrationEntry = {
        day: input.day,
        headline: headlineFor(counts, alliances, deaths),
        recap: recapFor(input.world, counts, input.world.weather.condition, input.world.gameplay?.rescueAtTick !== undefined, highlights),
        confessional: { ...confessionalFor(input.world, events, mood), mood },
        source: "template",
      };
      chronicleEntries.push(entry);
      return entry;
    },
    chronicle() {
      return [...chronicleEntries];
    },
    reset() {
      chronicleEntries.length = 0;
    },
  };
}

/**
 * Narrator backed by a ReactiveAgents structured-output agent. On any provider failure the
 * template narrator answers for that day, so the chronicle never stalls.
 */
export function makeLlmNarrator(agent: { run(input: string): Promise<{ object?: unknown; objectError?: string }> } | undefined, fallback: Narrator = makeTemplateNarrator()): Narrator {
  const chronicleEntries: NarrationEntry[] = [];
  if (!agent) {
    return fallback;
  }
  return {
    async narrate(input: NarrationInput): Promise<NarrationEntry> {
      const events = input.events.filter((item) => item.event.tick >= input.dayStartTick && item.event.tick <= input.dayEndTick).map((item) => item.event);
      const counts = tally(events);
      const roster = rosterLines(input.world);
      try {
        const highlights = highlightLines(input.world, events);
        const livingNames = input.world.agents.filter((agent) => agent.status !== "dead").map((agent) => agent.name).join(", ") || "none";
        const deadNames = input.world.agents.filter((agent) => agent.status === "dead").map((agent) => `${agent.name} (${String(agent.demise?.cause ?? "unknown").replace(/_/g, " ")})`).join(", ") || "none";
        const result = await agent.run(
          `Day ${input.day} on the island (ticks ${input.dayStartTick}-${input.dayEndTick}). Weather: ${input.world.weather.condition}. ` +
          `Alive now: ${livingNames}. Dead to date: ${deadNames}. ${roster.alive} ${roster.lost} ${roster.pressure} ${roster.bonds} ${roster.aims} ` +
          `Activity: ${counts.moved} moves, ${counts.gathered} gathers, ${counts.talked} conversations, ${counts.helped} kindnesses, ` +
          `${counts.stolen} thefts, ${counts.built} builds, ${counts.died} deaths, ${counts.twists} twists, ${counts.discovered} discoveries, ` +
          `${counts.objectives} goals finished, ${counts.hurt} injured, ${counts.sick} ill, ${counts.recovered} recovered, ${counts.votes} ballots, ${counts.exiles} exiles. ` +
          (highlights.length > 0 ? `Verified moments in order: ${highlights.join(" ")} ` : "") +
          `Rules: name only real castaways above; mourn every death above by name and cause; keep the confessional voice alive (one of: ${livingNames}); never resurrect the dead; never invent new survivors, goals, or rescues. ` +
          `Write a reality-TV style day log that names who did what and what it means for survival.`,
        );
        const object = result.objectError ? undefined : (result.object as Record<string, unknown> | undefined);
        if (object && typeof object.headline === "string" && typeof object.recap === "string") {
          const livingNames = new Set(input.world.agents.filter((agent) => agent.status !== "dead").map((agent) => agent.name));
          const rawName = typeof object.confessional === "object" && object.confessional !== null && typeof (object.confessional as Record<string, unknown>).name === "string" ? String((object.confessional as Record<string, unknown>).name) : "";
          const entry: NarrationEntry = {
            day: input.day,
            headline: object.headline,
            recap: object.recap,
            confessional: {
              name: livingNames.has(rawName) ? rawName : pickNarrators(input.world, events) ?? "the camp",
              quote: typeof object.confessional === "object" && object.confessional !== null && typeof (object.confessional as Record<string, unknown>).quote === "string" ? String((object.confessional as Record<string, unknown>).quote) : "One more day out here.",
              mood: typeof (object as { mood?: unknown }).mood === "string" ? String((object as { mood?: unknown }).mood) : "steady",
            },
            source: "llm",
          };
          chronicleEntries.push(entry);
          return entry;
        }
      } catch {
        // fall through to the template narrator
      }
      return Promise.resolve(fallback.narrate(input));
    },
    chronicle() {
      return [...chronicleEntries, ...fallback.chronicle()];
    },
    reset() {
      chronicleEntries.length = 0;
      fallback.reset();
    },
  };
}
