import { FlowBuilder } from './flow-builder.js';
import { FlowExecutor } from './flow-executor.js';
import { BaseFlowDependencies, FlowConfig, FlowContext, FlowDefinition, FlowState, StepDefinition } from './types.js';
import { deepMerge } from './utils.js';

/**
 * Create a new flow with the given name
 */
export function createFlow<TInput, TDeps extends BaseFlowDependencies = never>(
  name: string,
) {
  return new FlowBuilder<TInput, TDeps, Record<string, never>>(name);
}

/**
 * Helper to compose multiple flows into a single flow
 *
 * IMPORTANT: This function assumes all flows share a compatible state type.
 * Type safety cannot guarantee correctness if flows use different TState shapes.
 * Ensure that all composed flows operate on compatible state structures.
 *
 * @param name - Name for the composed flow
 * @param flows - Array of flow definitions to compose
 * @returns A new flow definition containing all steps from all flows
 */
export function composeFlows<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState = Record<string, unknown>,
>(
  name: string,
  flows: Array<FlowDefinition<TInput, TDeps, TState>>,
): FlowDefinition<TInput, TDeps, TState> {
  // Validation
  if (!flows || flows.length === 0) {
    throw new Error('composeFlows requires at least one flow');
  }

  // Warn about potential step name conflicts
  const allStepNames = new Set<string>();
  const duplicates: string[] = [];

  for (const flow of flows) {
    for (const step of flow.steps) {
      if (allStepNames.has(step.name)) {
        duplicates.push(step.name);
      }
      allStepNames.add(step.name);
    }
  }

  if (duplicates.length > 0) {
    console.warn(
      `[Workflow:${name}] Warning: Duplicate step names found in composed flow: ${duplicates.join(', ')}. ` +
      `This may cause unexpected behavior in observers and debugging.`,
    );
  }

  const executor = new FlowExecutor<TInput, TDeps, TState>();

  // Combine all steps from all flows
  const allSteps: StepDefinition<TInput, TDeps, TState>[] = [];

  for (const flow of flows) {
    allSteps.push(...flow.steps);
  }

  // Create immutable config
  const config: FlowConfig<TInput, TDeps, TState> = {
    name,
    steps: allSteps,
  };

  return {
    name: config.name,
    steps: config.steps,
    execute: async (input, deps, options) => {
      const result = await executor.execute(config, input, deps, options);
      return result.value;
    },
  };
}

/**
 * Merge strategy for parallel execution
 * - 'shallow': Default - later results override earlier ones (silent overwrites)
 * - 'error-on-conflict': Throw error if keys conflict between results
 * - 'deep': Perform deep merge of nested objects
 */
export type MergeStrategy = 'shallow' | 'error-on-conflict' | 'deep';

/**
 * Helper to create a parallel execution flow
 *
 * @param name - Name for the parallel step (for debugging)
 * @param strategy - Merge strategy for combining results (default: 'shallow')
 * @param handlers - Array of step handlers to execute in parallel
 * @returns A step handler that executes all handlers concurrently
 */
export function parallel<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState = Record<string, never>,
>(
  name: string,
  strategy: MergeStrategy = 'shallow',
  ...handlers: Array<
    (ctx: FlowContext<TInput, TDeps, TState>) => unknown | Promise<unknown>
  >
): (ctx: FlowContext<TInput, TDeps, TState>) => Promise<unknown> {
  return async (ctx: FlowContext<TInput, TDeps, TState>) => {
    const results = await Promise.all(handlers.map((handler) => handler(ctx)));

    if (strategy === 'error-on-conflict') {
      // Detect key conflicts
      const allKeys = new Set<string>();
      for (const result of results) {
        if (result && typeof result === 'object') {
          for (const key in result) {
            if (allKeys.has(key)) {
              throw new Error(
                `[Workflow:${name}] Key conflict detected in parallel merge: '${key}'`,
              );
            }
            allKeys.add(key);
          }
        }
      }
      // Shallow merge after validation
      return Object.assign({}, ...results);
    }

    if (strategy === 'deep') {
      // Deep merge objects recursively
      return deepMerge(
        {},
        ...(results as Array<Record<string, unknown> | null | undefined>),
      );
    }

    // Default shallow merge - later results override earlier ones
    return Object.assign({}, ...results);
  };
}

/**
 * Helper to create a sequential sub-flow within a step
 *
 * Executes handlers sequentially, accumulating state changes.
 * Returns only the keys that were added or modified (shallow comparison).
 *
 * @param name - Name for the sequence step (for debugging)
 * @param handlers - Array of step handlers to execute sequentially
 * @returns A step handler that executes all handlers in sequence
 */
export function sequence<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState = Record<string, never>,
>(
  name: string,
  ...handlers: Array<
    (ctx: FlowContext<TInput, TDeps, TState>) => unknown | Promise<unknown>
  >
): (ctx: FlowContext<TInput, TDeps, TState>) => Promise<unknown> {
  return async (ctx: FlowContext<TInput, TDeps, TState>) => {
    let state = ctx.state;

    for (const handler of handlers) {
      const result = await handler({
        ...ctx,
        state,
      });

      if (result && typeof result === 'object') {
        state = { ...state, ...result };
      }
    }

    // Compute shallow diff: keys that are new or changed
    const stateDiff: FlowState = {};
    for (const key in state) {
      if (!(key in ctx.state) || ctx.state[key] !== state[key]) {
        stateDiff[key] = state[key];
      }
    }

    return stateDiff;
  };
}
