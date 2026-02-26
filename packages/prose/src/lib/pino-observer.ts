/**
 * Pino-based observer for workflow execution.
 *
 * Provides structured logging for every step lifecycle event.
 * Works with any pino-compatible logger (e.g. fastify.log).
 */

import type { BaseFlowDependencies, FlowState } from './types.js';
import type { FlowObserver } from './observer.js';

/**
 * Minimal pino-compatible logger interface.
 * Avoids a direct pino dependency — satisfied by fastify.log.
 */
export interface PinoLike {
  info: (obj: Record<string, unknown>, msg: string) => void;
  debug: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLike;
}

export class PinoFlowObserver<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
> implements FlowObserver<TInput, TDeps, TState>
{
  private logger: PinoLike;

  constructor(logger: PinoLike) {
    this.logger = logger.child({ component: 'workflow' });
  }

  onFlowStart(flowName: string, _input: TInput): void {
    this.logger.info({ flow: flowName }, 'Flow started');
  }

  onFlowComplete(
    flowName: string,
    _output: TState,
    totalDuration: number,
  ): void {
    this.logger.info(
      { flow: flowName, durationMs: totalDuration },
      'Flow completed',
    );
  }

  onFlowError(flowName: string, error: Error, totalDuration: number): void {
    this.logger.error(
      { flow: flowName, durationMs: totalDuration, err: error },
      'Flow failed',
    );
  }

  onStepStart(stepName: string, _context: unknown): void {
    this.logger.debug({ step: stepName }, 'Step started');
  }

  onStepComplete(
    stepName: string,
    result: unknown,
    duration: number,
    _context: unknown,
  ): void {
    const meta: Record<string, unknown> = {
      step: stepName,
      durationMs: duration,
    };

    // Include result keys (not values) for a quick overview of what the step produced
    if (result && typeof result === 'object') {
      meta.resultKeys = Object.keys(result);
    }

    this.logger.info(meta, 'Step completed');
  }

  onStepError(
    stepName: string,
    error: Error,
    duration: number,
    _context: unknown,
  ): void {
    this.logger.error(
      { step: stepName, durationMs: duration, err: error },
      'Step failed',
    );
  }

  onStepRetry(
    stepName: string,
    attempt: number,
    maxAttempts: number,
    error: Error,
  ): void {
    this.logger.warn(
      { step: stepName, attempt, maxAttempts, err: error },
      'Step retrying',
    );
  }

  onStepSkipped(stepName: string, _context: unknown): void {
    this.logger.debug({ step: stepName }, 'Step skipped');
  }

  onFlowBreak(
    flowName: string,
    breakStepName: string,
    _returnValue: unknown,
    totalDuration: number,
  ): void {
    this.logger.info(
      { flow: flowName, breakStep: breakStepName, durationMs: totalDuration },
      'Flow short-circuited',
    );
  }
}
