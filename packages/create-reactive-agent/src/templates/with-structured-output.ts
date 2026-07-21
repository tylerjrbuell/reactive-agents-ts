import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar, providerRuntimeName } from "../lib/provider-config.js";

export const withStructuredOutputTemplate: Template = {
  name: "with-structured-output",
  description: "Typed structured output — declare a schema, read result.object.",
  extraDependencies: { effect: "^3.10.0" },
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);
  const envVar = providerEnvVar(opts.provider);
  const envCheck = envVar
    ? `if (!process.env.${envVar}) {
  console.error("Missing ${envVar} in environment. See .env.example.");
  process.exit(1);
}`
    : `// Ollama is local — no API key required.`;

  return `import { ReactiveAgents } from "reactive-agents";
import { Schema } from "effect";

${envCheck}

// Declare the shape you want back. Any Effect Schema (or Standard Schema, e.g.
// a Zod schema) works. The agent is nudged to emit conforming JSON, which is
// parsed and validated into a typed \`result.object\`.
const CityFact = Schema.Struct({
  city: Schema.String,
  country: Schema.String,
  population: Schema.Number,
  funFact: Schema.String,
});

const agent = await ReactiveAgents.create()
  .withName("structured-assistant")
  .withProvider("${providerRuntimeName(opts.provider)}")
  .withModel("${model}")
  .withOutputSchema(CityFact)
  .withMaxIterations(3)
  .build();

const question = process.argv.slice(2).join(" ") || "Tell me about Paris, France.";

console.log(\`> \${question}\\n\`);

const result = await agent.run(question);

if (result.object) {
  // result.object is fully typed as { city, country, population, funFact }.
  console.log("Typed object:", result.object);
  console.log(\`\${result.object.city}, \${result.object.country} — pop. \${result.object.population}\`);
  console.log(\`Fun fact: \${result.object.funFact}\`);
} else {
  console.error("Schema parse failed:", result.objectError);
  console.log("Raw output:\\n" + result.output);
}
`;
}
