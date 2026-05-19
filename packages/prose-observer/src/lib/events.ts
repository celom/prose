/**
 * Wire-format event types produced by `consoleObserver()`.
 *
 * Every `FlowObserver` hook is mapped to one variant of `ObserverEvent`.
 * The union is discriminated on `type` and carries `{ correlationId, flowName, ts }`
 * on every variant so consumers can group events into executions.
 *
 * `unknown` is used for user-supplied payloads (`input`, `output`, `result`, `returnValue`).
 * The redaction pass in `ConsoleObserverImpl` runs on these fields before events
 * leave the observer.
 */

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface ObserverEventBase {
  /** Stable id tying every event in a single `execute()` call together. */
  correlationId: string;
  flowName: string;
  /** Wall-clock millis (Date.now()). */
  ts: number;
}

/**
 * Per-step state delta. Keys are top-level keys of the flow state object;
 * shallow comparison only — nested object changes show up as a single
 * `changed` entry with the full before/after subtree.
 */
export interface StateDiff {
  added: Record<string, unknown>;
  removed: string[];
  changed: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Captured state attached to a `step.complete` event. The variant depends on
 * the `stateCapture` option:
 *   - `'diff'` (default) → `{ mode: 'diff', diff }`
 *   - `'full'`          → `{ mode: 'full', before, after }`
 *   - `'off'`           → omitted entirely from the event
 */
export type StateCapture =
  | { mode: 'diff'; diff: StateDiff }
  | { mode: 'full'; before: unknown; after: unknown };

export interface FlowStartEvent extends ObserverEventBase {
  type: 'flow.start';
  input: unknown;
}

export interface FlowCompleteEvent extends ObserverEventBase {
  type: 'flow.complete';
  output: unknown;
  durationMs: number;
}

export interface FlowErrorEvent extends ObserverEventBase {
  type: 'flow.error';
  error: SerializedError;
  durationMs: number;
}

export interface FlowBreakEvent extends ObserverEventBase {
  type: 'flow.break';
  stepName: string;
  returnValue: unknown;
  durationMs: number;
}

export interface StepStartEvent extends ObserverEventBase {
  type: 'step.start';
  stepName: string;
}

export interface StepCompleteEvent extends ObserverEventBase {
  type: 'step.complete';
  stepName: string;
  result: unknown;
  durationMs: number;
  state?: StateCapture;
}

export interface StepErrorEvent extends ObserverEventBase {
  type: 'step.error';
  stepName: string;
  error: SerializedError;
  durationMs: number;
}

export interface StepRetryEvent extends ObserverEventBase {
  type: 'step.retry';
  stepName: string;
  attempt: number;
  maxAttempts: number;
  error: SerializedError;
}

export interface StepSkippedEvent extends ObserverEventBase {
  type: 'step.skipped';
  stepName: string;
}

export type ObserverEvent =
  | FlowStartEvent
  | FlowCompleteEvent
  | FlowErrorEvent
  | FlowBreakEvent
  | StepStartEvent
  | StepCompleteEvent
  | StepErrorEvent
  | StepRetryEvent
  | StepSkippedEvent;

export type ObserverEventType = ObserverEvent['type'];
