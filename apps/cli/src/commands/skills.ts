import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import {
  SkillStoreService,
  SkillStoreServiceLive,
  MemoryDatabaseLive,
  exportSkillToMarkdown,
  importSkillFromMarkdown,
  defaultMemoryConfig,
  type SkillImportOverrides,
} from "@reactive-agents/memory";
import { fail, info } from "../ui.js";

type Flags = {
  agent?: string;
  name?: string;
  out?: string;
  rebind?: string;
  regenerateId?: boolean;
  dbPath?: string;
};

const parseFlags = (argv: readonly string[]): { positional: string[]; flags: Flags } => {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) {
      positional.push(tok);
      continue;
    }
    const eq = tok.indexOf("=");
    if (eq > 0) {
      const k = tok.slice(2, eq);
      const v = tok.slice(eq + 1);
      assignFlag(flags, k, v);
    } else {
      const k = tok.slice(2);
      if (k === "regenerate-id") {
        flags.regenerateId = true;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          assignFlag(flags, k, next);
          i++;
        } else {
          assignFlag(flags, k, "true");
        }
      }
    }
  }
  return { positional, flags };
};

const assignFlag = (flags: Flags, k: string, v: string): void => {
  switch (k) {
    case "agent":
      flags.agent = v;
      break;
    case "name":
      flags.name = v;
      break;
    case "out":
      flags.out = v;
      break;
    case "rebind":
      flags.rebind = v;
      break;
    case "db":
    case "db-path":
      flags.dbPath = v;
      break;
    case "regenerate-id":
      flags.regenerateId = v === "true";
      break;
  }
};

const resolveDbPath = (agentId: string, override?: string): string => {
  if (override) return path.resolve(override);
  return path.resolve(defaultMemoryConfig(agentId).dbPath);
};

const layerFor = (agentId: string, dbPath: string) => {
  const cfg = { ...defaultMemoryConfig(agentId), dbPath };
  return SkillStoreServiceLive.pipe(Layer.provide(MemoryDatabaseLive(cfg)));
};

const HELP = `
  Usage: rax skills <subcommand> [options]

  Subcommands:
    export --agent <id> [--name <skillName>] [--out <file|dir>]   Export one or all skills as SKILL.md
    import <file> --agent <id> [--rebind <newAgentId>] [--regenerate-id]   Import from a SKILL.md file
    list --agent <id>                                            List all skills for an agent

  Common flags:
    --db <path>    Override default memory DB path (default: .reactive-agents/memory/<agent>/memory.db)

  Examples:
    rax skills export --agent research-bot --name web-search-strategy --out ./SKILL.md
    rax skills export --agent research-bot --out ./exported-skills/
    rax skills import ./SKILL.md --agent research-bot
    rax skills import ./SKILL.md --agent new-agent --rebind new-agent --regenerate-id
    rax skills list --agent research-bot
`.trimEnd();

export async function runSkills(argv: readonly string[]): Promise<void> {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    return;
  }
  const { positional, flags } = parseFlags(argv.slice(1));

  switch (subcommand) {
    case "export":
      await runExport(flags);
      return;
    case "import":
      await runImport(positional, flags);
      return;
    case "list":
      await runList(flags);
      return;
    default:
      console.error(fail(`Unknown skills subcommand: ${subcommand}`));
      console.log(HELP);
      process.exit(1);
  }
}

async function runExport(flags: Flags): Promise<void> {
  if (!flags.agent) {
    console.error(fail("--agent <id> is required"));
    process.exit(1);
  }
  const dbPath = resolveDbPath(flags.agent, flags.dbPath);
  if (!fs.existsSync(dbPath)) {
    console.error(fail(`Memory DB not found at ${dbPath}`));
    process.exit(1);
  }

  const layer = layerFor(flags.agent, dbPath);

  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const store = yield* SkillStoreService;
          const all = yield* store.listAll(flags.agent!);
          const filtered = flags.name
            ? all.filter((s) => s.name === flags.name)
            : all;

          if (filtered.length === 0) {
            yield* Effect.sync(() => {
              console.error(fail(`No skills found for agent ${flags.agent}${flags.name ? ` matching name ${flags.name}` : ""}`));
              process.exit(1);
            });
            return;
          }

          if (flags.out) {
            const target = path.resolve(flags.out);
            const isDir = filtered.length > 1 || target.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory());
            if (isDir) {
              if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
              for (const skill of filtered) {
                const filename = path.join(target, `${sanitize(skill.name)}.SKILL.md`);
                fs.writeFileSync(filename, exportSkillToMarkdown(skill));
                yield* Effect.sync(() => console.log(info(`Wrote ${filename}`)));
              }
            } else {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, exportSkillToMarkdown(filtered[0]!));
              yield* Effect.sync(() => console.log(info(`Wrote ${target}`)));
            }
          } else {
            for (const skill of filtered) {
              yield* Effect.sync(() => console.log(exportSkillToMarkdown(skill)));
              yield* Effect.sync(() => console.log("\n---\n"));
            }
          }
        }),
        layer,
      ),
    ),
  );
}

async function runImport(positional: string[], flags: Flags): Promise<void> {
  const file = positional[0];
  if (!file) {
    console.error(fail("Usage: rax skills import <file> --agent <id>"));
    process.exit(1);
  }
  if (!flags.agent) {
    console.error(fail("--agent <id> is required"));
    process.exit(1);
  }
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    console.error(fail(`File not found: ${resolved}`));
    process.exit(1);
  }

  const dbPath = resolveDbPath(flags.agent, flags.dbPath);
  const layer = layerFor(flags.agent, dbPath);
  const md = fs.readFileSync(resolved, "utf8");

  const overrides: SkillImportOverrides = {};
  if (flags.rebind) overrides.agentId = flags.rebind;
  else overrides.agentId = flags.agent;
  if (flags.regenerateId) overrides.id = "regenerate";

  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const store = yield* SkillStoreService;
          const skill = importSkillFromMarkdown(md, overrides);
          yield* store.store(skill);
          yield* Effect.sync(() => console.log(info(`Imported skill ${skill.name} (id=${skill.id}, agent=${skill.agentId})`)));
        }),
        layer,
      ),
    ),
  );
}

async function runList(flags: Flags): Promise<void> {
  if (!flags.agent) {
    console.error(fail("--agent <id> is required"));
    process.exit(1);
  }
  const dbPath = resolveDbPath(flags.agent, flags.dbPath);
  if (!fs.existsSync(dbPath)) {
    console.log(info(`No memory DB at ${dbPath} (agent has no skills yet)`));
    return;
  }
  const layer = layerFor(flags.agent, dbPath);

  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const store = yield* SkillStoreService;
          const all = yield* store.listAll(flags.agent!);
          if (all.length === 0) {
            yield* Effect.sync(() => console.log(info(`No skills found for agent ${flags.agent}`)));
            return;
          }
          yield* Effect.sync(() => {
            for (const s of all) {
              const pct = (s.successRate * 100).toFixed(1);
              console.log(
                `  ${s.name.padEnd(32)} v${s.version}  ${s.confidence.padEnd(9)} ${pct}%  uses=${s.useCount}  [${s.taskCategories.join(", ")}]`,
              );
            }
          });
        }),
        layer,
      ),
    ),
  );
}

const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9_-]+/g, "_");
