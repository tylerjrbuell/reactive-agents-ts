# Reactive Agents: Complete API Design

> **Dual API, reasoning patterns, and real-world use cases**

---

## 🎯 Design Philosophy

Reactive Agents provides **two API levels**:

1. **Simple API** (Promise-based) - For quick start and simple use cases
2. **Advanced API** (Effect-based) - For production, complex workflows, and fine-grained control

**Both share the same underlying engine.** Choose based on your needs.

---

## 📦 Simple API (Promise-Based)

### **For: Beginners, Prototyping, Simple Agents**

```typescript
import { AgentBuilder } from 'reactive-agents';

// Create agent (returns Promise)
const agent = await AgentBuilder()
  .withModel('gpt-4')
  .withTools(['search', 'analyze'])
  .withReasoningStrategy('adaptive')
  .build();

// Run agent (returns Promise)
const result = await agent.run('Research quantum computing');

console.log(result);
// {
//   answer: "Quantum computing uses quantum mechanics...",
//   status: 'success',
//   tokensUsed: 1234,
//   duration: 5678,
//   qualityScore: 0.92
// }
```

### **Simple API Methods**

```typescript
class Agent {
  // Run task
  async run(task: string, options?: RunOptions): Promise<AgentResult>
  
  // Run in background
  async runBackground(task: string, options?: RunOptions): Promise<JobId>
  
  // Stream results
  async *runStreaming(task: string): AsyncGenerator<ReasoningStep>
  
  // Get status
  async getStatus(jobId: JobId): Promise<JobStatus>
  
  // Cancel task
  async cancel(jobId: JobId): Promise<void>
  
  // Get reasoning trace
  async getReasoningTrace(resultId: string): Promise<ReasoningTrace>
  
  // Get analytics
  async getAnalytics(): Promise<AgentAnalytics>
}
```

### **Simple API Examples**

```typescript
// Example 1: Basic agent
const agent = await AgentBuilder()
  .withModel('gpt-4')
  .build();

const result = await agent.run('Summarize this article: ...');

// Example 2: With tools
const agent = await AgentBuilder()
  .withModel('gpt-4')
  .withTools(['search', 'calculator'])
  .build();

const result = await agent.run('What is 15% of the GDP of France in 2023?');

// Example 3: Streaming
const agent = await AgentBuilder()
  .withModel('gpt-4')
  .build();

for await (const step of agent.runStreaming('Research AI safety')) {
  console.log(step);
  // { step: 1, action: 'search', thought: '...', status: 'in_progress' }
  // { step: 2, action: 'analyze', thought: '...', status: 'in_progress' }
  // { step: 3, action: 'synthesize', thought: '...', status: 'complete' }
}

// Example 4: Background jobs
const agent = await AgentBuilder()
  .withModel('gpt-4')
  .withQueue({ type: 'bull' })
  .build();

const jobId = await agent.runBackground('Long research task');
console.log(`Job started: ${jobId}`);

// Check status later
const status = await agent.getStatus(jobId);
console.log(status); // 'waiting' | 'active' | 'completed' | 'failed'

// Get result when done
if (status === 'completed') {
  const result = await agent.getJobResult(jobId);
  console.log(result.answer);
}
```

---

## 🔧 Advanced API (Effect-Based)

### **For: Production, Complex Workflows, Fine-Grained Control**

```typescript
import { AgentBuilder } from 'reactive-agents';
import { Effect } from 'effect';

// Create agent (returns Effect)
const createAgent = AgentBuilder()
  .withModel('gpt-4')
  .withTools(['search', 'analyze'])
  .withReasoningStrategy('adaptive')
  .buildEffect(); // 👈 Returns Effect

// Run agent (returns Effect)
const program = Effect.gen(function* (_) {
  const agent = yield* _(createAgent);
  const result = yield* _(agent.runEffect('Research quantum computing'));
  return result;
});

// Execute with full control
const result = await program.pipe(
  Effect.retry({ times: 3, schedule: exponential }),
  Effect.timeout('60 seconds'),
  Effect.catchAll(error => {
    console.error('Agent failed:', error);
    return Effect.succeed({ status: 'failed', error });
  }),
  Effect.runPromise
);
```

### **Advanced API Methods**

```typescript
class EffectAgent {
  // Run task (Effect)
  runEffect(
    task: string,
    options?: RunOptions
  ): Effect.Effect<AgentResult, AgentError, AgentServices>
  
  // Run with full context
  runWithContext(
    task: string,
    context: AgentContext
  ): Effect.Effect<AgentResult, AgentError, AgentServices>
  
  // Stream results (Effect Stream)
  streamEffect(
    task: string
  ): Stream.Stream<ReasoningStep, AgentError, AgentServices>
  
  // Compose with other Effects
  compose<R, E>(
    effect: Effect.Effect<R, E>
  ): Effect.Effect<AgentResult, AgentError | E, AgentServices>
}
```

### **Advanced API Examples**

```typescript
// Example 1: Retry with exponential backoff
const program = agent.runEffect('Research topic').pipe(
  Effect.retry({ 
    times: 5,
    schedule: Schedule.exponential('1 second')
  })
);

// Example 2: Timeout with fallback
const program = agent.runEffect('Complex task').pipe(
  Effect.timeout('30 seconds'),
  Effect.catchTag('TimeoutError', () =>
    Effect.succeed({ answer: 'Task timed out, using cached result', cached: true })
  )
);

// Example 3: Parallel execution
const program = Effect.gen(function* (_) {
  const agent = yield* _(createAgent);
  
  // Run multiple tasks in parallel
  const results = yield* _(
    Effect.all([
      agent.runEffect('Task 1'),
      agent.runEffect('Task 2'),
      agent.runEffect('Task 3')
    ], { concurrency: 3 })
  );
  
  return results;
});

// Example 4: Resource management
const program = Effect.gen(function* (_) {
  // Agent is automatically cleaned up
  const agent = yield* _(createAgent);
  
  const result = yield* _(agent.runEffect('Task'));
  
  // Cleanup happens automatically even on error
  return result;
}).pipe(
  Effect.acquireRelease(
    createAgent,
    (agent) => agent.cleanup()
  )
);

// Example 5: Error handling with typed errors
const program = agent.runEffect('Task').pipe(
  Effect.catchTag('ToolExecutionError', error => {
    console.log(`Tool ${error.tool} failed: ${error.reason}`);
    return retryWithDifferentTool(error.tool);
  }),
  Effect.catchTag('ContextOverflowError', error => {
    console.log('Context overflow, compressing...');
    return agent.runEffect('Task', { contextCompression: 0.5 });
  }),
  Effect.catchTag('RateLimitError', error => {
    console.log('Rate limited, waiting...');
    return Effect.sleep('5 seconds').pipe(
      Effect.flatMap(() => agent.runEffect('Task'))
    );
  })
);

// Example 6: Composing with other services
const program = Effect.gen(function* (_) {
  const agent = yield* _(createAgent);
  const db = yield* _(DatabaseService);
  const cache = yield* _(CacheService);
  
  // Check cache first
  const cached = yield* _(cache.get(taskId));
  if (cached) return cached;
  
  // Run agent
  const result = yield* _(agent.runEffect('Task'));
  
  // Save to DB and cache
  yield* _(db.save(result));
  yield* _(cache.set(taskId, result, { ttl: 3600 }));
  
  return result;
});
```

---

## 🎨 Reasoning Strategy Examples

### **1. Reactive Strategy (Fast & Simple)**

```typescript
const agent = await AgentBuilder()
  .withReasoningStrategy('reactive')
  .build();

// Use for:
// - Simple Q&A
// - Quick calculations
// - Straightforward tasks
// - Known patterns

// Example
await agent.run('What is 2+2?');
// → Direct answer, no planning

await agent.run('Translate hello to Spanish');
// → Immediate response
```

### **2. Plan-Execute-Reflect (Structured & Thorough)**

```typescript
const agent = await AgentBuilder()
  .withReasoningStrategy('plan-execute-reflect')
  .withReasoningController({
    maxDepth: 5,
    reflectionTriggers: ['error', 'uncertainty', 'low_quality']
  })
  .build();

// Use for:
// - Multi-step tasks
// - Research projects
// - Complex analysis
// - Tasks requiring verification

// Example
await agent.run('Research the impact of AI on healthcare');
// Step 1: Plan
//   - Search recent AI healthcare applications
//   - Analyze effectiveness studies
//   - Identify key trends
//   - Synthesize findings
//
// Step 2: Execute
//   - Searches medical journals
//   - Analyzes 10 studies
//   - Identifies 5 key trends
//
// Step 3: Reflect
//   - Quality check: Good (0.88)
//   - Coverage check: Missing recent 2024 data
//   - Decision: Search for 2024 studies
//
// Step 4: Adapt & Re-execute
//   - Searches 2024 publications
//   - Updates findings
//
// Step 5: Final Reflection
//   - Quality: Excellent (0.95)
//   - Complete: Yes
//   - Return result
```

### **3. Tree-of-Thought (Exploratory & Creative)**

```typescript
const agent = await AgentBuilder()
  .withReasoningStrategy('tree-of-thought')
  .withReasoningController({
    branchingFactor: 3, // Explore 3 paths per decision
    maxDepth: 4,
    evaluationCriteria: 'creativity'
  })
  .build();

// Use for:
// - Creative tasks
// - Problem-solving
// - Multiple solution exploration
// - Brainstorming

// Example
await agent.run('Design a logo for an eco-friendly tech startup');
//
// Path 1: Nature-inspired
//   → Leaf + circuit board
//   → Evaluation: Good (0.82)
//
// Path 2: Minimalist tech
//   → Geometric green shapes
//   → Evaluation: Excellent (0.91)
//
// Path 3: Abstract energy
//   → Flowing green data streams
//   → Evaluation: Good (0.85)
//
// Best path: Path 2 (Minimalist tech)
// Refine and return
```

### **4. Reflexion (Self-Correcting & High-Quality)**

```typescript
const agent = await AgentBuilder()
  .withReasoningStrategy('reflexion')
  .withReasoningController({
    maxIterations: 3,
    selfCritiquePrompt: 'Analyze this response for accuracy, completeness, and clarity',
    improvementThreshold: 0.85
  })
  .build();

// Use for:
// - Quality-critical tasks
// - Legal/medical content
// - Important communications
// - High-stakes decisions

// Example
await agent.run('Draft a legal contract for software licensing');
//
// Iteration 1: Initial draft
//   - Generates contract
//   - Self-critique: "Missing indemnification clause, ambiguous on derivative works"
//   - Quality: 0.75 (below threshold)
//
// Iteration 2: Improved draft
//   - Adds indemnification
//   - Clarifies derivative works
//   - Self-critique: "Good but warranty section could be stronger"
//   - Quality: 0.87 (above threshold but can improve)
//
// Iteration 3: Final draft
//   - Strengthens warranty section
//   - Final review: "Comprehensive and clear"
//   - Quality: 0.95
//
// Return final draft
```

### **5. Adaptive Strategy (AI-Selected)**

```typescript
const agent = await AgentBuilder()
  .withReasoningStrategy('adaptive')
  .withStrategySelection({
    rules: [
      { when: (task) => task.complexity < 0.3, use: 'reactive' },
      { when: (task) => task.complexity > 0.7, use: 'plan-execute-reflect' },
      { when: (task) => task.creative, use: 'tree-of-thought' },
      { when: (task) => task.quality === 'critical', use: 'reflexion' }
    ],
    learning: true
  })
  .build();

// Use for:
// - Mixed workloads
// - Unknown task types
// - Production systems
// - Continuous operation

// Example
await agent.run('What is 2+2?');
// → Selects: reactive (simple task)

await agent.run('Write a comprehensive security audit report');
// → Selects: plan-execute-reflect (complex + structured)

await agent.run('Generate creative marketing slogans');
// → Selects: tree-of-thought (creative task)

await agent.run('Draft legal disclaimer');
// → Selects: reflexion (quality-critical)
```

---

## 🌍 Real-World Use Case Gallery

### **Healthcare: Diagnostic Assistant**

```typescript
const diagnosticAgent = await AgentBuilder()
  .withModel('gpt-4')
  .withReasoningStrategy('reflexion')
  .withReasoningController({
    maxIterations: 5,
    reflectionTriggers: ['uncertainty', 'contradictory_findings'],
    selfCritiquePrompt: `
      Review diagnosis for:
      1. Accuracy based on symptoms
      2. Consideration of differential diagnoses
      3. Recommended tests appropriateness
      4. Patient safety
    `
  })
  .withQualityThresholds({
    minimum: 0.95,
    criticalThreshold: 0.98
  })
  .withHumanInTheLoop({
    pauseOn: ['high_uncertainty', 'critical_decision'],
    requireApproval: true
  })
  .withSkills(['medical-knowledge', 'symptom-analysis'])
  .build();

// Safe, auditable, human-supervised medical assistance
```

### **Finance: Autonomous Trading with Safeguards**

```typescript
const tradingAgent = await AgentBuilder()
  .withModel('gpt-4')
  .withReasoningStrategy('plan-execute-reflect')
  .withReasoningController({
    before Reasoning: (context) => {
      // Check market conditions
      if (context.marketVolatility > 0.8) {
        return { signal: 'abort', reason: 'Market too volatile' };
      }
      if (context.accountBalance < minBalance) {
        return { signal: 'abort', reason: 'Insufficient funds' };
      }
      return { signal: 'continue' };
    },
    
    duringStep: (step) => {
      // Check each trade
      if (step.proposedTrade.amount > maxTradeSize) {
        return { signal: 'pause', reason: 'Trade exceeds limit' };
      }
      if (step.proposedTrade.risk > maxRisk) {
        return { signal: 'abort', reason: 'Risk too high' };
      }
      return { signal: 'continue' };
    },
    
    onUncertainty: (signal) => {
      if (signal.level === 'high') {
        return { decision: 'require_human_approval' };
      }
      return { decision: 'continue' };
    }
  })
  .withAudit({ enabled: true, immutable: true })
  .build();

// Safe autonomous trading with mandatory risk checks
```

### **Education: Adaptive Tutoring**

```typescript
const tutorAgent = await AgentBuilder()
  .withModel('gpt-4')
  .withReasoningStrategy('adaptive')
  .withContext Controller({
    retention: [
      'student_progress',
      'learning_style',
      'past_mistakes',
      'successful_approaches'
    ]
  })
  .withReasoningController({
    adaptationStrategy: {
      factors: [
        'student_understanding_level',
        'engagement_metrics',
        'current_difficulty',
        'learning_pace'
      ]
    },
    
    duringStep: (step) => {
      // Adapt explanation based on student response
      if (step.studentResponse === 'confused') {
        return {
          signal: 'adapt',
          newApproach: 'simpler_explanation',
          addExample: true
        };
      }
      if (step.studentResponse === 'bored') {
        return {
          signal: 'adapt',
          newApproach: 'challenge_mode',
          increaseComplexity: true
        };
      }
      return { signal: 'continue' };
    }
  })
  .withSkills(['teaching', 'assessment', 'encouragement'])
  .build();

// Personalized tutoring that adapts in real-time
```

### **Customer Support: Intelligent Escalation**

```typescript
const supportAgent = await AgentBuilder()
  .withModel('gpt-4')
  .withReasoningStrategy('adaptive')
  .withReasoningController({
    onUncertainty: (signal) => {
      if (signal.level === 'high') {
        return {
          decision: 'escalate_to_human',
          category: signal.category,
          context: signal.context,
          estimatedWaitTime: getHumanAgentAvailability()
        };
      }
      if (signal.level === 'medium' && signal.isEmotional) {
        return {
          decision: 'escalate_to_human',
          reason: 'Customer needs empathy'
        };
      }
      return { decision: 'continue' };
    }
  })
  .withReasoningAnalytics({
    track: [
      'escalation_rate',
      'resolution_rate',
      'customer_satisfaction',
      'response_time'
    ],
    learning: true,
    improve: ['escalation_decision', 'resolution_approach']
  })
  .withSkills(['customer-service', 'troubleshooting', 'empathy'])
  .build();

// Support that handles 90% automatically, escalates intelligently
```

### **Content Creation: Brand-Consistent Writer**

```typescript
const writerAgent = await AgentBuilder()
  .withModel('gpt-4')
  .withReasoningStrategy('tree-of-thought')
  .withReasoningController({
    branchingFactor: 5, // Explore multiple angles
    evaluationCriteria: ['brand_consistency', 'creativity', 'engagement']
  })
  .withContextController({
    retention: [
      'brand_guidelines',
      'previous_content',
      'audience_feedback',
      'style_preferences'
    ]
  })
  .withReasoningAnalytics({
    track: ['style_patterns', 'tone_preferences', 'successful_content'],
    learning: true,
    adapt: 'writing_style'
  })
  .withSkills(['copywriting', 'brand-voice', 'storytelling'])
  .build();

// Writer that learns and matches your brand voice
```

---

## 🛠️ Utility Functions & Helpers

### **Promise/Effect Conversion**

```typescript
// Convert Promise to Effect
import { Effect } from 'effect';

const promiseToEffect = <A>(promise: Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise(() => promise);

// Convert Effect to Promise
const effectToPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

// Use in code
const result = await effectToPromise(agent.runEffect('task'));
```

### **Retry Utilities**

```typescript
import { Schedule, Effect } from 'effect';

// Exponential backoff
const withExponentialBackoff = <A, E>(
  effect: Effect.Effect<A, E>,
  maxRetries: number = 3
) =>
  effect.pipe(
    Effect.retry({
      times: maxRetries,
      schedule: Schedule.exponential('1 second')
    })
  );

// Retry with jitter
const withJitter = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.exponential('1 second').pipe(
        Schedule.jittered
      )
    })
  );

// Conditional retry
const retryOnSpecificError = <A, E extends { _tag: string }>(
  effect: Effect.Effect<A, E>,
  errorTag: string
) =>
  effect.pipe(
    Effect.retry({
      while: (error) => error._tag === errorTag,
      times: 3
    })
  );
```

### **Timeout Utilities**

```typescript
// Simple timeout
const withTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  duration: Duration.Duration
) =>
  effect.pipe(Effect.timeout(duration));

// Timeout with fallback
const withTimeoutAndFallback = <A, E>(
  effect: Effect.Effect<A, E>,
  duration: Duration.Duration,
  fallback: A
) =>
  effect.pipe(
    Effect.timeout(duration),
    Effect.catchTag('TimeoutError', () => Effect.succeed(fallback))
  );
```

### **Resource Management**

```typescript
// Auto-cleanup resource
const withResource = <R, A, E>(
  acquire: Effect.Effect<R, E>,
  release: (r: R) => Effect.Effect<void, never>,
  use: (r: R) => Effect.Effect<A, E>
) =>
  Effect.acquireRelease(acquire, release).pipe(
    Effect.flatMap(use)
  );

// Example
const program = withResource(
  createAgent,
  (agent) => agent.cleanup(),
  (agent) => agent.runEffect('task')
);
```

### **Parallel Execution**

```typescript
// Run in parallel
const runParallel = <A>(
  effects: Array<Effect.Effect<A, Error>>,
  concurrency: number = 5
) =>
  Effect.all(effects, { concurrency });

// Example
const results = await Effect.gen(function* (_) {
  const tasks = ['task1', 'task2', 'task3'];
  
  return yield* _(
    runParallel(
      tasks.map(task => agent.runEffect(task)),
      3 // Max 3 concurrent
    )
  );
}).pipe(Effect.runPromise);
```

---

## 🎓 Migration Patterns

### **From LangChain**

```typescript
// LangChain
import { ReActAgent } from 'langchain/agents';

const agent = await ReActAgent.fromLLMAndTools(llm, tools);
const result = await agent.call({ input: 'task' });

// ↓ Migrate to Reactive Agents

import { AgentBuilder } from 'reactive-agents';

const agent = await AgentBuilder()
  .withModel('gpt-4')
  .withTools(tools) // Same tools work!
  .withReasoningStrategy('reactive') // Match ReAct behavior
  .build();

const result = await agent.run('task');
```

### **From AutoGen**

```typescript
// AutoGen
const agent = new AssistantAgent({
  name: 'assistant',
  llm_config: config
});

// ↓ Migrate to Reactive Agents

const agent = await AgentBuilder()
  .withModel(config.model)
  .withReasoningStrategy('plan-execute')
  .withMultiAgentOrchestration({
    role: 'assistant'
  })
  .build();
```

---

*Version: 1.0.0*  
*Last Updated: 2025-02-04*  
*Status: COMPLETE*
