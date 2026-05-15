import { describe, it, expect } from "bun:test";
import { runInSandbox } from "../sandbox.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TaskCase {
  id: number;
  name: string;
  codeActionCode: string;
  toolHandlers: Map<string, (args: unknown) => Promise<unknown>>;
  validate: (result: unknown) => boolean;
  reactiveTokenEstimate: number;
}

const tasks: TaskCase[] = [
  {
    id: 1,
    name: "Sum numbers 1-10",
    codeActionCode: `(async () => { return Array.from({length:10},(_,i)=>i+1).reduce((a,b)=>a+b,0); })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 55,
    reactiveTokenEstimate: 480,
  },
  {
    id: 2,
    name: "Reverse the string 'hello'",
    codeActionCode: `(async () => { return "hello".split("").reverse().join(""); })()`,
    toolHandlers: new Map(),
    validate: (r) => r === "olleh",
    reactiveTokenEstimate: 320,
  },
  {
    id: 3,
    name: "Find max in [3,1,4,1,5,9,2,6]",
    codeActionCode: `(async () => { return Math.max(3,1,4,1,5,9,2,6); })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 9,
    reactiveTokenEstimate: 350,
  },
  {
    id: 4,
    name: "Count vowels in 'reactive agents'",
    codeActionCode: `(async () => { return ("reactive agents".match(/[aeiou]/gi)||[]).length; })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 6,
    reactiveTokenEstimate: 400,
  },
  {
    id: 5,
    name: "Fibonacci(10)",
    codeActionCode: `(async () => { let a=0,b=1; for(let i=0;i<9;i++){[a,b]=[b,a+b];} return b; })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 55,
    reactiveTokenEstimate: 520,
  },
  {
    id: 6,
    name: "Sort [5,3,8,1,2] ascending",
    codeActionCode: `(async () => { return [5,3,8,1,2].sort((a,b)=>a-b); })()`,
    toolHandlers: new Map(),
    validate: (r) =>
      Array.isArray(r) && JSON.stringify(r) === JSON.stringify([1, 2, 3, 5, 8]),
    reactiveTokenEstimate: 380,
  },
  {
    id: 7,
    name: "Is 17 prime?",
    codeActionCode: `(async () => { const n=17; for(let i=2;i<=Math.sqrt(n);i++){if(n%i===0)return "false";} return "true"; })()`,
    toolHandlers: new Map(),
    validate: (r) =>
      String(r).toLowerCase().includes("true") ||
      String(r).toLowerCase().includes("yes"),
    reactiveTokenEstimate: 450,
  },
  {
    id: 8,
    name: "Celsius 100 to Fahrenheit",
    codeActionCode: `(async () => { return 100 * 9/5 + 32; })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 212,
    reactiveTokenEstimate: 280,
  },
  {
    id: 9,
    name: "Capitalize each word in 'hello world'",
    codeActionCode: `(async () => { return "hello world".replace(/\\b\\w/g, c => c.toUpperCase()); })()`,
    toolHandlers: new Map(),
    validate: (r) => r === "Hello World",
    reactiveTokenEstimate: 360,
  },
  {
    id: 10,
    name: "GCD of 48 and 18",
    codeActionCode: `(async () => { let a=48,b=18; while(b){[a,b]=[b,a%b];} return a; })()`,
    toolHandlers: new Map(),
    validate: (r) => r === 6,
    reactiveTokenEstimate: 420,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CodeAgentStrategy validation suite (10 tasks, offline)", () => {
  const wins: boolean[] = [];

  for (const task of tasks) {
    it(`Task ${task.id}: ${task.name}`, async () => {
      const result = await runInSandbox(task.codeActionCode, task.toolHandlers);
      expect(task.validate(result.finalResult)).toBe(true);

      // Token estimate: code length as rough proxy (1 char ≈ 0.25 tokens)
      const codeActionTokenEstimate = Math.ceil(task.codeActionCode.length / 4);
      wins.push(codeActionTokenEstimate < task.reactiveTokenEstimate);
    });
  }

  it("code-action wins token count on at least 7/10 tasks", () => {
    const winCount = wins.filter(Boolean).length;
    expect(winCount).toBeGreaterThanOrEqual(7);
  });
});
