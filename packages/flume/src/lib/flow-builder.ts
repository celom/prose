import type {
  FlowContext,
  FlowConfig,
  FlowDefinition,
  StepDefinition,
  StepCondition,
  RetryOptions,
  FlowState,
  BaseFlowDependencies,
  FlowEvent,
  MergeStrategy,
} from './types.js';
import { FlowExecutor } from './flow-executor.js';
import { deepMerge } from './utils.js';

type StepNode<T> = { readonly head: T; readonly tail: StepNode<T> | null };

/**
 * Converts a union type to an intersection type.
 * Used to merge return types from parallel/sequence handlers.
 */
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Create a new flow with the given name
 */
export function createFlow<TInput, TDeps extends BaseFlowDependencies = never>(
  name: string,
) {
  return new FlowBuilder<TInput, TDeps, Record<string, never>>(name);
}

/**
 * FlowBuilder provides a fluent API for creating declarative workflows
 */
export class FlowBuilder<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
  TMapperOutput = never,
  TBreakOutputs = never,
> {
  private steps: StepNode<StepDefinition<TInput, TDeps, TState>> | null;
  private length: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private outputMapper?: (input: TInput, state: TState) => any; // Requires "any" for proper output inference

  constructor(
    private name: string,
    steps: StepNode<StepDefinition<TInput, TDeps, TState>> | null = null,
    length: number = 0,
    mapper?: (input: TInput, state: TState) => TMapperOutput,
  ) {
    this.steps = steps;
    this.length = length;
    if (mapper) {
      this.outputMapper = mapper;
    }
  }

  // Convert linked list of steps to an array for easier processing
  private toArray(): StepDefinition<TInput, TDeps, TState>[] {
    const arr = new Array<StepDefinition<TInput, TDeps, TState>>(this.length);
    let current = this.steps;
    for (let i = this.length - 1; i >= 0; i--) {
      arr[i] = current!.head;
      current = current!.tail;
    }
    return arr;
  }

  /**
   * Add a validation step
   */
  validate(
    name: string,
    handler: (ctx: FlowContext<TInput, TDeps, TState>) => void | Promise<void>,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { name, type: 'validate', handler }, tail: this.steps },
      this.length + 1,
    );
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
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { name, type: 'step', handler, retryOptions }, tail: this.steps },
      this.length + 1,
    );
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
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { name, type: 'step', handler, condition, retryOptions }, tail: this.steps },
      this.length + 1,
    );
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
  ): FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TResult & TState, TMapperOutput, TBreakOutputs>(
      this.name,
      {
        head: { name, type: 'transaction', handler }, tail: this.steps
      },
      this.length + 1,
    );
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
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { name, type: 'event', channel, handler: builder }, tail: this.steps },
      this.length + 1,
    );
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
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs> {
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

    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { name, type: 'event', channel, handler: combinedBuilder }, tail: this.steps },
      this.length + 1,
    );
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
  breakIf(
    condition: (ctx: FlowContext<TInput, TDeps, TState>) => boolean,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs | TState>;
  breakIf<TBreakOutput>(
    condition: (ctx: FlowContext<TInput, TDeps, TState>) => boolean,
    returnValue: (ctx: FlowContext<TInput, TDeps, TState>) => TBreakOutput,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs | TBreakOutput>;
  breakIf<TBreakOutput>(
    condition: (ctx: FlowContext<TInput, TDeps, TState>) => boolean,
    returnValue?: (ctx: FlowContext<TInput, TDeps, TState>) => TBreakOutput,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs | TBreakOutput | TState> {
    const stepName = `break_${this.length}`;

    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs | TBreakOutput | TState>(
      this.name,
      { head: { name: stepName, type: 'break', breakCondition: condition, breakReturnValue: returnValue }, tail: this.steps },
      this.length + 1,
      this.outputMapper,
    );
  }

  /**
   * Add a retry configuration to the last step
   */
  withRetry(
    options: RetryOptions,
  ): FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs> {
    if (this.steps === null) {
      return this;
    }

    return new FlowBuilder<TInput, TDeps, TState, TMapperOutput, TBreakOutputs>(
      this.name,
      { head: { ...this.steps.head, retryOptions: options }, tail: this.steps.tail },
      this.length,
      this.outputMapper,
    );
  }

  /**
   * Add a parallel execution step that runs multiple handlers concurrently
   * and merges their results into the flow state.
   *
   * @example
   * .parallel('fetchAll', 'shallow',
   *   (ctx) => ({ users: fetchUsers(ctx.input.orgId) }),
   *   (ctx) => ({ posts: fetchPosts(ctx.input.orgId) }),
   * )
   */
  parallel<TResults extends object[]>(
    name: string,
    strategy: MergeStrategy,
    ...handlers: {
      [K in keyof TResults]: (
        ctx: FlowContext<TInput, TDeps, TState>,
      ) => TResults[K] | Promise<TResults[K]>;
    }
  ): FlowBuilder<
    TInput,
    TDeps,
    UnionToIntersection<TResults[number]> & TState,
    TMapperOutput,
    TBreakOutputs
  > {
    type TMerged = UnionToIntersection<TResults[number]>;

    const handler = async (
      ctx: FlowContext<TInput, TDeps, TState>,
    ): Promise<TMerged> => {
      const results = await Promise.all(
        handlers.map((h) => h(ctx)),
      );

      if (strategy === 'error-on-conflict') {
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
        return Object.assign({}, ...results);
      }

      if (strategy === 'deep') {
        return deepMerge(
          {},
          ...(results as Array<Record<string, unknown> | null | undefined>),
        ) as TMerged;
      }

      return Object.assign({}, ...results);
    };

    return new FlowBuilder<
      TInput,
      TDeps,
      TMerged & TState,
      TMapperOutput,
      TBreakOutputs
    >(
      this.name,
      {
        head: { name, type: 'step', handler },
        tail: this.steps,
      },
      this.length + 1,
    );
  }

  /**
   * Apply a builder-to-builder transformation, enabling reusable sub-flows.
   *
   * @example
   * function withAuth(builder) {
   *   return builder
   *     .step('validateToken', ...)
   *     .step('loadUser', ...);
   * }
   *
   * createFlow('order')
   *   .pipe(withAuth)
   *   .step('createOrder', ...)
   *   .build();
   */
  pipe<R>(fn: (builder: this) => R): R {
    return fn(this);
  }

  /**
   * Transform the accumulated state into the final output
   */
  map<TNewOutput>(
    mapper: (input: TInput, state: TState) => TNewOutput,
  ): FlowBuilder<TInput, TDeps, TState, TNewOutput, TBreakOutputs> {
    return new FlowBuilder<TInput, TDeps, TState, TNewOutput, TBreakOutputs>(
      this.name,
      this.steps,
      this.length,
      mapper,
    );
  }

  /**
   * Build the flow definition
   */
  build(): FlowDefinition<TInput, TDeps, TState, TMapperOutput, TBreakOutputs> {
    const steps = this.toArray();

    // Validate step name uniqueness
    const stepNames = new Set<string>();
    const duplicates: string[] = [];

    for (const step of steps) {
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

    const config: FlowConfig<TInput, TDeps, TState> = {
      name: this.name,
      steps,
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
