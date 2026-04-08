import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { parseSKILLmd, parseSkillMarkdownLoose } from "@reactive-agents/reactive-intelligence";
import { CortexStoreService } from "../services/store-service.js";
import { discoverSkillDirectoryPaths } from "../services/skill-directories.js";
import {
  listFilesystemSkillSummaries,
  resolveFilesystemSkillMd,
} from "../services/skill-filesystem.js";

/** JSON shape returned to Cortex UI (serializable {@link InstalledSkill}). */
type SkillDetailJson = {
  name: string;
  description: string;
  instructions: string;
  metadata: Record<string, unknown>;
  filePath: string;
  resources: { scripts: string[]; references: string[]; assets: string[] };
  declaredFields?: Record<string, unknown>;
};

export const skillsRouter = (
  storeLayer: Layer.Layer<CortexStoreService>,
  db: Database,
) =>
  new Elysia({ prefix: "/api/skills" })
    .get("/discover", () => ({ paths: discoverSkillDirectoryPaths() }))
    .get("/files", () => ({ skills: listFilesystemSkillSummaries() }))
    .get(
      "/file",
      ({ query, set }) => {
        const rel = typeof query.path === "string" ? query.path : "";
        const abs = resolveFilesystemSkillMd(rel);
        if (!abs) {
          set.status = 400;
          return { error: "Invalid or disallowed SKILL.md path" };
        }
        const skill = parseSKILLmd(abs);
        if (!skill) {
          set.status = 404;
          return { error: "SKILL.md could not be parsed (open-skill YAML required)" };
        }
        return skill as SkillDetailJson;
      },
      { query: t.Object({ path: t.String() }) },
    )
    .get(
      "/sqlite/:id",
      ({ params, set }) => {
        const id = params.id;
        try {
          const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as
            | Record<string, unknown>
            | undefined;
          if (!row) {
            set.status = 404;
            return { error: "Skill row not found" };
          }
          const content = typeof row.content === "string" ? row.content : "";
          const name = String(row.name ?? "skill");
          const desc = typeof row.description === "string" ? row.description : "";
          const skill = parseSkillMarkdownLoose(content, `sqlite:${id}`, {
            name,
            description: desc,
          });
          return skill as SkillDetailJson;
        } catch {
          set.status = 500;
          return { error: "skills table unavailable" };
        }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getSkills();
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .post(
      "/",
      ({ body, set }) => {
        try {
          const { name, instructions, description, tags } = body as Record<string, unknown>;

          // Validate required fields
          if (typeof name !== "string" || !name.trim()) {
            set.status = 400;
            return { error: "name is required and must be non-empty" };
          }
          if (typeof instructions !== "string" || !instructions.trim()) {
            set.status = 400;
            return { error: "instructions is required and must be non-empty" };
          }

          const desc = typeof description === "string" ? description.trim() : "";
          const tagsArray = Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : [];

          // Insert into skills table
          const result = db.prepare(
            "INSERT INTO skills (name, description, content, created_at) VALUES (?, ?, ?, ?)"
          ).run(
            name.trim(),
            desc,
            instructions.trim(),
            Date.now()
          );

          const insertedId = result.lastInsertRowid;

          set.status = 201;
          return {
            id: insertedId,
            name: name.trim(),
            description: desc,
            instructions: instructions.trim(),
            tags: tagsArray,
          };
        } catch (e) {
          set.status = 500;
          return { error: `Failed to create skill: ${String(e)}` };
        }
      },
      {
        body: t.Object({
          name: t.String(),
          instructions: t.String(),
          description: t.Optional(t.String()),
          tags: t.Optional(t.Array(t.String())),
        }),
      },
    )
    .delete(
      "/:id",
      ({ params, set }) => {
        try {
          const id = params.id;

          // Check if skill exists
          const existing = db.prepare("SELECT id FROM skills WHERE id = ?").get(id);
          if (!existing) {
            set.status = 404;
            return { error: "Skill not found" };
          }

          // Delete the skill
          db.prepare("DELETE FROM skills WHERE id = ?").run(id);

          set.status = 200;
          return { ok: true, message: `Skill deleted` };
        } catch (e) {
          set.status = 500;
          return { error: `Failed to delete skill: ${String(e)}` };
        }
      },
      { params: t.Object({ id: t.String() }) },
    );
