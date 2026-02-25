/**
 * @celom/flume - Declarative workflow DSL for orchestrating complex business operations
 */

// Export core types
export * from './types.js';

// Export errors
export { ValidationError, FlowExecutionError, TimeoutError } from './types.js';

// Export flow builder API
export {
  FlowBuilder,
} from './flow-builder.js';

export {
  createFlow,
  composeFlows,
} from './flow-factories.js';

// Export executor (advanced usage)
export { FlowExecutor } from './flow-executor.js';

// Export observer types and implementations
export type { FlowObserver } from './observer.js';
export { DefaultObserver, NoOpObserver } from './observer.js';
export { PinoFlowObserver, type PinoLike } from './pino-observer.js';

