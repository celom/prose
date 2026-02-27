export const EXAMPLES: Record<string, string> = {
  'order-processing': `# Order Processing

A complete order processing pipeline with validation, transactions, retries, and events.

\`\`\`typescript
import { createFlow, ValidationError } from '@celom/prose';
import type { DatabaseClient, FlowEventPublisher } from '@celom/prose';

interface OrderInput {
  orderId: string;
  userId: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
}

interface OrderDeps {
  db: DatabaseClient;
  eventPublisher: FlowEventPublisher;
}

const processOrder = createFlow<OrderInput, OrderDeps>('process-order')

  // 1. Validate the order
  .validate('validateOrder', (ctx) => {
    if (ctx.input.items.length === 0)
      throw ValidationError.single('items', 'Order must have at least one item');

    const invalidItems = ctx.input.items.filter((i) => i.quantity <= 0 || i.price <= 0);
    if (invalidItems.length > 0)
      throw ValidationError.multiple(
        invalidItems.map((i) => ({ field: \\\`item.\\\${i.sku}\\\`, message: 'Invalid quantity or price' }))
      );
  })

  // 2. Calculate the total
  .step('calculateTotal', (ctx) => {
    const subtotal = ctx.input.items.reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    );
    const tax = subtotal * 0.08;
    return { subtotal, tax, total: subtotal + tax };
  })

  // 3. Charge payment (with retries for transient failures)
  .step('chargePayment', async (ctx) => {
    const receipt = await payments.charge({
      userId: ctx.input.userId,
      amount: ctx.state.total,
    });
    return { receipt };
  })
  .withRetry({
    maxAttempts: 3,
    delayMs: 500,
    backoffMultiplier: 2,
    shouldRetry: (err) => err.code !== 'CARD_DECLINED',
  })

  // 4. Persist in a database transaction
  .transaction('persistOrder', async (ctx, tx) => {
    const orderId = await tx.insert('orders', {
      id: ctx.input.orderId,
      userId: ctx.input.userId,
      total: ctx.state.total,
      receiptId: ctx.state.receipt.id,
      status: 'confirmed',
    });

    await Promise.all(
      ctx.input.items.map((item) =>
        tx.insert('order_items', { orderId, ...item })
      )
    );

    return { persistedOrderId: orderId };
  })

  // 5. Send confirmation email
  .step('sendConfirmation', async (ctx) => {
    await mailer.send(ctx.input.userId, {
      template: 'order-confirmed',
      orderId: ctx.state.persistedOrderId,
      total: ctx.state.total,
    });
  })

  // 6. Publish domain events
  .event('orders', (ctx) => ({
    eventType: 'order.confirmed',
    orderId: ctx.state.persistedOrderId,
    userId: ctx.input.userId,
    total: ctx.state.total,
  }))

  // 7. Shape the output
  .map((input, state) => ({
    orderId: state.persistedOrderId,
    total: state.total,
    receiptId: state.receipt.id,
    status: 'confirmed' as const,
  }))
  .build();
\`\`\`

## Running the flow

\`\`\`typescript
import { PinoFlowObserver } from '@celom/prose';

const result = await processOrder.execute(
  {
    orderId: 'ord_abc123',
    userId: 'user_42',
    items: [
      { sku: 'WIDGET-A', quantity: 2, price: 29.99 },
      { sku: 'GADGET-B', quantity: 1, price: 49.99 },
    ],
  },
  { db, eventPublisher },
  {
    timeout: 30_000,
    observer: new PinoFlowObserver(logger),
  }
);

// result: { orderId: string; total: number; receiptId: string; status: 'confirmed' }
\`\`\`

## Demonstrates

- **Validation** — fail fast before doing any work
- **State threading** — total, receipt, and persistedOrderId flow through with full type safety
- **Retries** — payment charging retries transient errors but not card declines
- **Transactions** — order and items are persisted atomically
- **Events** — domain event published with automatic correlationId
- **Output mapping** — .map() shapes the result to exactly what the caller needs
- **Observability** — Pino observer provides structured logging for every step`,

  'user-onboarding': `# User Onboarding

A user onboarding flow with validation, retries, conditional steps, and event publishing.

\`\`\`typescript
import { createFlow, ValidationError } from '@celom/prose';

interface OnboardInput {
  email: string;
  name: string;
  phone?: string;
}

const onboardUser = createFlow<OnboardInput>('onboard-user')

  // 1. Validate email format
  .validate('checkEmail', (ctx) => {
    if (!ctx.input.email.includes('@'))
      throw ValidationError.single('email', 'Invalid email address');
  })

  // 2. Check if user already exists — break early if so
  .step('checkExisting', async (ctx) => {
    const existing = await db.findByEmail(ctx.input.email);
    return { existing };
  })
  .breakIf(
    (ctx) => ctx.state.existing != null,
    (ctx) => ({ user: ctx.state.existing, created: false })
  )

  // 3. Create the account (with retry for transient DB errors)
  .step('createAccount', async (ctx) => {
    const user = await db.createUser({
      email: ctx.input.email,
      name: ctx.input.name,
    });
    return { user };
  })
  .withRetry({ maxAttempts: 3, delayMs: 200, backoffMultiplier: 2 })

  // 4. Send welcome email
  .step('sendWelcome', async (ctx) => {
    await mailer.send(ctx.state.user.email, {
      template: 'welcome',
      name: ctx.state.user.name,
    });
  })

  // 5. Optionally send SMS if phone number provided
  .stepIf(
    'sendSms',
    (ctx) => ctx.input.phone != null,
    async (ctx) => {
      await sms.send(ctx.input.phone!, 'Welcome!');
      return { smsSent: true };
    }
  )

  // 6. Publish domain event
  .event('users', (ctx) => ({
    eventType: 'user.onboarded',
    userId: ctx.state.user.id,
    email: ctx.input.email,
  }))

  // 7. Shape output
  .map((input, state) => ({ user: state.user, created: true }))
  .build();
\`\`\`

## Running the flow

\`\`\`typescript
const result = await onboardUser.execute(
  { email: 'alice@example.com', name: 'Alice', phone: '+1234567890' },
  { db, eventPublisher },
  {
    observer: {
      onStepSkipped: (name) => console.log('Skipped:', name),
      onFlowBreak: (name, step) => console.log('Early exit at:', step),
    },
  }
);

// result: { user: User; created: true } | { user: User; created: false }
\`\`\`

## Demonstrates

- **Validation** — email check runs first and is never retried
- **Early exit** — breakIf returns the existing user without running creation steps
- **Conditional steps** — SMS is only sent when a phone number is provided
- **Retries** — account creation retries transient database errors
- **Events** — domain event enriched with correlationId
- **Type-safe output** — return type is a union reflecting both paths`,
};

export const EXAMPLE_NAMES = Object.keys(EXAMPLES);
