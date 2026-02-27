import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { QUICK_REFERENCE } from '../content/quick-reference.js';

export function registerPrompts(server: McpServer) {
  server.prompt(
    'design-flow',
    'Interactive assistant for designing a new @celom/prose workflow',
    {
      description: z
        .string()
        .describe(
          'Describe the business operation this flow should handle',
        ),
      constraints: z
        .string()
        .optional()
        .describe(
          'Any constraints: needs transactions, retries, specific error handling, etc.',
        ),
    },
    ({ description, constraints }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are an expert in @celom/prose, a declarative workflow DSL for TypeScript.

## Reference
${QUICK_REFERENCE}

## Task
The user wants to design a workflow for: ${description}
${constraints ? `\nConstraints: ${constraints}` : ''}

Help them design a flow by:
1. Identifying the input type (what data does the flow receive?)
2. Identifying dependencies (database, event publisher, external APIs?)
3. Breaking down the operation into ordered steps
4. Deciding which step type each should be:
   - .validate() for input validation (runs first, never retried)
   - .step() for regular business logic
   - .stepIf() for conditional steps
   - .transaction() for database operations needing atomicity
   - .parallel() for independent concurrent operations
   - .event() for publishing domain events
5. Identifying where retries are needed (.withRetry())
6. Identifying early exit conditions (.breakIf())
7. Defining the output shape (.map())

Key rules:
- .withRetry() applies to the LAST step, not the next one
- .validate() steps are never retried
- .transaction() requires a \`db: DatabaseClient\` dependency
- .event() requires an \`eventPublisher: FlowEventPublisher\` dependency
- .map() transforms the final output and is called before .build()
- .breakIf() skips remaining steps AND .map()
- State is accumulated: each step's return object is shallow-merged into ctx.state
- Input is readonly via ctx.input

Provide the flow design, then generate the complete TypeScript code.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    'debug-flow',
    'Help debug issues with an existing @celom/prose flow',
    {
      code: z
        .string()
        .describe('The flow source code that has issues'),
      problem: z
        .string()
        .describe('Description of the problem or error message'),
    },
    ({ code, problem }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are an expert debugger for @celom/prose workflows.

## Reference
${QUICK_REFERENCE}

## Flow Code
\`\`\`typescript
${code}
\`\`\`

## Problem
${problem}

## Common issues to check
1. Type errors: State type doesn't include expected properties (steps may be in wrong order)
2. .withRetry() applied to wrong step (it applies to the LAST step, not the next)
3. Missing .build() call
4. .map() after .build() (must be before)
5. ValidationError vs FlowExecutionError confusion
6. Missing db dependency for .transaction() steps
7. Missing eventPublisher for .event() steps
8. Timeout issues: check flow-level and step-level timeout configuration
9. AbortSignal: ctx.signal should be passed to fetch/async operations
10. State threading: each step only sees state from PRIOR steps

Analyze the code, identify the issue, and provide a corrected version.`,
          },
        },
      ],
    }),
  );
}
