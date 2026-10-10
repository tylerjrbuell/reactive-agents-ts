# ReactiveAgents Configuration Guide

A comprehensive guide for configuring and using `ReactiveAgents` with TypeScript.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [Available Tools](#available-tools)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# Install dependencies
npm install reactive-agents

# Initialize agent
const agent = await ReactiveAgents.create()
  .withProvider('ollama')
  .withModel('qwen3.5')
  .withTools({ builtins: true })
  .build();

// Run a task
const result = await agent.run('What is the capital of France?');
console.log(result.output);

// Clean up
await agent.dispose();
```

## Configuration Options

### AgentConfig

The main configuration interface for ReactiveAgents:

```typescript
interface AgentConfig {
  /** Provider backend to use */
  provider?: 'ollama' | 'openai' | 'anthropic' | 'azure';
  
  /** Model name or identifier */
  model?: string;
  
  /** Whether to enable built-in tools */
  enableTools?: boolean;
  
  /** Reasoning strategy: 'reactive', 'chain-of-thought', or 'tree-of-thoughts' */
  reasoningStrategy?: 'reactive' | 'chain-of-thought' | 'tree-of-thoughts';
  
  /** Observability verbosity: 'silent', 'minimal', 'normal', 'verbose' */
  observabilityLevel?: 'silent' | 'minimal' | 'normal' | 'verbose';
  
  /** Enable live streaming of agent thoughts */
  liveStreaming?: boolean;
}
```

### Configuration Examples

#### Basic Chatbot

```typescript
const config = {
  provider: 'ollama',
  model: 'qwen3.5',
  enableTools: true,
  reasoningStrategy: 'reactive',
  observabilityLevel: 'normal'
};
```

#### Production-Ready Agent

```typescript
const config = {
  provider: 'ollama',
  model: 'qwen3.5',
  enableTools: true,
  reasoningStrategy: 'reactive',
  observabilityLevel: 'verbose',
  liveStreaming: true
};
```

#### Lightweight Configuration

```typescript
const config = {
  provider: 'ollama',
  model: 'qwen3.5',
  enableTools: false,
  reasoningStrategy: 'chain-of-thought',
  observabilityLevel: 'minimal'
};
```

### Validation

The `validateConfig()` function ensures your configuration is valid:

```typescript
function validateConfig(config: AgentConfig): void {
  if (!config.provider) {
    throw new Error('Provider is required');
  }
  
  const validProviders = ['ollama', 'openai', 'anthropic', 'azure'];
  if (!validProviders.includes(config.provider)) {
    throw new Error(`Invalid provider: ${config.provider}`);
  }
}
```

## Available Tools

### Built-in Tools

| Tool | Description | Example Usage |
|------|-------------|---------------|
| `web-search` | Search the web for current information | `agent.run('web-search', { query: 'Bitcoin price' })` |
| `crypto-price` | Get cryptocurrency prices from CoinGecko | `agent.run('crypto-price', { coins: ['BTC', 'ETH'] })` |
| `http-get` | Fetch content from any URL | `agent.run('http-get', { url: 'https://api.example.com/data' })` |
| `file-read` | Read file contents | `agent.run('file-read', { path: './config.json' })` |
| `list-directory` | List directory contents | `agent.run('list-directory', { path: './src' })` |
| `file-write` | Write text to a file | `agent.run('file-write', { path: './output.txt', content: 'Hello' })` |
| `file-edit` | Replace text in existing files | `agent.run('file-edit', { path: './config.ts', oldText: 'DEBUG=false', newText: 'DEBUG=true' })` |
| `grep` | Search files for regex patterns | `agent.run('grep', { pattern: 'TODO', path: './src' })` |
| `code-execute` | Execute JavaScript/TypeScript code | `agent.run('code-execute', { code: 'return [1,2,3].filter(n => n > 1)' })` |
| `git-cli` | Run git commands | `agent.run('git-cli', { command: 'log --oneline -5' })` |
| `gh-cli` | Run GitHub CLI commands | `agent.run('gh-cli', { command: 'pr list --state open' })` |
| `gws-cli` | Run Google Workspace CLI commands | `agent.run('gws-cli', { command: 'gmail messages list' })` |

### Custom Tools

You can define custom tools:

```typescript
const customTools = [
  {
    name: 'my-custom-tool',
    description: 'My custom tool for specific tasks',
    parameters: {
      input: { type: 'string', required: true }
    },
    handler: async (args) => {
      // Tool implementation
      return await process(args.input);
    }
  }
];

const agent = await ReactiveAgents.create()
  .withTools({ builtins: false, customTools })
  .build();
```

## Best Practices

### Provider Selection

- **ollama**: Use for local development and testing (no API key required)
- **openai**: Production-grade with OpenAI models
- **anthropic**: Advanced reasoning tasks
- **azure**: Enterprise deployment options

**Tip**: Consider cost implications for production use. Always implement fallback providers for resilience.

### Model Selection

- Match model capability to task complexity
- Use smaller models for simple queries (faster, cheaper)
- Use larger models for complex reasoning (slower, more expensive)
- Consider context window requirements for your use case

### Tool Integration

- Enable only the tools you actually need
- Implement rate limiting for external API calls
- Add validation for tool inputs and outputs
- Log tool usage for debugging and analytics

### Error Handling

```typescript
try {
  const result = await agent.run(task);
  console.log(result.output);
} catch (error) {
  console.error('Agent error:', error.message);
  // Implement retry logic here
} finally {
  await agent.dispose();
}
```

### Observability

- Use verbose logging during development
- Reduce verbosity in production
- Monitor token usage and response times
- Implement structured logging for log aggregation

### Security Considerations

- **Never expose API keys in client-side code**
- Validate all user inputs before processing
- Sanitize outputs to prevent XSS
- Implement access controls for sensitive operations

### Performance Optimization

- Use smaller models for simple queries
- Cache frequent responses when appropriate
- Implement streaming for better UX
- Monitor and optimize token usage

## Examples

### Complete Workflow Example

```typescript
import { ReactiveAgents } from 'reactive-agents';

async function main() {
  // Initialize agent
  const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel('qwen3.5')
    .withTools({ builtins: true })
    .build();
  
  // Run a task
  const result = await agent.run('What is the current price of Bitcoin?');
  console.log(result.output);
  
  // Clean up
  await agent.dispose();
}

main();
```

### Using Custom Configuration

```typescript
import { initAgent, runTask } from './scratch';

async function main() {
  const agent = await initAgent({
    provider: 'ollama',
    model: 'qwen3.5',
    enableTools: true,
    observabilityLevel: 'verbose'
  });
  
  const result = await runTask(agent, 'Search for recent news about AI');
  console.log(result.output);
}

main();
```

### Formatting Task Prompts

```typescript
import { formatTask } from './scratch';

const baseTask = 'Summarize the following text.';
const context = { topic: 'Technology', length: 'brief' };
const examples = [
  { input: 'AI is transforming industries...', output: 'AI transforms many sectors.' },
  { input: 'Cloud computing enables...', output: 'Cloud enables scalability.' }
];

const formattedTask = formatTask(baseTask, context, examples);
const result = await agent.run(formattedTask);
```

## Troubleshooting

### Common Issues

#### Provider Not Found

```
Error: Invalid provider: invalid-provider
```

**Solution**: Use one of the supported providers: `ollama`, `openai`, `anthropic`, `azure`

#### Model Not Found

```
Error: Model 'unknown-model' not found
```

**Solution**: Check available models for your provider. For ollama, run `ollama list` to see installed models.

#### Tool Execution Failed

```
Error: Tool execution failed with code 429
```

**Solution**: Implement rate limiting and retry logic. Consider using a smaller number of concurrent requests.

#### Out of Memory

```
Error: Process terminated with signal SIGKILL
```

**Solution**: Reduce model size or increase available memory. Monitor token usage.

### Debugging Tips

1. Enable verbose logging: `observabilityLevel: 'verbose'`
2. Check agent logs for detailed error messages
3. Use try-catch blocks to capture errors
4. Implement structured logging with timestamps
5. Monitor token usage to prevent OOM errors

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## Support

For issues and questions, please open a GitHub issue or contact the maintainers.

---

**Note**: This README is companion documentation for `scratch.ts`. For detailed type definitions and API documentation, refer to the inline JSDoc comments in `scratch.ts`.
