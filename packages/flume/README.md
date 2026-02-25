# @celom/flume

A declarative workflow DSL for orchestrating complex business operations with type-safe state management, automatic retries, transaction support, and observability.

## Features

- **Fluent Builder API** - Chain steps together in a readable, declarative style
- **Type-Safe State Accumulation** - Each step's output is merged into state with full TypeScript inference
- **Database Transactions** - First-class support for transactional operations via Drizzle
- **Event Publishing** - Integrated event publishing with correlation ID propagation
- **Retry Logic** - Configurable retries with exponential backoff
- **Conditional Steps** - Skip steps based on runtime conditions
- **Short-Circuit Execution** - Break out of flows early with `breakIf()`
- **Timeouts** - Flow-level and step-level timeout protection
- **Observability** - Hook into every step for logging, metrics, and debugging

## Installation

```bash
bun add @celom/flume
```

## Quick Start

```typescript
import { createFlow, ValidationError } from '@celom/flume';

// Define input and dependency types
interface LoginInput {
  email: string;
  password: string;
}

interface LoginDeps {
  db: DbClient;
  accountRepo: AccountRepository;
  eventPublisher: EventPublisher;
}

// Create a flow
const loginFlow = createFlow<LoginInput, LoginDeps>('user-login')
  // Validation (throws ValidationError on failure)
  .validate('validateEmail', (ctx) => {
    if (!ctx.input.email.includes('@')) {
      throw new ValidationError('Invalid email format', 'email');
    }
  })

  // Regular step - returns state to merge
  .step('findAccount', async (ctx) => {
    const account = await ctx.deps.accountRepo.findByEmail(ctx.input.email);
    if (!account) throw new Error('Account not found');
    return { account };
  })

  // Transaction step - runs in a database transaction
  .transaction(async (ctx, tx) => {
    await ctx.deps.accountRepo.updateLastLogin(ctx.state.account.id, tx);
    return { loginRecorded: true };
  })

  // Event publishing
  .event('auth', (ctx) => ({
    eventType: 'user.login',
    data: { userId: ctx.state.account.id },
  }))

  // Map accumulated state to final output
  .map((input, state) => ({
    userId: state.account.id,
    email: state.account.email,
  }))

  .build();

// Execute the flow
const result = await loginFlow.execute(
  { email: 'user@example.com', password: 'secret' },
  { db, accountRepo, eventPublisher }
);
```

## API Reference

### `createFlow<TInput, TDeps>(name)`

Creates a new flow builder with the given name.

```typescript
const flow = createFlow<{ userId: string }, { db: DbClient }>('my-flow');
```

### Step Types

#### `.validate(name, handler)`

Validation step that doesn't return state. Throw `ValidationError` to fail validation.

```typescript
.validate('checkInput', (ctx) => {
  if (!ctx.input.email) {
    throw ValidationError.single('email', 'Email is required');
  }
})
```

#### `.step(name, handler, retryOptions?)`

Regular step that returns state to merge. The returned object is shallow-merged into the accumulated state.

```typescript
.step('fetchUser', async (ctx) => {
  const user = await ctx.deps.userRepo.findById(ctx.input.userId);
  return { user }; // Merged into ctx.state
})
```

#### `.stepIf(name, condition, handler, retryOptions?)`

Conditional step that only executes if the condition returns `true`.

```typescript
.stepIf(
  'sendWelcomeEmail',
  (ctx) => ctx.state.user.isNewUser,
  async (ctx) => {
    await ctx.deps.emailService.sendWelcome(ctx.state.user.email);
    return { welcomeEmailSent: true };
  }
)
```

#### `.transaction(handler, name?)`

Executes the handler within a database transaction. Requires `db` in dependencies.

```typescript
.transaction(async (ctx, tx) => {
  await ctx.deps.accountRepo.update(ctx.state.account, tx);
  await ctx.deps.auditRepo.log('account.updated', tx);
  return { updated: true };
}, 'updateAccount')
```

#### `.event(channel, handler, name?)`

Publishes events to the specified channel. Requires `eventPublisher` in dependencies.

```typescript
.event('auth', (ctx) => ({
  eventType: 'user.created',
  data: { userId: ctx.state.user.id },
}), 'publishUserCreated')

// Multiple events
.event('notifications', (ctx) => [
  { eventType: 'email.send', data: { to: ctx.state.user.email } },
  { eventType: 'slack.notify', data: { channel: '#signups' } },
])
```

#### `.breakIf(condition, returnValue?)`

Short-circuits the flow if the condition is true. Remaining steps (including `.map()`) are skipped.

```typescript
.step('checkCache', async (ctx) => {
  const cached = await ctx.deps.cache.get(ctx.input.id);
  return { cached, cacheHit: !!cached };
})
.breakIf(
  (ctx) => ctx.state.cacheHit,
  (ctx) => ({ data: ctx.state.cached, fromCache: true })
)
// Steps below only run if cache miss
.step('fetchFromDb', ...)
```

### Modifiers

#### `.withRetry(options)`

Adds retry logic to the previous step.

```typescript
.step('callExternalApi', async (ctx) => {
  return await ctx.deps.api.fetch(ctx.input.id);
})
.withRetry({
  maxAttempts: 3,
  delayMs: 100,
  backoffMultiplier: 2,    // 100ms, 200ms, 400ms
  maxDelayMs: 1000,        // Cap delay at 1 second
  shouldRetry: (error) => error.code !== 'NOT_FOUND',
  stepTimeout: 5000,       // 5 second timeout per attempt
})
```

#### `.map(mapper)`

Transforms the accumulated state into the final output. Skipped if flow breaks early via `breakIf()`.

```typescript
.map((input, state) => ({
  id: state.user.id,
  name: `${state.profile.firstName} ${state.profile.lastName}`,
}))
```

### Flow Composition

#### `composeFlows(name, flows)`

Combines multiple flows into a single flow. Steps execute in sequence.

```typescript
import { composeFlows } from '@celom/flume';

const validationFlow = createFlow<Input, Deps>('validation')
  .validate('checkA', ...)
  .validate('checkB', ...)
  .build();

const processingFlow = createFlow<Input, Deps>('processing')
  .step('process', ...)
  .build();

const combined = composeFlows('full-flow', [validationFlow, processingFlow]);
```

#### `parallel(name, strategy, ...handlers)`

Executes multiple handlers in parallel within a step.

```typescript
import { parallel } from '@celom/flume';

.step('fetchData', parallel(
  'parallelFetch',
  'deep',  // Merge strategy: 'shallow' | 'error-on-conflict' | 'deep'
  async (ctx) => ({ users: await fetchUsers() }),
  async (ctx) => ({ posts: await fetchPosts() }),
  async (ctx) => ({ comments: await fetchComments() }),
))
```

Merge strategies:
- `'shallow'` - Later results override earlier ones (default)
- `'error-on-conflict'` - Throws if same key appears in multiple results
- `'deep'` - Recursively merges objects, concatenates arrays

#### `sequence(name, ...handlers)`

Executes handlers sequentially within a step, accumulating state.

```typescript
import { sequence } from '@celom/flume';

.step('processSequentially', sequence(
  'dataProcessing',
  async (ctx) => ({ step1: await process1(ctx.input) }),
  async (ctx) => ({ step2: await process2(ctx.state.step1) }),
  async (ctx) => ({ step3: await process3(ctx.state.step2) }),
))
```

### Execution Options

```typescript
const result = await flow.execute(input, deps, {
  // Unique ID for tracing across services
  correlationId: 'req-123',

  // Flow-level timeout (checked between steps)
  timeout: 30000,

  // Step-level timeout (uses Promise.race to actually interrupt)
  stepTimeout: 5000,

  // Don't throw on errors, return partial state instead
  throwOnError: false,

  // Observer for logging/metrics
  observer: new DefaultObserver(logger),

  // Error handling configuration
  errorHandling: {
    throwOnMissingDatabase: true,      // Default: true
    throwOnMissingEventPublisher: true, // Default: true
  },
});
```

### Observability

Implement `FlowObserver` to hook into flow execution:

```typescript
import { FlowObserver, DefaultObserver } from '@celom/flume';

const observer: FlowObserver<Input, Deps, State> = {
  onFlowStart: (flowName, input) => {
    console.log(`Starting ${flowName}`);
  },
  onFlowComplete: (flowName, output, duration) => {
    metrics.histogram('flow.duration', duration, { flow: flowName });
  },
  onFlowError: (flowName, error, duration) => {
    logger.error(`Flow ${flowName} failed`, error);
  },
  onFlowBreak: (flowName, stepName, returnValue, duration) => {
    logger.info(`Flow ${flowName} short-circuited at ${stepName}`);
  },
  onStepStart: (stepName, context) => {},
  onStepComplete: (stepName, result, duration, context) => {},
  onStepError: (stepName, error, duration, context) => {},
  onStepRetry: (stepName, attempt, maxAttempts, error) => {},
  onStepSkipped: (stepName, context) => {},
};

// Or use the built-in DefaultObserver
const observer = new DefaultObserver(logger);
```

### Error Types

```typescript
import { ValidationError, FlowExecutionError, TimeoutError } from '@celom/flume';

// Validation errors with structured issues
throw ValidationError.single('email', 'Invalid format', 'bad@');
throw ValidationError.multiple([
  { field: 'email', message: 'Required' },
  { field: 'password', message: 'Too short', value: '123' },
]);

// Access error details
catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues); // [{ field, message, value? }]
    console.log(error.field);  // First field (backward compat)
  }
  if (error instanceof TimeoutError) {
    console.log(error.flowName, error.stepName, error.timeoutMs);
  }
  if (error instanceof FlowExecutionError) {
    console.log(error.flowName, error.stepName, error.originalError);
  }
}
```

## Project Structure

Recommended structure for flows in a service:

```
services/{service}/src/app/flows/
└── {flow-name}/
    ├── index.ts                    # Re-exports
    ├── {flow-name}.flow.ts         # Flow definition
    ├── types.ts                    # Input, Output, Deps types
    ├── steps/
    │   ├── index.ts                # Re-exports all steps
    │   ├── validate-input.step.ts
    │   ├── fetch-data.step.ts
    │   └── process-data.step.ts
    ├── transactions/
    │   └── save-data.transaction.ts
    └── events/
        └── data-processed.event.ts
```

### Step Implementation Pattern

```typescript
// steps/find-account.step.ts
import type { FlowContext } from '@celom/flume';
import type { LoginInput, LoginDeps } from '../types.js';

// Define the state this step expects
type RequiredState = { normalizedEmail: string };

export async function findAccountStep(
  ctx: FlowContext<LoginInput, LoginDeps, RequiredState>,
): Promise<{ account: Account }> {
  const account = await ctx.deps.accountRepo.findByEmail(
    ctx.state.normalizedEmail,
  );

  if (!account) {
    throw new InvalidCredentialsError();
  }

  return { account };
}
```

## Best Practices

1. **Keep steps small and focused** - Each step should do one thing well
2. **Use explicit step names** - Names appear in logs and error messages
3. **Define types for Input, Deps, and Output** - Leverage TypeScript's type inference
4. **Use transactions for related database operations** - Ensure atomicity
5. **Validate early** - Put validation steps at the beginning of flows
6. **Use `breakIf` for early exits** - Avoid unnecessary work
7. **Set timeouts** - Prevent hanging flows in production
8. **Use observers in production** - Track flow execution for debugging

## License

MIT
