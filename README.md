# Flume

Declarative workflow DSL for orchestrating complex business operations in Javascript/Typescript.

```typescript
const flow = createFlow<{ orderId: string }>('process-order')
  .validate('checkInput', (ctx) => { /* ... */ })
  .step('fetchOrder', async (ctx) => { /* ... */ })
  .step('chargePayment', async (ctx) => { /* ... */ })
  .withRetry({ maxAttempts: 3, delayMs: 200, backoffMultiplier: 2 })
  .event('orders', (ctx) => ({ eventType: 'order.charged', orderId: ctx.state.order.id }))
  .build();

await flow.execute({ orderId: 'ord_123' }, { db, eventPublisher });
```

Type-safe state threading, retries with exponential backoff, timeouts, database transactions, event publishing, parallel execution, and observability hooks — using plain async/await with zero dependencies.

## Packages

| Package | Description |
|---------|-------------|
| [`@celom/flume`](packages/flume/) | Core workflow library |

## Development

This is an [Nx](https://nx.dev) monorepo.

```bash
# install dependencies
bun install

# run tests
bun nx test flume

# build
bun nx build flume
```

## License

MIT
