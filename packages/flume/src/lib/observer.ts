/**
 * Observability hooks for workflow execution
 * Enables logging, metrics, and debugging without coupling to specific implementations
 */

import type { BaseFlowDependencies, FlowContext, FlowState } from './types.js';

/**
 * Observer interface for monitoring flow execution
 * All methods are optional - implement only what you need
 */
export interface FlowObserver<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
> {
  /**
   * Called when a flow starts execution
   */
  onFlowStart?: (flowName: string, input: TInput) => void;

  /**
   * Called when a flow completes successfully
   */
  onFlowComplete?: (
    flowName: string,
    output: TState,
    totalDuration: number,
  ) => void;

  /**
   * Called when a flow fails with an error
   */
  onFlowError?: (flowName: string, error: Error, totalDuration: number) => void;

  /**
   * Called when a step starts execution
   */
  onStepStart?: (
    stepName: string,
    context: FlowContext<TInput, TDeps, TState>,
  ) => void;

  /**
   * Called when a step completes successfully
   */
  onStepComplete?: (
    stepName: string,
    result: unknown,
    duration: number,
    context: FlowContext<TInput, TDeps, TState>,
  ) => void;

  /**
   * Called when a step fails with an error
   */
  onStepError?: (
    stepName: string,
    error: Error,
    duration: number,
    context: FlowContext<TInput, TDeps, TState>,
  ) => void;

  /**
   * Called when a step is retried
   */
  onStepRetry?: (
    stepName: string,
    attempt: number,
    maxAttempts: number,
    error: Error,
  ) => void;

  /**
   * Called when a step is skipped due to condition
   */
  onStepSkipped?: (
    stepName: string,
    context: FlowContext<TInput, TDeps, TState>,
  ) => void;

  /**
   * Called when a flow is short-circuited via breakIf
   */
  onFlowBreak?: (
    flowName: string,
    breakStepName: string,
    returnValue: unknown,
    totalDuration: number,
  ) => void;
}

/**
 * Default observer implementation that logs to console
 * Useful for development and debugging
 */
export class DefaultObserver<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
> implements FlowObserver<TInput, TDeps, TState>
{
  constructor(
    private logger?: {
      debug?: (msg: string) => void;
      error?: (msg: string, error: Error) => void;
      warn?: (msg: string) => void;
    },
  ) {}

  onFlowStart(flowName: string, input: TInput): void {
    this.logger?.debug?.(
      `[Workflow] Flow ${flowName} started. Input: ${JSON.stringify(input)}`,
    );
  }

  onFlowComplete(
    flowName: string,
    output: TState,
    totalDuration: number,
  ): void {
    this.logger?.debug?.(
      `[Workflow] Flow ${flowName} completed. Output: ${JSON.stringify(output)} - (${totalDuration}ms)`,
    );
  }

  onFlowError(flowName: string, error: Error, totalDuration: number): void {
    this.logger?.error?.(
      `[Workflow] Flow failed: ${flowName} (${totalDuration}ms)`,
      error,
    );
  }

  onStepStart(stepName: string): void {
    this.logger?.debug?.(`[Workflow] Step started: ${stepName}`);
  }

  onStepComplete(stepName: string, result: unknown, duration: number): void {
    this.logger?.debug?.(
      `[Workflow] Step completed: ${stepName} (${duration}ms)`,
    );
  }

  onStepError(stepName: string, error: Error, duration: number): void {
    this.logger?.error?.(
      `[Workflow] Step failed: ${stepName} (${duration}ms)`,
      error,
    );
  }

  onStepRetry(
    stepName: string,
    attempt: number,
    maxAttempts: number,
    error: Error,
  ): void {
    this.logger?.warn?.(
      `[Workflow] Step retry: ${stepName} (attempt ${attempt}/${maxAttempts}) - ${error.message}`,
    );
  }

  onStepSkipped(stepName: string): void {
    this.logger?.debug?.(`[Workflow] Step skipped: ${stepName}`);
  }

  onFlowBreak(
    flowName: string,
    breakStepName: string,
    returnValue: unknown,
    totalDuration: number,
  ): void {
    this.logger?.debug?.(
      `[Workflow] Flow ${flowName} short-circuited at '${breakStepName}' (${totalDuration}ms)`,
    );
  }
}

/**
 * No-op observer that does nothing
 * Useful for testing or when observability is not needed
 */
export class NoOpObserver<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
> implements FlowObserver<TInput, TDeps, TState> {
  // All methods intentionally left empty
}
