import * as readline from "node:readline";
import { generateAgent, type AgentRecipe } from "../generators/agent-generator.js";
import { fail, info, section, success } from "../ui.js";

const VALID_RECIPES: AgentRecipe[] = ["basic", "researcher", "coder", "orchestrator"];
const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini"];

async function promptUser(
  question: string,
  defaultVal: string,
  choices?: string[],
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const choiceStr = choices ? ` [${choices.join("/")}]` : "";
    const defaultStr = defaultVal ? ` (${defaultVal})` : "";
    rl.question(`${question}${choiceStr}${defaultStr}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function runCreateAgent(args: string[]): Promise<void> {
  // Check if interactive mode is enabled
  const isInteractive = args.includes("--interactive") && Boolean(process.stdin.isTTY);

  if (isInteractive) {
    // Remove --interactive flag from args
    const filteredArgs = args.filter((arg) => arg !== "--interactive");
    const defaultName = filteredArgs[0] ?? "my-agent";

    console.log(section("Create Agent (Interactive)"));

    const name = await promptUser("Agent name", defaultName);
    const provider = await promptUser("Provider", "anthropic", VALID_PROVIDERS);
    const recipe = await promptUser("Recipe", "basic", VALID_RECIPES);
    const featuresStr = await promptUser("Features (comma-separated)", "reasoning,tools");
    const features = featuresStr.split(",").map((f: string) => f.trim()).filter(Boolean);

    args = [name, "--recipe", recipe, "--provider", provider, "--features", features.join(",")];

    console.log(info(`Creating agent "${name}" with recipe "${recipe}" and provider "${provider}"...`));

    const result = generateAgent({
      name,
      recipe: recipe as AgentRecipe,
      targetDir: process.cwd(),
    });

    console.log(success(`Created: ${result.filePath}`));
    return;
  }

  // Non-interactive mode
  const name = args[0];
  if (!name) {
    console.error(fail("Usage: rax create agent <name> [--recipe basic|researcher|coder|orchestrator]"));
    process.exit(1);
  }

  let recipe: AgentRecipe = "basic";
  const recipeIdx = args.indexOf("--recipe");
  if (recipeIdx !== -1 && args[recipeIdx + 1]) {
    const r = args[recipeIdx + 1] as AgentRecipe;
    if (!VALID_RECIPES.includes(r)) {
      console.error(fail(`Invalid recipe: ${r}. Valid options: ${VALID_RECIPES.join(", ")}`));
      process.exit(1);
    }
    recipe = r;
  }

  console.log(section("Create Agent"));
  console.log(info(`Creating agent "${name}" with recipe "${recipe}"...`));

  const result = generateAgent({
    name,
    recipe,
    targetDir: process.cwd(),
  });

  console.log(success(`Created: ${result.filePath}`));
}
