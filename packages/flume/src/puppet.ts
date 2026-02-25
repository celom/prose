/**
 * Type inference smoke test for FlowBuilder's cons-list internals.
 * This file is NOT meant to be executed — only type-checked.
 *
 * Run: npx tsc --noEmit --project packages/flume/tsconfig.lib.json
 */

import { createFlow } from './lib/flow-factories.js';
import type { BaseFlowDependencies } from './lib/types.js';

// ── Setup ────────────────────────────────────────────────

interface OrderInput {
  orderId: string;
  userId: string;
  amount: number;
}

interface OrderDeps extends BaseFlowDependencies {
  paymentGateway: { charge(amount: number): Promise<{ transactionId: string }> };
}

// ── Flow definition ──────────────────────────────────────

const orderFlow = createFlow<OrderInput, OrderDeps>('processOrder')
  .validate('checkAmount', (ctx) => {
    // ctx.input should be OrderInput
    void (ctx.input.amount satisfies number);
    void (ctx.input.orderId satisfies string);

    if (ctx.input.amount <= 0) throw new Error('Invalid amount');
  })
  .step('loadUser', (ctx) => {
    return { user: { id: ctx.input.userId, name: 'Alice' } };
  })
  .step('chargePayment', async (ctx) => {
    // State should now include { user: ... } from prior step
    void (ctx.state.user.name satisfies string);

    const receipt = await ctx.deps.paymentGateway.charge(ctx.input.amount);
    return { transactionId: receipt.transactionId };
  })
  .stepIf(
    'applyDiscount',
    (ctx) => ctx.input.amount > 100,
    (ctx) => {
      // Should see user AND transactionId on state
      void (ctx.state.transactionId satisfies string);
      void (ctx.state.user satisfies { id: string; name: string });
      return { discountApplied: true as const };
    },
  )
  .map((input, state) => {
    // State should have user, transactionId, and discountApplied
    return {
      orderId: input.orderId,
      transactionId: state.transactionId,
      discountApplied: state.discountApplied,
      customerName: state.user.name,
    };
  })
  .build();

// ── Branching from a shared base ─────────────────────────

const base = createFlow<{ x: number }, never>('branching')
  .step('double', (ctx) => ({ doubled: ctx.input.x * 2 }));

const branchA = base
  .step('addTen', (ctx) => {
    void (ctx.state.doubled satisfies number);
    return { result: ctx.state.doubled + 10 };
  })
  .build();

const branchB = base
  .step('negate', (ctx) => {
    void (ctx.state.doubled satisfies number);
    return { result: -ctx.state.doubled };
  })
  .build();

// ── Verify output types ──────────────────────────────────

async function _typeAssertions() {
  const orderResult = await orderFlow.execute(
    { orderId: '1', userId: 'u1', amount: 50 },
    { paymentGateway: { charge: async () => ({ transactionId: 'tx1' }) } },
  );
  void (orderResult.orderId satisfies string);
  void (orderResult.transactionId satisfies string);
  void (orderResult.discountApplied satisfies true);
  void (orderResult.customerName satisfies string);

  const resultA = await branchA.execute({ x: 5 }, undefined as never);
  void (resultA.result satisfies number);
  void (resultA.doubled satisfies number);

  const resultB = await branchB.execute({ x: 5 }, undefined as never);
  void (resultB.result satisfies number);
  void (resultB.doubled satisfies number);
}

void orderFlow;
void branchA;
void branchB;
void _typeAssertions;
