# @celom/prose-mcp

MCP server for [@celom/prose](https://www.npmjs.com/package/@celom/prose) — helps AI assistants write correct, type-safe workflow code.

Provides tools, resources, and prompts through the [Model Context Protocol](https://modelcontextprotocol.io) so that LLM-powered editors can scaffold, analyze, validate, and document Prose flows without guessing at the API.

## Install

```bash
npm install @celom/prose-mcp@latest
```

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prose": {
      "command": "npx",
      "args": ["@celom/prose-mcp@latest"]
    }
  }
}
```

### Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "prose": {
      "command": "npx",
      "args": ["@celom/prose-mcp@latest"]
    }
  }
}
```

The server communicates over stdio and requires no additional configuration.

## What's included

### Tools

| Tool | Description |
|------|-------------|
| `scaffold_flow` | Generate a complete flow definition from structured input (name, fields, steps, dependencies) |
| `analyze_flow` | Parse existing flow source code and return a structured report (steps, types, potential issues) |
| `list_flows` | Scan a project directory for all files containing `createFlow` calls |
| `validate_flow_pattern` | Check flow code for common mistakes — missing `.build()`, duplicate step names, invalid retry placement, missing dependencies |

### Resources

Static API references and dynamic guides available to the assistant at any time:

| URI | Content |
|-----|---------|
| `prose://api/quick-reference` | One-page cheatsheet of FlowBuilder methods |
| `prose://api/create-flow` | `createFlow()` API reference |
| `prose://api/flow-builder` | All FlowBuilder methods |
| `prose://api/types` | Type definitions (FlowContext, RetryOptions, etc.) |
| `prose://api/execution-options` | FlowExecutionOptions reference |
| `prose://api/error-types` | ValidationError, FlowExecutionError, TimeoutError |
| `prose://api/observers` | FlowObserver interface and built-in implementations |
| `prose://guides/{topic}` | Feature guides — retries, transactions, parallel execution, events, conditional steps, observability |
| `prose://examples/{name}` | Complete worked examples (e.g. order-processing) |

### Prompts

| Prompt | Description |
|--------|-------------|
| `design-flow` | Interactive prompt that guides the assistant through designing a new workflow from a business operation description |
| `debug-flow` | Interactive prompt for diagnosing issues in existing flow code |

## Validation rules

The `validate_flow_pattern` tool checks for:

- `createFlow()` usage is present
- `.build()` is called (flows are not executable without it)
- `.map()` appears before `.build()`, not after
- `.withRetry()` is not applied to `validate` steps
- No duplicate step names
- `.transaction()` steps have a `db` dependency
- `.event()` / `.events()` steps have an `eventPublisher` dependency

## License

MIT
