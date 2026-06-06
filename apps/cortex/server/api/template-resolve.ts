import { Elysia, t } from "elysia";
import { resolveTemplate, type VariableDef } from "../services/resolve-template.js";

/** Live-preview endpoint: the UI delegates to the one server resolver. */
export const templateResolveRouter = () =>
  new Elysia({ prefix: "/api/template" }).post(
    "/resolve",
    ({ body }) => {
      const b = body as {
        payload: unknown;
        variables?: VariableDef[];
        values?: Record<string, string | number>;
      };
      const { value, unresolved } = resolveTemplate(
        b.payload,
        b.variables ?? [],
        b.values ?? {},
      );
      return { resolved: value, unresolved };
    },
    {
      body: t.Object({
        payload: t.Unknown(),
        variables: t.Optional(t.Array(t.Unknown())),
        values: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
      }),
    },
  );
