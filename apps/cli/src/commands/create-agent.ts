import { generateAgent, type AgentRecipe } from "../generators/agent-generator.js";

const VALID_RECIPES: AgentRecipe[] = ["basic", "researcher", "coder", "orchestrator"];

export function runCreateAgent(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error("Usage: reactive-agents create agent <name> [--recipe basic|researcher|coder|orchestrator]");
    process.exit(1);
  }

  let recipe: AgentRecipe = "basic";
  const recipeIdx = args.indexOf("--recipe");
  if (recipeIdx !== -1 && args[recipeIdx + 1]) {
    const r = args[recipeIdx + 1] as AgentRecipe;
    if (!VALID_RECIPES.includes(r)) {
      console.error(`Invalid recipe: ${r}. Valid options: ${VALID_RECIPES.join(", ")}`);
      process.exit(1);
    }
    recipe = r;
  }

  console.log(`Creating agent "${name}" with recipe "${recipe}"...`);

  const result = generateAgent({
    name,
    recipe,
    targetDir: process.cwd(),
  });

  console.log(`Created: ${result.filePath}`);
}
