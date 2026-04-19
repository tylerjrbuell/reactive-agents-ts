import type { Scenario } from "../types.js"

export const schemaDriftSql: Scenario = {
  id: "schema-drift-sql",
  description: "Agent must adapt when SQL schema changes between iterations",
  task: "Write a SQL query to get all users created in the last 7 days from a `users` table with columns: id, email, created_at.",
  tags: ["schema-drift"],
  expectedFailureWithoutRI: "hallucinated-args",
  successCriteria: (output) => /SELECT|select/i.test(output) && /created_at/i.test(output),
  preferredModels: ["claude-haiku-4-5"],
}
