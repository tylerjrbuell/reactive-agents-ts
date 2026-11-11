import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { parseSKILLmd, parseSkillMarkdownLoose } from "@reactive-agents/reactive-intelligence";
import { CortexStoreService } from "../services/store-service.js";
import { discoverSkillDirectoryPaths } from "../services/skill-directories.js";
import { chatSessionSkillListing, listWorkspaceSkills, type WorkspaceSkillScope } from "../services/workspace-skills.js";
import { checkWorkspaceDir } from "../services/workspace-dir.js";
import { getChatSession } from "../db/chat-queries.js";
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

/** Query of the workspace skill routes: discovery root, extra dirs, user-global dirs. */
const WorkspaceScopeQuery = t.Object({
  root: t.Optional(t.String()),
  paths: t.Optional(t.Union([t.String(), t.Array(t.String())])),
  global: t.Optional(t.String()),
});

/** The discovery scope a query names; an error when `root` is not an absolute existing dir. */
function workspaceScopeOf(query: {
  readonly root?: string;
  readonly paths?: string | string[];
  readonly global?: string;
}): WorkspaceSkillScope | { readonly error: string } {
  const raw = typeof query.root === "string" ? query.root.trim() : "";
  const checked = raw === "" ? { ok: true as const, path: process.cwd() } : checkWorkspaceDir(raw);
  if (!checked.ok) return { error: checked.error };
  const paths = query.paths === undefined ? [] : Array.isArray(query.paths) ? query.paths : [query.paths];
  return {
    root: checked.path,
    paths: paths.filter((p) => p.trim() !== ""),
    global: query.global === "1" || query.global === "true",
  };
}

export const skillsRouter = (
  storeLayer: Layer.Layer<CortexStoreService>,
  db: Database,
) =>
  new Elysia({ prefix: "/api/skills" })
    .get("/discover", () => ({ paths: discoverSkillDirectoryPaths() }))
    // Skills a chat session's agent can load: framework discovery at the session's workspace
    // (else the server cwd) with its skills config. What the chat lists is what the agent sees.
    .get(
      "/session/:sessionId",
      ({ params, set }) => {
        const session = getChatSession(db, params.sessionId);
        if (!session) {
          set.status = 404;
          return { error: "Chat session not found" };
        }
        return chatSessionSkillListing(session);
      },
      { params: t.Object({ sessionId: t.String() }) },
    )
    // Skills an agent rooted at `root` (absolute dir; default the server cwd) can load, plus
    // configured `paths` (repeatable) and the user-global dirs with `global=1`. Lab Skills tab.
    .get(
      "/workspace",
      ({ query, set }) => {
        const scope = workspaceScopeOf(query);
        if ("error" in scope) {
          set.status = 400;
          return { error: scope.error };
        }
        return listWorkspaceSkills(scope);
      },
      { query: WorkspaceScopeQuery },
    )
    // One workspace skill's document. `path` must be a SKILL.md that discovery found for this
    // scope, so the route never reads an arbitrary file.
    .get(
      "/workspace/file",
      ({ query, set }) => {
        const scope = workspaceScopeOf(query);
        if ("error" in scope) {
          set.status = 400;
          return { error: scope.error };
        }
        const found = listWorkspaceSkills(scope).skills.find((s) => s.filePath === query.path);
        const skill = found ? parseSKILLmd(found.filePath) : null;
        if (!skill) {
          set.status = 404;
          return { error: "Skill not found in this workspace" };
        }
        return skill as SkillDetailJson;
      },
      { query: t.Object({ ...WorkspaceScopeQuery.properties, path: t.String() }) },
    )
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
