/**
 * τ-bench loader — knows the UPSTREAM format, and nothing about RA.
 *
 * The split with `adapter.ts` is deliberate: this file changes when upstream's
 * schema moves, the adapter changes when RA's builder moves, and neither should
 * drag the other along.
 *
 * Everything read here was vendored VERBATIM from sierra-research/tau-bench at
 * the pinned commit below (see `vendor/fetch-vendor.py`). τ-bench earns its
 * place as an external credibility gate only by being third-party; a task set
 * authored in this repo would be a self-built bench wearing a borrowed name,
 * which this project has already ruled out as a basis for public claims. So
 * this file parses and validates — it never supplies content.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Provenance of every byte under `vendor/`. Cite this next to any score. */
export const TAU_BENCH_PROVENANCE = {
  repo: "sierra-research/tau-bench",
  sha: "59a200c6d575d595120f1cb70fea53cef0632f6b",
  license: "MIT (Copyright (c) 2024 Sierra)",
  split: "tasks_test.py (the TEST split, as reported in the τ-bench paper)",
} as const;

export const TAU_BENCH_DOMAINS = ["retail", "airline"] as const;
export type TauBenchDomain = (typeof TAU_BENCH_DOMAINS)[number];

export const isTauBenchDomain = (value: string): value is TauBenchDomain =>
  (TAU_BENCH_DOMAINS as readonly string[]).includes(value);

/** One ground-truth action: upstream `Action(name=..., kwargs={...})`. */
export interface TauBenchAction {
  readonly name: string;
  readonly kwargs: Readonly<Record<string, unknown>>;
}

/**
 * One upstream task.
 *
 * `index` is not an upstream field — it is the task's position in
 * `tasks_test.py`, which is how upstream itself addresses tasks (`--task-ids`).
 * Reporting it keeps a score traceable to a specific upstream row.
 */
export interface TauBenchTask {
  readonly domain: TauBenchDomain;
  readonly index: number;
  readonly userId: string;
  readonly instruction: string;
  readonly actions: readonly TauBenchAction[];
  readonly outputs: readonly string[];
  readonly annotator?: string;
}

/** A JSON-Schema fragment exactly as upstream wrote it in `get_info()`. */
export interface TauBenchJsonSchema {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, TauBenchJsonSchema>>;
  readonly items?: TauBenchJsonSchema;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
}

/** Upstream tool declaration (OpenAI function-calling shape). */
export interface TauBenchToolSchema {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: TauBenchJsonSchema;
  };
}

export interface TauBenchDomainSpec {
  readonly domain: TauBenchDomain;
  /** `wiki.md` verbatim — the domain policy the simulated user holds the agent to. */
  readonly policy: string;
  readonly tools: readonly TauBenchToolSchema[];
  readonly tasks: readonly TauBenchTask[];
  readonly provenance: typeof TAU_BENCH_PROVENANCE;
}

const VENDOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), "vendor");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readJson = (path: string): unknown => {
  if (!existsSync(path)) {
    throw new Error(
      `Vendored τ-bench file missing: ${path}\n` +
        `Re-vendor it with: python3 packages/benchmarks/src/tau-bench/vendor/fetch-vendor.py`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
};

const parseAction = (value: unknown, where: string): TauBenchAction => {
  if (!isRecord(value)) throw new Error(`${where}: action is not an object`);
  const { name, kwargs } = value;
  if (typeof name !== "string") throw new Error(`${where}: action.name is not a string`);
  if (!isRecord(kwargs)) throw new Error(`${where}: action.kwargs is not an object`);
  return { name, kwargs };
};

const parseTask = (value: unknown, domain: TauBenchDomain, index: number): TauBenchTask => {
  const where = `${domain}[${index}]`;
  if (!isRecord(value)) throw new Error(`${where}: task is not an object`);
  const { user_id: userId, instruction, actions, outputs, annotator } = value;
  if (typeof userId !== "string") throw new Error(`${where}: user_id is not a string`);
  if (typeof instruction !== "string") throw new Error(`${where}: instruction is not a string`);
  if (!Array.isArray(actions)) throw new Error(`${where}: actions is not an array`);
  if (!isStringArray(outputs)) throw new Error(`${where}: outputs is not a string array`);
  return {
    domain,
    index,
    userId,
    instruction,
    actions: actions.map((action, i) => parseAction(action, `${where}.actions[${i}]`)),
    outputs,
    ...(typeof annotator === "string" ? { annotator } : {}),
  };
};

/**
 * Structural parse of upstream's JSON-Schema fragments.
 *
 * Unknown keywords are DROPPED rather than passed through as `unknown`, because
 * the adapter has to translate this into RA's flatter parameter shape and a
 * keyword it cannot see is a keyword it cannot report as lost.
 */
const parseJsonSchema = (value: unknown, where: string): TauBenchJsonSchema => {
  if (!isRecord(value)) throw new Error(`${where}: schema is not an object`);
  const { type, description, properties, items, required, enum: enumValues } = value;
  const parsedProperties: Record<string, TauBenchJsonSchema> = {};
  if (isRecord(properties)) {
    for (const [key, property] of Object.entries(properties)) {
      parsedProperties[key] = parseJsonSchema(property, `${where}.${key}`);
    }
  }
  return {
    ...(typeof type === "string" ? { type } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(isRecord(properties) ? { properties: parsedProperties } : {}),
    ...(items !== undefined ? { items: parseJsonSchema(items, `${where}.items`) } : {}),
    ...(isStringArray(required) ? { required } : {}),
    ...(isStringArray(enumValues) ? { enum: enumValues } : {}),
  };
};

const parseToolSchema = (value: unknown, where: string): TauBenchToolSchema => {
  if (!isRecord(value)) throw new Error(`${where}: tool is not an object`);
  if (value["type"] !== "function") throw new Error(`${where}: tool.type is not "function"`);
  const fn = value["function"];
  if (!isRecord(fn)) throw new Error(`${where}: tool.function is not an object`);
  const { name, description, parameters } = fn;
  if (typeof name !== "string") throw new Error(`${where}: function.name is not a string`);
  if (typeof description !== "string") throw new Error(`${where}: function.description is not a string`);
  return {
    type: "function",
    function: { name, description, parameters: parseJsonSchema(parameters, `${where}.parameters`) },
  };
};

/** Load one vendored domain: policy, tool declarations and the TEST task split. */
export const loadDomain = (domain: TauBenchDomain): TauBenchDomainSpec => {
  const root = join(VENDOR_ROOT, domain);
  const policyPath = join(root, "wiki.md");
  if (!existsSync(policyPath)) {
    throw new Error(
      `Vendored τ-bench policy missing: ${policyPath}\n` +
        `Re-vendor it with: python3 packages/benchmarks/src/tau-bench/vendor/fetch-vendor.py`,
    );
  }
  const rawTasks = readJson(join(root, "tasks-test.json"));
  const rawTools = readJson(join(root, "tools.json"));
  if (!Array.isArray(rawTasks)) throw new Error(`${domain}: tasks-test.json is not an array`);
  if (!Array.isArray(rawTools)) throw new Error(`${domain}: tools.json is not an array`);
  return {
    domain,
    policy: readFileSync(policyPath, "utf-8"),
    tools: rawTools.map((tool, i) => parseToolSchema(tool, `${domain}.tools[${i}]`)),
    tasks: rawTasks.map((task, i) => parseTask(task, domain, i)),
    provenance: TAU_BENCH_PROVENANCE,
  };
};

/**
 * Load a domain's databases (orders/products/users, flights/reservations/users).
 *
 * These are ~7.3 MB and are fetched rather than committed; `data-checksums.txt`
 * pins their SHA-256 so a run is still reproducible against exact upstream bytes.
 * Throws with the fetch command rather than returning an empty database, since a
 * silently-empty world would score as "the agent failed the task".
 */
export const loadDomainDatabase = (
  domain: TauBenchDomain,
): Readonly<Record<string, unknown>> => {
  const files =
    domain === "retail"
      ? ["orders.json", "products.json", "users.json"]
      : ["flights.json", "reservations.json", "users.json"];
  const database: Record<string, unknown> = {};
  for (const file of files) {
    const path = join(VENDOR_ROOT, "data", domain, file);
    if (!existsSync(path)) {
      throw new Error(
        `τ-bench ${domain} database not fetched: ${path}\n` +
          `The databases are pinned by checksum, not committed (~7.3 MB). Fetch with:\n` +
          `  python3 packages/benchmarks/src/tau-bench/vendor/fetch-vendor.py`,
      );
    }
    database[file.replace(/\.json$/, "")] = readJson(path);
  }
  return database;
};
