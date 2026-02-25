/**
 * FlowExecutor handles the actual execution of workflow steps
 */

import { ValidationError, FlowExecutionError, TimeoutError } from './types.js';
import type {
  FlowContext,
  FlowConfig,
  FlowExecutionOptions,
  FlowMeta,
  StepDefinition,
  RetryOptions,
  FlowState,
  BaseFlowDependencies,
  TransactionStepDefinition,
  EventStepDefinition,
  BreakStepDefinition,
  FlowExecutionResult,
  FlowEvent,
  FlowEventPublisher,
} from './types.js';

/**
 * Wraps a promise with a timeout using Promise.race
 * This actually interrupts the wait (though the underlying operation may continue)
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(errorFactory()), timeoutMs);
    }),
  ]);
}

export class FlowExecutor<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState = Record<string, unknown>,
> {
  /**
   * Execute a complete flow from configuration
   * @returns FlowExecutionResult containing the result value and whether flow was short-circuited
   */
  async execute(
    config: FlowConfig<TInput, TDeps, TState>,
    input: TInput,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ): Promise<FlowExecutionResult<TState>> {
    const startTime = Date.now();
    const meta: FlowMeta = {
      flowName: config.name,
      startedAt: new Date(startTime),
      correlationId: options?.correlationId,
    };

    const observer = options?.observer;

    // Initialize context
    let context: FlowContext<TInput, TDeps, TState> = {
      input: Object.freeze(input),
      state: {} as TState,
      deps,
      meta,
    };

    // Notify observer of flow start
    observer?.onFlowStart?.(config.name, input);

    try {
      // Execute each step in sequence
      for (const step of config.steps) {
        // Check flow-level timeout if configured (pre-step check)
        if (options?.timeout) {
          const elapsed = Date.now() - startTime;
          if (elapsed > options.timeout) {
            throw new TimeoutError(
              `Flow execution timeout after ${elapsed}ms (limit: ${options.timeout}ms)`,
              config.name,
              step.name,
              options.timeout,
            );
          }
        }

        // Update current step in meta
        context.meta.currentStep = step.name;

        // Check condition if present
        if (step.condition && !step.condition(context)) {
          observer?.onStepSkipped?.(step.name, context);
          continue; // Skip this step
        }

        // Handle break step type - short-circuits the flow if condition is met
        if (step.type === 'break') {
          const breakStep = step;
          const stepStart = Date.now();

          observer?.onStepStart?.(step.name, context);

          if (breakStep.breakCondition(context)) {
            // Flow is breaking - compute return value
            const breakResult = breakStep.breakReturnValue
              ? breakStep.breakReturnValue(context)
              : context.state;

            const duration = Date.now() - stepStart;
            const totalDuration = Date.now() - startTime;

            // Notify observers
            observer?.onStepComplete?.(step.name, breakResult, duration, context);
            observer?.onFlowBreak?.(
              config.name,
              step.name,
              breakResult,
              totalDuration,
            );

            // Return early, bypassing remaining steps and .map()
            return { value: breakResult as TState, didBreak: true };
          }

          // Condition not met - continue to next step
          const duration = Date.now() - stepStart;
          observer?.onStepComplete?.(
            step.name,
            { __breakConditionMet: false },
            duration,
            context,
          );
          continue;
        }

        // Execute step based on type
        const result = await this.executeStep(step, context, deps, options);

        // Merge result into state if applicable
        if (result && typeof result === 'object' && step.type !== 'event') {
          context = {
            ...context,
            state: { ...context.state, ...result },
          };
        }
      }

      // Return the final state as output
      const totalDuration = Date.now() - startTime;
      observer?.onFlowComplete?.(config.name, context.state, totalDuration);

      return { value: context.state, didBreak: false };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      observer?.onFlowError?.(config.name, error as Error, totalDuration);

      // If the caller wants no exception, return the partial state
      if (options?.throwOnError === false) {
        return { value: context.state, didBreak: false };
      }

      // By default, re-throw the original error
      throw error;
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) {
    const retryOptions = step.retryOptions;

    if (retryOptions) {
      return this.executeWithRetry(step, context, deps, retryOptions, options);
    }

    return this.executeSingleStep(step, context, deps, options);
  }

  /**
   * Execute a step with retry logic
   */
  private async executeWithRetry(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    retryOptions: RetryOptions,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) {
    const observer = options?.observer;
    let lastError: Error | undefined;
    let delay = retryOptions.delayMs;

    for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt++) {
      try {
        return await this.executeSingleStep(step, context, deps, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (retryOptions.shouldRetry && !retryOptions.shouldRetry(lastError)) {
          throw lastError;
        }

        // Don't retry on validation errors
        if (lastError instanceof ValidationError) {
          throw lastError;
        }

        // If this was the last attempt, throw
        if (attempt === retryOptions.maxAttempts) {
          throw lastError;
        }

        // Notify observer of retry
        observer?.onStepRetry?.(
          step.name,
          attempt,
          retryOptions.maxAttempts,
          lastError,
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Calculate next delay with backoff
        if (retryOptions.backoffMultiplier) {
          delay = Math.min(
            delay * retryOptions.backoffMultiplier,
            retryOptions.maxDelayMs || Number.MAX_SAFE_INTEGER,
          );
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute a single step without retry
   */
  private async executeSingleStep(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) {
    const observer = options?.observer;
    const stepStart = Date.now();
    const stepTimeout = step.retryOptions?.stepTimeout ?? options?.stepTimeout;

    // Notify observer of step start
    observer?.onStepStart?.(step.name, context);

    try {
      let result;

      // Create the step execution promise
      const executeStep = async () => {
        switch (step.type) {
          case 'validate': {
            await step.handler(context);
            return undefined;
          }

          case 'step': {
            return await step.handler(context);
          }

          case 'transaction': {
            return await this.executeTransaction(step, context, deps, options);
          }

          case 'event': {
            return await this.executeEvent(step, context, options);
          }

          default: {
            throw new FlowExecutionError(
              `Unknown step type`,
              context.meta.flowName,
            );
          }
        }
      };

      // Execute with timeout if configured
      if (stepTimeout) {
        result = await withTimeout(
          executeStep(),
          stepTimeout,
          () =>
            new TimeoutError(
              `Step '${step.name}' timed out after ${stepTimeout}ms`,
              context.meta.flowName,
              step.name,
              stepTimeout,
            ),
        );
      } else {
        result = await executeStep();
      }

      // Notify observer of step completion
      const duration = Date.now() - stepStart;
      observer?.onStepComplete?.(step.name, result, duration, context);

      return result;
    } catch (error) {
      // Notify observer of step error
      const duration = Date.now() - stepStart;
      observer?.onStepError?.(step.name, error as Error, duration, context);

      throw error;
    }
  }

  /**
   * Execute a transaction step
   */
  private async executeTransaction(
    step: TransactionStepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) {
    // Get database instance from deps
    const db = deps.db;

    if (!db) {
      const shouldThrow =
        options?.errorHandling?.throwOnMissingDatabase ?? true;
      const message = `No database found in dependencies for transaction`;

      if (shouldThrow) {
        throw new FlowExecutionError(message, context.meta.flowName, step.name);
      } else {
        console.warn(`[Workflow:${context.meta.flowName}] ${message}`);
        return undefined;
      }
    }

    // Execute within transaction using the DatabaseClient interface
    return await db.transaction(async (tx) => {
      return await step.handler(context, tx);
    });
  }

  /**
   * Execute an event publishing step
   */
  private async executeEvent(
    step: EventStepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ): Promise<void> {
    // Get event publisher from deps
    const eventPublisher = context.deps.eventPublisher;

    if (!eventPublisher) {
      const shouldThrow =
        options?.errorHandling?.throwOnMissingEventPublisher ?? true;
      const message = `No event publisher found in dependencies`;

      if (shouldThrow) {
        throw new FlowExecutionError(message, context.meta.flowName, step.name);
      } else {
        console.warn(`[Workflow:${context.meta.flowName}] ${message}`);
        return;
      }
    }

    // Validate publisher has required method
    if (typeof eventPublisher.publish !== 'function') {
      throw new FlowExecutionError(
        'Event publisher must have publish() method',
        context.meta.flowName,
        step.name,
      );
    }

    // Build events
    const events = await step.handler(context);

    if (!events) {
      return;
    }

    // Publish events to the explicit channel
    const eventsArray = Array.isArray(events) ? events : [events];

    for (const event of eventsArray) {
      if (event && event.eventType) {
        await this.publishEvent(eventPublisher, event, step.channel, context);
      }
    }
  }

  /**
   * Publish a single event to a specific channel
   */
  private async publishEvent(
    publisher: FlowEventPublisher,
    event: FlowEvent,
    channel: string,
    context: FlowContext<TInput, TDeps, TState>,
  ): Promise<void> {
    // Add correlation ID if available
    const eventWithMeta = {
      ...event,
      correlationId: context.meta.correlationId,
    };

    await publisher.publish(channel, eventWithMeta);
  }
}
