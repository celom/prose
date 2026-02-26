# Skill: create-workflow

Create a new Prose workflow file using the `@celom/prose` declarative workflow DSL.

## When to use

Use when the user asks to create, scaffold, or generate a new workflow, flow, or pipeline using Prose.

## Instructions

1. **Ask the user** for the following (skip if already provided):
   - Workflow name (kebab-case, e.g. `create-order`)
   - Brief description of what the workflow does
   - Where to create the file (default: next to related code, or ask)

2. **Determine the workflow shape** from the description:
   - **Input type**: What data does the workflow receive?
   - **Dependencies type**: Does it need `db` (database transactions)? `eventPublisher`? Neither?
   - **Steps**: Break the description into discrete, named steps
   - **Output type**: What should the workflow return?

3. **Generate the workflow file** following these patterns:

### File structure

```typescript
import {
  createFlow,
  ValidationError,
  // Include only what's needed:
  // FlowContext, FlowEvent, type BaseFlowDependencies
} from '@celom/prose';

// ── Types ────────────────────────────────────────────────

type Input = {
  // Input fields from user description
};

type Deps = {
  // Only include if needed:
  // db: { transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> };
  // eventPublisher: { publish(channel: string, event: any): Promise<void> };
};

// ── Step handlers ────────────────────────────────────────
// Extract each step handler as a named function for testability.

const validateInput = (ctx: { input: Readonly<Input> }) => {
  // Throw ValidationError for invalid input
};

const doWork = (ctx: { input: Readonly<Input>; state: Record<string, unknown> }) => {
  return { /* state to merge */ };
};

// ── Flow definition ──────────────────────────────────────

export const myFlow = createFlow<Input, Deps>('my-flow')
  .validate('validateInput', validateInput)
  .step('doWork', doWork)
  .build();
```

### Step type selection guide

| Need | Method | Notes |
|------|--------|-------|
| Validate input/state, throw on failure | `.validate(name, handler)` | Handler returns void, throw `ValidationError` on failure |
| Do work, return data to merge into state | `.step(name, handler)` | Return an object; it gets merged into `ctx.state` |
| Conditionally run a step | `.stepIf(name, condition, handler)` | Condition is `(ctx) => boolean` |
| Run inside a DB transaction | `.transaction(name, handler)` | Handler receives `(ctx, tx)` — needs `db` in deps |
| Publish domain events | `.event(channel, builder)` | Builder returns `{ eventType: string, ... }` — needs `eventPublisher` in deps |
| Short-circuit the flow | `.breakIf(condition, returnValue?)` | Stops flow and returns early |
| Run steps concurrently | `.parallel(name, strategy, ...handlers)` | Strategy: `'shallow'`, `'error-on-conflict'`, or `'deep'` |
| Transform final output | `.map((input, state) => result)` | Called last, before `.build()` |
| Add retry to last step | `.withRetry({ maxAttempts, delayMs })` | Chain after the step to retry |
| Compose reusable sub-flows | `.pipe(fn)` | `fn` receives builder, returns builder |

### Validation pattern

```typescript
import { ValidationError } from '@celom/prose';

const validateInput = (ctx: { input: Readonly<Input> }) => {
  const issues = [];
  if (!ctx.input.email) issues.push({ field: 'email', message: 'Required' });
  if (!ctx.input.name) issues.push({ field: 'name', message: 'Required' });
  if (issues.length > 0) throw ValidationError.multiple(issues);
};
```

### Execution pattern

```typescript
const result = await myFlow.execute(
  { /* input */ },
  { /* deps */ },
  {
    correlationId: 'req-123',    // optional
    timeout: 30_000,              // optional, ms
    stepTimeout: 5_000,           // optional, ms
    observer: new DefaultObserver(), // optional
  },
);
```

## Rules

- Always use `createFlow<Input, Deps>('name')` — never instantiate `FlowBuilder` directly
- Step names must be unique within a flow (enforced at build time)
- Extract step handlers into named functions — keeps the flow chain readable and handlers testable
- Only include `db` in Deps if the workflow uses `.transaction()`
- Only include `eventPublisher` in Deps if the workflow uses `.event()` or `.events()`
- Use `Deps = never` (omit the second generic) when no external dependencies are needed
- Always call `.build()` at the end of the chain
- Use `ValidationError.single(field, message)` or `ValidationError.multiple(issues)` for validation errors
- Prefer `.map()` for shaping the final output rather than adding a final step just to restructure data
- Import from `@celom/prose` — not from internal paths
