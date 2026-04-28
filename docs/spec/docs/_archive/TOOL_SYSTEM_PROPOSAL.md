> **Status:** archived 2026-04-28; pre-overhaul. See `PROJECT-STATE.md` and `AUDIT-overhaul-2026.md` for current architecture and package state.

# Reactive Agents Tool System: Beyond Bash and MCP

## The Problem with Current Tool Approaches

### Approach 1: "Just Use Bash" 🤦

```typescript
// What people suggest:
const result = await agent.useTool("bash", "curl https://api.example.com");

// Problems:
❌ No type safety (returns string, parse yourself)
❌ No sandboxing (full system access)
❌ No validation (command could be malicious)
❌ No composability (string manipulation hell)
❌ No observability (what actually happened?)
❌ No retry logic (fails are permanent)
❌ No semantic caching (same command = new execution)
❌ No learning (scouts can't optimize)
```

### Approach 2: MCP Servers

```typescript
// MCP approach:
const mcp = await MCPClient.connect("https://mcp.example.com");
const result = await mcp.callTool("get_weather", { city: "SF" });

// Better, but:
⚠️ Network dependent (latency, failures)
⚠️ No local-first fallback
⚠️ Limited type safety (JSON schema only)
⚠️ No built-in learning (scouts can't optimize)
⚠️ No composition (tools are isolated)
⚠️ No behavioral contracts (tools can do anything)
```

### Approach 3: Python Functions (LangChain)

```python
# LangChain approach:
@tool
def get_weather(city: str) -> str:
    return requests.get(f"https://api.weather.com/{city}").text

# Problems:
❌ Runtime type errors (Python)
❌ Poor async support
❌ No Effect-style error handling
❌ Hard to test in isolation
❌ No sandboxing
❌ No composability
```

---

## Our Solution: Effect-First, Scout-Optimized Tool System

### Core Philosophy

```typescript
// Every tool is an Effect operation
type Tool<I, O, E = never> = Effect.Effect<O, E, ToolRuntime>;

// Benefits:
✅ Typed inputs and outputs (compile-time safety)
✅ Typed errors (no surprises)
✅ Composable (build complex from simple)
✅ Observable (OpenTelemetry built-in)
✅ Testable (pure functions)
✅ Scout-optimizable (learnable)
✅ Sandboxable (isolated execution)
✅ Cacheable (semantic caching)
✅ Retryable (automatic retry logic)
```

---

## Tool Architecture: Five Layers

```
┌─────────────────────────────────────┐
│  Layer 5: TOOL MARKETPLACE          │
│  (Community tools, verified)        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 4: TOOL COMPOSITION          │
│  (Build complex from simple)        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 3: TOOL ORCHESTRATION        │
│  (Scout-optimized execution)        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 2: TOOL RUNTIME              │
│  (Sandbox, observe, cache)          │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Layer 1: TOOL PRIMITIVES           │
│  (HTTP, FS, Bash, DB, etc.)         │
└─────────────────────────────────────┘
```

---

## Layer 1: Type-Safe Tool Primitives

### HTTP Tool (Example)

```typescript
import { Effect, Schema } from "effect";
import { z } from "zod";

// Define tool with full type safety
const HTTPGetTool = Tool.create({
  name: "http.get",
  description: "Make HTTP GET request",
  
  // Zod schema for input validation
  input: z.object({
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().default(30000),
  }),
  
  // Zod schema for output validation
  output: z.object({
    status: z.number(),
    headers: z.record(z.string()),
    body: z.string(),
    latency: z.number(),
  }),
  
  // Typed errors
  errors: [
    NetworkError,
    TimeoutError,
    InvalidURLError,
    RateLimitError
  ],
  
  // Behavioral contract (what this tool can/can't do)
  contract: {
    sideEffects: ["network"],
    isolation: "sandbox",
    maxDuration: "30s",
    retryable: true,
    idempotent: true,
  },
  
  // Implementation as Effect
  execute: (input) => Effect.gen(function* (_) {
    const startTime = Date.now();
    
    // Tracing built-in
    yield* _(Effect.annotateCurrentSpan({
      "tool.name": "http.get",
      "http.url": input.url,
    }));
    
    // Actual HTTP call with timeout
    const response = yield* _(
      Effect.tryPromise({
        try: () => fetch(input.url, {
          headers: input.headers,
          signal: AbortSignal.timeout(input.timeout),
        }),
        catch: (error) => new NetworkError({ cause: error }),
      })
    );
    
    // Validate response
    if (!response.ok) {
      yield* _(Effect.fail(new HTTPError({
        status: response.status,
        message: response.statusText,
      })));
    }
    
    const body = yield* _(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => new ParseError({ cause: error }),
      })
    );
    
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
      latency: Date.now() - startTime,
    };
  }),
});

// Usage (fully typed, no casts needed)
const result = await HTTPGetTool.run({
  url: "https://api.github.com/repos/reactive/agents",
  headers: { "Authorization": "token xyz" },
});

console.log(result.body); // string (typed!)
```

### Filesystem Tool

```typescript
const FileReadTool = Tool.create({
  name: "fs.read",
  description: "Read file from filesystem",
  
  input: z.object({
    path: z.string(),
    encoding: z.enum(["utf8", "binary"]).default("utf8"),
  }),
  
  output: z.object({
    content: z.string(),
    size: z.number(),
    modified: z.date(),
  }),
  
  errors: [
    FileNotFoundError,
    PermissionDeniedError,
    FileTooBigError,
  ],
  
  contract: {
    sideEffects: ["filesystem.read"],
    isolation: "sandbox",
    maxDuration: "5s",
    retryable: true,
    idempotent: true,
    requiredPermissions: ["fs:read"],
  },
  
  execute: (input) => Effect.gen(function* (_) {
    // Check sandbox permissions
    yield* _(checkPermission("fs:read", input.path));
    
    // Read file
    const stats = yield* _(fs.stat(input.path));
    
    // Prevent reading huge files
    if (stats.size > 10_000_000) {
      yield* _(Effect.fail(new FileTooBigError({
        path: input.path,
        size: stats.size,
      })));
    }
    
    const content = yield* _(fs.readFile(input.path, input.encoding));
    
    return {
      content,
      size: stats.size,
      modified: stats.mtime,
    };
  }),
});
```

### Bash Tool (But Safer)

```typescript
const BashTool = Tool.create({
  name: "bash.exec",
  description: "Execute bash command in sandboxed environment",
  
  input: z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    timeout: z.number().default(30000),
  }),
  
  output: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    duration: z.number(),
  }),
  
  errors: [
    CommandNotFoundError,
    ExecutionTimeoutError,
    PermissionDeniedError,
    SandboxViolationError,
  ],
  
  contract: {
    sideEffects: ["process.exec"],
    isolation: "container", // Run in container!
    maxDuration: "30s",
    retryable: false, // Not idempotent by default
    requiredPermissions: ["process:exec"],
    
    // CRITICAL: Behavioral restrictions
    prohibitions: [
      "rm -rf /",
      "sudo",
      "dd if=/dev/zero",
      ":(){ :|:& };:", // Fork bomb
    ],
    
    // Whitelist of allowed commands (optional)
    allowedCommands: [
      "curl", "wget", "git", "npm", "python3",
      "grep", "sed", "awk", "jq"
    ],
  },
  
  execute: (input) => Effect.gen(function* (_) {
    // Validate command against prohibitions
    yield* _(validateCommand(input.command, input.args));
    
    // Run in containerized sandbox
    const result = yield* _(
      Effect.tryPromise({
        try: () => execInSandbox({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          timeout: input.timeout,
          
          // Sandbox configuration
          sandbox: {
            networkAccess: false, // No network by default
            filesystemAccess: "readonly",
            memoryLimit: "512MB",
            cpuLimit: "50%",
          }
        }),
        catch: (error) => classifyBashError(error),
      })
    );
    
    return result;
  }),
});
```

---

## Layer 2: Tool Runtime (Sandbox + Observe + Cache)

```typescript
class ToolRuntime {
  constructor(
    private sandbox: SandboxProvider,
    private tracer: OpenTelemetryTracer,
    private cache: SemanticCache,
  ) {}
  
  // Execute tool with full runtime support
  execute<I, O, E>(
    tool: Tool<I, O, E>,
    input: I,
    options?: ExecutionOptions
  ): Effect.Effect<O, E | RuntimeError, never> {
    return Effect.gen(function* (_) {
      // 1. Validate input against schema
      const validatedInput = yield* _(
        Effect.try({
          try: () => tool.input.parse(input),
          catch: (error) => new ValidationError({ cause: error }),
        })
      );
      
      // 2. Check behavioral contract
      yield* _(enforceContract(tool.contract, options));
      
      // 3. Check semantic cache
      const cached = yield* _(
        this.cache.get(tool.name, validatedInput)
      );
      
      if (cached && tool.contract.idempotent) {
        yield* _(Effect.annotateCurrentSpan({
          "cache.hit": true,
        }));
        return cached;
      }
      
      // 4. Start tracing span
      yield* _(Effect.withSpan(`tool.${tool.name}`, () =>
        Effect.gen(function* (_) {
          // 5. Execute in sandbox
          const result = yield* _(
            this.sandbox.execute(tool, validatedInput, {
              timeout: tool.contract.maxDuration,
              isolation: tool.contract.isolation,
            })
          );
          
          // 6. Validate output
          const validatedOutput = yield* _(
            Effect.try({
              try: () => tool.output.parse(result),
              catch: (error) => new ValidationError({ cause: error }),
            })
          );
          
          // 7. Cache result (if idempotent)
          if (tool.contract.idempotent) {
            yield* _(
              this.cache.set(tool.name, validatedInput, validatedOutput)
            );
          }
          
          return validatedOutput;
        })
      ));
    });
  }
}
```

### Semantic Caching (Smart)

```typescript
class SemanticToolCache {
  // Not just key-value cache—semantic similarity
  async get<I, O>(
    toolName: string,
    input: I
  ): Effect.Effect<Option<O>, never, never> {
    return Effect.gen(function* (_) {
      // Generate embedding for input
      const embedding = yield* _(embed(JSON.stringify(input)));
      
      // Search for semantically similar cached results
      const similar = yield* _(
        this.vectorStore.search(embedding, {
          filter: { toolName },
          threshold: 0.95, // 95% similarity
          limit: 1,
        })
      );
      
      if (similar.length === 0) {
        return Option.none();
      }
      
      // Check freshness
      const cached = similar[0];
      const age = Date.now() - cached.timestamp;
      const ttl = this.getTTL(toolName);
      
      if (age > ttl) {
        return Option.none();
      }
      
      return Option.some(cached.output);
    });
  }
  
  // Example: These are semantically similar, can share cache
  // Input 1: { city: "San Francisco" }
  // Input 2: { city: "SF" }
  // Input 3: { city: "San Francisco, CA" }
  // → All map to same cache entry
}
```

---

## Layer 3: Scout-Optimized Tool Orchestration

### Problem: Which Tool? When? How?

```typescript
// Traditional: Agent decides at runtime (expensive, slow)
const agent = createAgent();
await agent.run("Get weather in SF");
// → LLM decides: use weather API
// → Cost: $0.05
// → Time: 2 seconds

// Reactive Agents: Scouts learn optimal tool selection
const agent = await AgentBuilder()
  .withScouts({ enabled: true })
  .withTools([WeatherAPITool, WebScrapeTool, BashCurlTool])
  .build();

// Scouts test all approaches
const scoutReport = await agent.runScouts({
  task: "Get weather in SF",
  toolStrategies: "all", // Test all tool combinations
});

// Learnings:
// - WeatherAPITool: 95% success, $0.01, 500ms
// - WebScrapeTool: 60% success, $0.02, 2000ms
// - BashCurlTool: 80% success, $0.005, 300ms (but no parsing)

// Production uses optimal: WeatherAPITool
await agent.run("Get weather in SF");
// Cost: $0.01 (no LLM tool selection needed!)
// Time: 500ms (direct call)
```

### Tool Composition (Build Complex from Simple)

```typescript
// Compose tools into workflows
const GitHubPRAnalysisTool = Tool.compose({
  name: "github.analyze_pr",
  description: "Analyze GitHub PR for code quality",
  
  tools: {
    fetch: HTTPGetTool,
    parse: JSONParseTool,
    analyze: CodeAnalysisTool,
  },
  
  workflow: (input) => Effect.gen(function* (_) {
    // 1. Fetch PR data
    const prData = yield* _(
      tools.fetch.run({
        url: `https://api.github.com/repos/${input.repo}/pulls/${input.pr}`,
        headers: { Authorization: input.token },
      })
    );
    
    // 2. Parse response
    const pr = yield* _(
      tools.parse.run({ json: prData.body })
    );
    
    // 3. Fetch changed files
    const files = yield* _(
      tools.fetch.run({
        url: pr.diff_url,
        headers: { Authorization: input.token },
      })
    );
    
    // 4. Analyze code
    const analysis = yield* _(
      tools.analyze.run({
        code: files.body,
        language: "typescript",
      })
    );
    
    return {
      pr: pr.number,
      filesChanged: pr.changed_files,
      analysis: analysis.results,
      score: analysis.score,
    };
  }),
  
  // Scouts optimize this workflow!
  // - Test parallel vs. sequential execution
  // - Test caching strategies
  // - Test error handling approaches
});
```

---

## Layer 4: Tool Marketplace (Community-Powered)

```typescript
// Community contributes tools
@Tool.register({
  name: "stripe.create_payment",
  category: "payments",
  author: "@john",
  version: "1.0.0",
  verified: true, // Verified by Reactive Agents team
})
class StripePaymentTool extends Tool {
  // Implementation...
}

// Users install tools
await agent.installTool("stripe.create_payment");

// Scouts automatically learn best practices for this tool
const scoutReport = await agent.runScouts({
  task: "Process $100 payment",
  tools: ["stripe.create_payment"],
});

// Learnings shared to seeding network
await seedingNetwork.contribute({
  tool: "stripe.create_payment",
  learnings: scoutReport.learnings,
});

// Other users benefit immediately
const agent2 = await AgentBuilder()
  .withTools(["stripe.create_payment"])
  .withReactiveSeeding({ mode: "community" })
  .build();

// Automatically uses optimal approach learned from network
await agent2.run("Process $100 payment");
```

---

## What Makes This Better Than Bash/MCP?

### vs. Bash

| Feature | Bash | Reactive Agents Tools |
|---------|------|----------------------|
| Type Safety | ❌ None (strings) | ✅ Full (compile-time) |
| Error Handling | ❌ Exit codes | ✅ Typed errors |
| Sandboxing | ❌ Full system access | ✅ Containers/VMs |
| Composability | ❌ String hell | ✅ Effect composition |
| Observability | ❌ None | ✅ OpenTelemetry |
| Caching | ❌ None | ✅ Semantic cache |
| Learning | ❌ None | ✅ Scout optimization |
| Validation | ❌ None | ✅ Schema validation |

### vs. MCP

| Feature | MCP | Reactive Agents Tools |
|---------|-----|----------------------|
| Type Safety | ⚠️ JSON Schema | ✅ TypeScript + Zod |
| Local-First | ❌ Network required | ✅ Local by default |
| Composability | ⚠️ Limited | ✅ Full Effect composition |
| Learning | ❌ None | ✅ Scout optimization |
| Behavioral Contracts | ❌ None | ✅ Built-in |
| Semantic Caching | ❌ None | ✅ Built-in |
| Observability | ⚠️ Basic | ✅ Full OpenTelemetry |

### vs. LangChain Tools

| Feature | LangChain | Reactive Agents Tools |
|---------|-----------|----------------------|
| Type Safety | ❌ Python (runtime) | ✅ TypeScript (compile-time) |
| Error Handling | ⚠️ Try/catch | ✅ Effect-TS |
| Async | ⚠️ Poor (Python) | ✅ Excellent (Effect) |
| Sandboxing | ❌ None | ✅ Built-in |
| Learning | ❌ None | ✅ Scout optimization |
| Composability | ⚠️ Limited | ✅ Full Effect composition |

---

## Killer Features

### 1. Scout-Optimized Tool Selection

```typescript
// Scouts learn which tool to use when
const scoutReport = await agent.runScouts({
  task: "Fetch data from API",
  tools: [
    HTTPGetTool,        // Native HTTP
    BashCurlTool,       // Bash curl
    PythonRequestsTool, // Python requests
  ],
});

// Result: HTTPGetTool is 2x faster, more reliable
// Production agent automatically uses HTTPGetTool
```

### 2. Hybrid Execution (Local + Cloud)

```typescript
const WeatherTool = Tool.create({
  name: "weather.get",
  
  // Try local first, fallback to cloud
  execution: "hybrid",
  
  localProvider: async (input) => {
    // Try local weather DB
    const cached = await localDB.get(`weather:${input.city}`);
    if (cached && cached.age < 3600) {
      return cached.data;
    }
    throw new LocalUnavailableError();
  },
  
  cloudProvider: async (input) => {
    // Fallback to cloud API
    return await fetch(`https://api.weather.com/${input.city}`);
  },
});

// Agent automatically tries local first, falls back to cloud
// Scouts learn which cities are cached locally
```

### 3. Tool Behavioral Contracts

```typescript
// Define what tools can/cannot do
const DatabaseWriteTool = Tool.create({
  name: "db.write",
  
  contract: {
    sideEffects: ["database.write"],
    isolation: "transaction",
    
    // CRITICAL: Prohibitions
    prohibitions: [
      "DROP TABLE",
      "TRUNCATE",
      "DELETE without WHERE",
    ],
    
    // CRITICAL: Requirements
    requirements: [
      "Must validate input",
      "Must use prepared statements",
      "Must log all writes",
    ],
    
    // Agent CANNOT execute if contract violated
    enforcementLevel: "strict",
  },
});

// Scouts test contract enforcement
// Production agent guaranteed to respect contracts
```

### 4. Tool Versioning & Compatibility

```typescript
// Tools have semantic versioning
const APITool_v1 = Tool.create({
  name: "api.call",
  version: "1.0.0",
  // ...
});

const APITool_v2 = Tool.create({
  name: "api.call",
  version: "2.0.0",
  // Breaking changes
  // ...
});

// Agent can use multiple versions
const agent = await AgentBuilder()
  .withTools([
    { name: "api.call", version: "1.0.0" }, // Legacy
    { name: "api.call", version: "2.0.0" }, // New
  ])
  .build();

// Scouts learn which version is better for which tasks
```

### 5. Tool Performance Profiling

```typescript
// Every tool call is traced and profiled
const profile = await agent.getToolProfile("http.get");

console.log(profile);
// {
//   totalCalls: 1547,
//   successRate: 98.5%,
//   avgLatency: 245ms,
//   p95Latency: 890ms,
//   errorRate: 1.5%,
//   cacheHitRate: 65%,
//   costPerCall: $0.002,
//   
//   // Learned patterns
//   optimalUseCases: [
//     "APIs with rate limits",
//     "Idempotent GET requests",
//   ],
//   problematicUseCases: [
//     "Large file downloads (use stream tool)",
//     "Webhook subscriptions (use websocket tool)",
//   ],
// }
```

---

## Implementation Priority

### Phase 1: Core Tool Runtime (Month 1)

```typescript
// Implement:
- Tool.create() API
- ToolRuntime with sandboxing
- Basic HTTP, FS, Bash tools
- Schema validation
- OpenTelemetry tracing
```

### Phase 2: Scout Integration (Month 2)

```typescript
// Implement:
- Scout tool selection optimization
- Tool composition workflows
- Performance profiling
- Learnings extraction
```

### Phase 3: Seeding Network (Month 3)

```typescript
// Implement:
- Tool learning sharing
- Community tool marketplace
- Verified tool registry
- Versioning system
```

### Phase 4: Advanced Features (Month 4-6)

```typescript
// Implement:
- Semantic caching
- Hybrid local/cloud execution
- Behavioral contracts
- Tool debugging tools
```

---

## Example: Full Stack Tool Usage

```typescript
// Define agent with tools
const agent = await AgentBuilder()
  .withTools([
    HTTPGetTool,
    FileReadTool,
    BashTool,
    GitHubPRAnalysisTool, // Composed tool
  ])
  .withScouts({
    enabled: true,
    iterations: 50,
  })
  .withReactiveSeeding({
    mode: "community",
    contribute: true,
  })
  .build();

// Scouts learn optimal tool usage
const scoutReport = await agent.runScouts({
  task: "Analyze GitHub PR #123 for security issues",
  tools: "all",
});

// Apply learnings
await agent.applyLearnings(scoutReport.learnings);

// Production execution (optimized from scouts)
const result = await agent.run({
  task: "Analyze GitHub PR #123 for security issues",
  
  // Override if needed
  toolConstraints: {
    maxCost: 0.50,
    maxDuration: "30s",
    requiredTools: ["github.analyze_pr"],
  },
});

console.log(result);
// {
//   pr: 123,
//   securityIssues: [
//     { severity: "high", type: "SQL injection", line: 45 },
//     { severity: "medium", type: "Hardcoded secret", line: 128 },
//   ],
//   toolsUsed: ["github.analyze_pr", "http.get", "code.analyze"],
//   cost: 0.15,
//   duration: 8500, // ms
//   cacheHits: 2,
//   scoutOptimizations: [
//     "Used semantic cache for API calls",
//     "Parallelized file analysis",
//     "Skipped redundant security checks",
//   ],
// }
```

---

## Why This Wins

1. **Type Safety**: Catch bugs at compile time, not production
2. **Scout Optimization**: Learn optimal tool usage before deployment
3. **Composability**: Build complex tools from simple primitives
4. **Sandboxing**: Safe execution in containers
5. **Observability**: Full OpenTelemetry tracing
6. **Semantic Caching**: Smart result reuse
7. **Behavioral Contracts**: Enforce what tools can/cannot do
8. **Hybrid Execution**: Local first, cloud fallback
9. **Marketplace**: Community-contributed, verified tools
10. **Seeding Network**: Share tool learnings across all users

**Traditional tools: "Just run bash and hope."**

**Reactive Agents tools: "Type-safe, scout-optimized, collectively-learned, production-grade execution."**

---

_This is how production agents should handle tools._
