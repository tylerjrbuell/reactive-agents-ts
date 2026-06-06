// apps/advocate/src/grounding/astroturf.ts
const BANNED = [
  "you should use reactive-agents",
  "check out reactive-agents",
  "game-changer",
  "game changer",
  "revolutionary",
  "best framework",
  "must-try",
];

/** Heuristic anti-astroturf checks. Empty array = clean. */
export const astroturfIssues = (text: string): string[] => {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 0).length;
  const issues: string[] = [];

  for (const phrase of BANNED) {
    if (lower.includes(phrase)) issues.push(`banned promotional phrase: "${phrase}"`);
  }

  const mentions = (lower.match(/reactive-agents/g) ?? []).length;
  if (words > 0 && mentions / words > 0.05) issues.push("over-promotional: too many self-mentions");

  const firstMention = lower.indexOf("reactive-agents");
  if (firstMention >= 0 && firstMention < 60) issues.push("leads with promotion (mention before value)");

  return issues;
};
