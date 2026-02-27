import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const StepSchema = z.object({
  name: z.string().describe('Step name in camelCase (for event steps, this is the channel name)'),
  type: z.enum([
    'step',
    'validate',
    'stepIf',
    'transaction',
    'parallel',
    'event',
    'breakIf',
  ]),
  description: z.string().optional().describe('What this step does'),
  hasRetry: z.boolean().optional().describe('Add .withRetry() after this step'),
});

const DependencySchema = z.object({
  name: z.string().describe('Dependency name (e.g. db, eventPublisher, paymentService)'),
  type: z.string().describe('TypeScript type (e.g. DatabaseClient, FlowEventPublisher)'),
});

const InputFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  optional: z.boolean().optional(),
});

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function generateFlowCode(params: {
  name: string;
  description?: string;
  inputFields: Array<{ name: string; type: string; optional?: boolean }>;
  dependencies?: Array<{ name: string; type: string }>;
  steps: Array<{
    name: string;
    type: string;
    description?: string;
    hasRetry?: boolean;
  }>;
  hasMapOutput?: boolean;
  hasBreakIf?: boolean;
}): string {
  const {
    name,
    description,
    inputFields,
    dependencies,
    steps,
    hasMapOutput,
    hasBreakIf,
  } = params;

  const pascal = toPascalCase(name);
  const lines: string[] = [];

  // Imports
  const imports = ['createFlow'];
  if (steps.some((s) => s.type === 'validate')) imports.push('ValidationError');
  const typeImports: string[] = [];
  if (dependencies?.some((d) => d.type === 'DatabaseClient'))
    typeImports.push('DatabaseClient');
  if (dependencies?.some((d) => d.type === 'FlowEventPublisher'))
    typeImports.push('FlowEventPublisher');

  lines.push(`import { ${imports.join(', ')} } from '@celom/prose';`);
  if (typeImports.length > 0) {
    lines.push(
      `import type { ${typeImports.join(', ')} } from '@celom/prose';`,
    );
  }
  lines.push('');

  // Input type
  if (description) {
    lines.push(`/** ${description} */`);
  }
  lines.push(`interface ${pascal}Input {`);
  for (const field of inputFields) {
    lines.push(
      `  ${field.name}${field.optional ? '?' : ''}: ${field.type};`,
    );
  }
  lines.push('}');
  lines.push('');

  // Deps type
  if (dependencies && dependencies.length > 0) {
    lines.push(`interface ${pascal}Deps {`);
    for (const dep of dependencies) {
      lines.push(`  ${dep.name}: ${dep.type};`);
    }
    lines.push('}');
    lines.push('');
  }

  // Flow definition
  const depsType =
    dependencies && dependencies.length > 0 ? `${pascal}Deps` : 'never';
  lines.push(
    `export const ${name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())} = createFlow<${pascal}Input, ${depsType}>('${name}')`,
  );

  // Steps
  for (const step of steps) {
    lines.push('');
    if (step.description) {
      lines.push(`  // ${step.description}`);
    }

    switch (step.type) {
      case 'validate':
        lines.push(`  .validate('${step.name}', (ctx) => {`);
        lines.push(`    // TODO: Add validation logic`);
        lines.push(
          `    // throw ValidationError.single('field', 'message');`,
        );
        lines.push(`  })`);
        break;

      case 'step':
        lines.push(`  .step('${step.name}', async (ctx) => {`);
        lines.push(`    // TODO: Implement ${step.name}`);
        lines.push(`    return {};`);
        lines.push(`  })`);
        break;

      case 'stepIf':
        lines.push(
          `  .stepIf('${step.name}', (ctx) => true /* TODO: condition */, async (ctx) => {`,
        );
        lines.push(`    // TODO: Implement ${step.name}`);
        lines.push(`    return {};`);
        lines.push(`  })`);
        break;

      case 'transaction':
        lines.push(
          `  .transaction('${step.name}', async (ctx, tx) => {`,
        );
        lines.push(`    // TODO: Implement transaction logic`);
        lines.push(`    return {};`);
        lines.push(`  })`);
        break;

      case 'parallel':
        lines.push(
          `  .parallel('${step.name}', 'shallow',`,
        );
        lines.push(`    async (ctx) => {`);
        lines.push(`      // TODO: First parallel handler`);
        lines.push(`      return {};`);
        lines.push(`    },`);
        lines.push(`    async (ctx) => {`);
        lines.push(`      // TODO: Second parallel handler`);
        lines.push(`      return {};`);
        lines.push(`    },`);
        lines.push(`  )`);
        break;

      case 'event':
        lines.push(`  .event('${step.name}', (ctx) => ({`);
        lines.push(
          `    eventType: '${name}.${step.name}', // TODO: Set event type`,
        );
        lines.push(`  }), '${step.name}Event')`);
        break;

      case 'breakIf':
        lines.push(`  .breakIf(`);
        lines.push(`    (ctx) => false, // TODO: Add break condition`);
        lines.push(`    (ctx) => ({`);
        lines.push(`      // TODO: Define early exit return value`);
        lines.push(`    })`);
        lines.push(`  )`);
        break;
    }

    if (step.hasRetry) {
      lines.push(`  .withRetry({`);
      lines.push(`    maxAttempts: 3,`);
      lines.push(`    delayMs: 200,`);
      lines.push(`    backoffMultiplier: 2,`);
      lines.push(`  })`);
    }
  }

  // Add breakIf if requested and not already present as a step
  if (hasBreakIf && !steps.some((s) => s.type === 'breakIf')) {
    lines.push('');
    lines.push(`  // Early exit condition`);
    lines.push(`  .breakIf(`);
    lines.push(`    (ctx) => false, // TODO: Add break condition`);
    lines.push(`    (ctx) => ({`);
    lines.push(`      // TODO: Define early exit return value`);
    lines.push(`    })`);
    lines.push(`  )`);
  }

  // Map output
  if (hasMapOutput) {
    lines.push('');
    lines.push(`  // Shape the output`);
    lines.push(`  .map((input, state) => ({`);
    lines.push(`    // TODO: Define output shape`);
    lines.push(`    ...state,`);
    lines.push(`  }))`);
  }

  // Build
  lines.push(`  .build();`);

  return lines.join('\n');
}

export function registerScaffoldFlow(server: McpServer) {
  server.tool(
    'scaffold_flow',
    'Generate a complete @celom/prose flow definition from structured input. Returns ready-to-use TypeScript code with proper types, step ordering, and TODO comments.',
    {
      name: z
        .string()
        .describe('Flow name in kebab-case, e.g. "process-order"'),
      description: z
        .string()
        .optional()
        .describe('Description of what the flow does'),
      inputFields: z
        .array(InputFieldSchema)
        .describe('Fields for the flow input type'),
      dependencies: z
        .array(DependencySchema)
        .optional()
        .describe(
          'External dependencies (e.g. db: DatabaseClient, eventPublisher: FlowEventPublisher)',
        ),
      steps: z
        .array(StepSchema)
        .describe('Steps in execution order'),
      hasMapOutput: z
        .boolean()
        .optional()
        .describe('Whether to add a .map() output transformer'),
      hasBreakIf: z
        .boolean()
        .optional()
        .describe('Whether the flow has early exit conditions'),
    },
    async (params) => {
      const code = generateFlowCode(params);
      return {
        content: [
          {
            type: 'text' as const,
            text: code,
          },
        ],
      };
    },
  );
}
