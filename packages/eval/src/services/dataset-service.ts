import { Context, Effect, Layer, Schema } from "effect";
import { EvalSuiteSchema, type EvalSuite } from "../types/eval-case.js";
import { DatasetError } from "../errors/errors.js";

export class DatasetService extends Context.Tag("DatasetService")<
  DatasetService,
  {
    /**
     * Load an eval suite from a JSON file.
     * Validates the schema and returns a typed EvalSuite.
     */
    readonly loadSuite: (path: string) => Effect.Effect<EvalSuite, DatasetError>;

    /**
     * Load all suites from a directory (*.json files).
     */
    readonly loadSuitesFromDir: (
      dirPath: string,
    ) => Effect.Effect<readonly EvalSuite[], DatasetError>;

    /**
     * Create an in-memory suite (for programmatic use in tests).
     */
    readonly createSuite: (suite: EvalSuite) => Effect.Effect<EvalSuite>;
  }
>() {}

const parseSuiteJson = (json: unknown, path: string): Effect.Effect<EvalSuite, DatasetError> =>
  Schema.decodeUnknown(EvalSuiteSchema)(json).pipe(
    Effect.mapError(
      (err) =>
        new DatasetError({
          message: `Invalid suite schema at ${path}: ${String(err)}`,
          path,
          cause: err,
        }),
    ),
  );

export const DatasetServiceLive = Layer.succeed(
  DatasetService,
  {
    loadSuite: (path) =>
      Effect.tryPromise({
        try: async () => {
          const content = await Bun.file(path).text();
          return JSON.parse(content) as unknown;
        },
        catch: (err) =>
          new DatasetError({
            message: `Failed to read suite file: ${String(err)}`,
            path,
            cause: err,
          }),
      }).pipe(Effect.flatMap((json) => parseSuiteJson(json, path))),

    loadSuitesFromDir: (dirPath) =>
      Effect.tryPromise({
        try: async () => {
          const glob = new Bun.Glob("*.json");
          const files: string[] = [];
          for await (const file of glob.scan(dirPath)) {
            files.push(`${dirPath}/${file}`);
          }
          return files;
        },
        catch: (err) =>
          new DatasetError({
            message: `Failed to scan directory ${dirPath}: ${String(err)}`,
            path: dirPath,
            cause: err,
          }),
      }).pipe(
        Effect.flatMap((files) =>
          Effect.all(
            files.map((f) =>
              Effect.tryPromise({
                try: async () => JSON.parse(await Bun.file(f).text()) as unknown,
                catch: (err) =>
                  new DatasetError({ message: `Failed to read ${f}: ${String(err)}`, path: f, cause: err }),
              }).pipe(Effect.flatMap((json) => parseSuiteJson(json, f))),
            ),
            { concurrency: 4 },
          ),
        ),
      ),

    createSuite: (suite) => Effect.succeed(suite),
  },
);
