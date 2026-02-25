/**
 * FlowBuilder provides a fluent API for creating declarative workflows
 */

import type {
  FlowContext,
  FlowConfig,
  FlowDefinition,
  StepDefinition,
  StepCondition,
  RetryOptions,
  FlowState,
  BaseFlowDependencies,
  BreakStepDefinition,
  FlowEvent,
} from './types.js';
import { FlowExecutor } from './flow-executor.js';

export class FlowBuilder<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
  TMapperOutput = never,
> {
  private steps: StepDefinition<TInput, TDeps, TState>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private outputMapper?: (input: TInput, state: TState) => any; // Requires "any" for proper output inference

  constructor(
    private name: string,
    steps?: StepDefinition<TInput, TDeps, TState>[],
    mapper?: (input: TInput, state: TState) => TMapperOutput,
  ) {
    if (steps) {
      this.steps = steps;
    }
    if (mapper) {
      this.outputMapper = mapper;
    }
  }

  /**
   * Add a validation step
   */
  validate(
    name: string,
    handler: (ctx: FlowContext<TInput, TDeps, TState>) => void | Promise<void>,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput> {
    const next = new FlowBuilder<TInput, TDeps, TState, TMapperOutput>(
      this.name,
      [
        ...this.steps,
        {
          name,
          type: 'validate',
          handler,
        },
      ],
    );

    return next;
  }

  /**
   * Add a regular step that can return state to merge
   */
  step<TResult extends object>(
    name: string,
    handler: (
      ctx: FlowContext<TInput, TDeps, TState>,
    ) => TResult | void | undefined | Promise<TResult | void | undefined>,
    retryOptions?: RetryOptions,
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput> {
    const next = new FlowBuilder<
      TInput,
      TDeps,
      TResult & TState,
      TMapperOutput
    >(this.name, [
      ...this.steps,
      {
        name,
        type: 'step',
        handler,
        retryOptions,
      },
    ]);

    return next;
  }

  /**
   * Add a conditional step that only executes if condition is met
   */
  stepIf<TResult extends object>(
    name: string,
    condition: StepCondition<TInput, TDeps, TState>,
    handler: (
      ctx: FlowContext<TInput, TDeps, TState>,
    ) => TResult | void | undefined | Promise<TResult | void | undefined>,
    retryOptions?: RetryOptions,
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput> {
    const next = new FlowBuilder<
      TInput,
      TDeps,
      TResult & TState,
      TMapperOutput
    >(this.name, [
      ...this.steps,
      {
        name,
        type: 'step',
        handler,
        condition,
        retryOptions,
      },
    ]);

    return next;
  }

  /**
   * Add a transaction step for database operations
   */
  transaction<TResult extends object>(
    name: string,
    handler: (
      ctx: FlowContext<TInput, TDeps, TState>,
      tx: unknown,
    ) => TResult | Promise<TResult>,
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput> {
    const next = new FlowBuilder<
      TInput,
      TDeps,
      TResult & TState,
      TMapperOutput
    >(this.name, [
      ...this.steps,
      {
        name,
        type: 'transaction',
        handler,
      },
    ]);

    return next;
  }

  /**
   * Add an event publishing step with explicit channel
   */
  event(
    channel: string,
    builder: (
      ctx: FlowContext<TInput, TDeps, TState>,
    ) =>
      | FlowEvent
      | FlowEvent[]
      | void
      | Promise<FlowEvent | FlowEvent[] | void>,
    name: string = 'publishEvent',
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput> {
    const next = new FlowBuilder<TInput, TDeps, TState, TMapperOutput>(
      this.name,
      [
        ...this.steps,
        {
          name,
          type: 'event',
          channel,
          handler: builder,
        },
      ],
    );

    return next;
  }

  /**
   * Add multiple events to publish to the same channel
   */
  events(
    channel: string,
    builders: Array<
      (
        ctx: FlowContext<TInput, TDeps, TState>,
      ) =>
        | FlowEvent
        | FlowEvent[]
        | void
        | Promise<FlowEvent | FlowEvent[] | void>
    >,
    name: string = 'publishEvents',
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput> {
    const combinedBuilder = async (ctx: FlowContext<TInput, TDeps, TState>) => {
      const events: FlowEvent[] = [];
      for (const builder of builders) {
        const result = await builder(ctx);
        if (result) {
          if (Array.isArray(result)) {
            events.push(...result);
          } else {
            events.push(result);
          }
        }
      }
      return events.length > 0 ? events : undefined;
    };

    const next = new FlowBuilder<TInput, TDeps, TState, TMapperOutput>(
      this.name,
      [
        ...this.steps,
        {
          name,
          type: 'event',
          channel,
          handler: combinedBuilder,
        },
      ],
    );

    return next;
  }

  /**
   * Add a break condition that short-circuits the flow if met.
   * When the condition returns true, the flow stops and returns the value
   * from the returnValue function (or the accumulated state if not provided).
   *
   * @param condition - Function that returns true to break the flow
   * @param returnValue - Optional function to compute the return value when breaking
   * @returns New FlowBuilder with break step added
   *
   * @example
   * .step('validateToken', validateVerificationTokenStep)
   * .breakIf(
   *   (ctx) => ctx.state.alreadyVerified,
   *   (ctx) => ({ success: true, alreadyVerified: true })
   * )
   * .step('getAccount', getAccountStep)  // Only runs if not already verified
   */
  breakIf<TBreakOutput>(
    condition: (ctx: FlowContext<TInput, TDeps, TState>) => boolean,
    returnValue?: (ctx: FlowContext<TInput, TDeps, TState>) => TBreakOutput,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput> {
    const stepName = `break_${this.steps.length}`;

    const next = new FlowBuilder<TInput, TDeps, TState, TMapperOutput>(
      this.name,
      [
        ...this.steps,
        {
          name: stepName,
          type: 'break',
          breakCondition: condition,
          breakReturnValue: returnValue,
        },
      ],
      this.outputMapper,
    );

    return next;
  }

  /**
   * Add a retry configuration to the last step
   */
  withRetry(
    options: RetryOptions,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput> {
    if (this.steps.length === 0) {
      return this;
    }

    const newSteps = this.steps.slice(0, -1).concat([
      {
        ...this.steps[this.steps.length - 1],
        retryOptions: options,
      },
    ]);

    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput>(
      this.name,
      newSteps,
      this.outputMapper,
    );
  }

  /**
   * Transform the accumulated state into the final output
   */
  map<TNewOutput>(
    mapper: (input: TInput, state: TState) => TNewOutput,
  ): FlowBuilder<TInput, TDeps, TState, TNewOutput> {
    return new FlowBuilder<TInput, TDeps, TState, TNewOutput>(
      this.name,
      [...this.steps],
      mapper,
    );
  }

  /**
   * Build the flow definition
   */
  build(): FlowDefinition<TInput, TDeps, TState, TMapperOutput> {
    // Validate step name uniqueness
    const stepNames = new Set<string>();
    const duplicates: string[] = [];

    for (const step of this.steps) {
      if (stepNames.has(step.name)) {
        duplicates.push(step.name);
      }
      stepNames.add(step.name);
    }

    if (duplicates.length > 0) {
      throw new Error(
        `Flow '${this.name}' has duplicate step names: ${duplicates.join(', ')}. ` +
        `Each step must have a unique name for proper debugging and observability.`,
      );
    }

    const executor = new FlowExecutor<TInput, TDeps, TState>();

    // Create immutable config
    const config: FlowConfig<TInput, TDeps, TState> = {
      name: this.name,
      steps: [...this.steps],
    };

    const mapper = this.outputMapper;

    return {
      name: config.name,
      steps: config.steps,
      execute: async (input, deps, options) => {
        const result = await executor.execute(config, input, deps, options);

        // If flow was short-circuited via breakIf, return break value directly (bypass mapper)
        if (result.didBreak) {
          return result.value;
        }

        // Normal completion - apply mapper if present
        return mapper ? mapper(input, result.value) : result.value;
      },
    };
  }
}

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
 * Check if a value is a plain object (not array, Date, Map, Set, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge utility for combining objects recursively.
 * - Plain objects are merged recursively
 * - Arrays are concatenated (not overwritten)
 * - Non-plain objects (Date, Map, Set, etc.) are treated as primitives
 */
function deepMerge(
  ...objects: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    if (!isPlainObject(obj)) continue;

    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

      const existingVal = result[key];
      const newVal = obj[key];

      if (Array.isArray(newVal)) {
        // Arrays: concatenate with existing array or create new array
        if (Array.isArray(existingVal)) {
          result[key] = [...existingVal, ...newVal];
        } else {
          result[key] = [...newVal];
        }
      } else if (isPlainObject(newVal)) {
        // Plain objects: recursively merge
        if (isPlainObject(existingVal)) {
          result[key] = deepMerge(existingVal, newVal);
        } else {
          result[key] = deepMerge({}, newVal);
        }
      } else {
        // Primitives and non-plain objects: overwrite
        result[key] = newVal;
      }
    }
  }

  return result;
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
