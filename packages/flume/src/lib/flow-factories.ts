import { FlowBuilder } from './flow-builder.js';
import { FlowExecutor } from './flow-executor.js';
import { BaseFlowDependencies, FlowConfig, FlowDefinition, FlowState, StepDefinition } from './types.js';

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

