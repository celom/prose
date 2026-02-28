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

type Step = {
  name: string;
  type: string;
  description?: string;
  hasRetry?: boolean;
};

type FlowParams = {
  name: string;
  description?: string;
  inputFields: Array<{ name: string; type: string; optional?: boolean }>;
  dependencies?: Array<{ name: string; type: string }>;
  steps: Array<Step>;
  hasMapOutput?: boolean;
  hasBreakIf?: boolean;
};

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function isHandlerStep(step: Step): boolean {
  return ['step', 'validate', 'stepIf', 'transaction', 'parallel'].includes(step.type);
}

function generateFlowCode(params: FlowParams): string {
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
    `export const ${toCamelCase(name)} = createFlow<${pascal}Input, ${depsType}>('${name}')`,
  );

  appendSteps(lines, steps, name, hasBreakIf, hasMapOutput);

  return lines.join('\n');
}

function appendSteps(
  lines: string[],
  steps: Array<Step>,
  flowName: string,
  hasBreakIf?: boolean,
  hasMapOutput?: boolean,
): void {
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
          `    eventType: '${flowName}.${step.name}', // TODO: Set event type`,
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
}

function generateStructuredFlowCode(params: FlowParams): string {
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
  const handlerSteps = steps.filter(isHandlerStep);
  const sections: string[] = [];

  // --- types.ts ---
  const typesLines: string[] = [];
  const proseTypeImports: string[] = [];
  if (dependencies?.some((d) => d.type === 'DatabaseClient'))
    proseTypeImports.push('DatabaseClient');
  if (dependencies?.some((d) => d.type === 'FlowEventPublisher'))
    proseTypeImports.push('FlowEventPublisher');
  if (proseTypeImports.length > 0) {
    typesLines.push(
      `import type { ${proseTypeImports.join(', ')} } from '@celom/prose';`,
    );
    typesLines.push('');
  }

  if (description) {
    typesLines.push(`/** ${description} */`);
  }
  typesLines.push(`export interface ${pascal}Input {`);
  for (const field of inputFields) {
    typesLines.push(
      `  ${field.name}${field.optional ? '?' : ''}: ${field.type};`,
    );
  }
  typesLines.push('}');

  if (dependencies && dependencies.length > 0) {
    typesLines.push('');
    typesLines.push(`export interface ${pascal}Deps {`);
    for (const dep of dependencies) {
      typesLines.push(`  ${dep.name}: ${dep.type};`);
    }
    typesLines.push('}');
  }

  sections.push(`// --- ${name}/types.ts ---\n${typesLines.join('\n')}`);

  // --- Individual step files ---
  for (const step of handlerSteps) {
    const stepFile = toKebabCase(step.name);
    const stepLines: string[] = [];
    const needsValidationError = step.type === 'validate';

    if (needsValidationError) {
      stepLines.push(`import { ValidationError } from '@celom/prose';`);
    }
    stepLines.push(`import type { FlowContext } from '@celom/prose';`);

    const depsType =
      dependencies && dependencies.length > 0 ? `${pascal}Deps` : 'never';
    stepLines.push(
      `import type { ${pascal}Input, ${dependencies && dependencies.length > 0 ? `${pascal}Deps` : ''} } from '../types';`.replace(', }', ' }'),
    );
    stepLines.push('');

    const stateName = `${toPascalCase(step.name)}State`;
    stepLines.push(`interface ${stateName} {`);
    stepLines.push(`  // TODO: Declare the state properties this step reads from prior steps`);
    stepLines.push(`}`);
    stepLines.push('');

    if (step.description) {
      stepLines.push(`/** ${step.description} */`);
    }

    switch (step.type) {
      case 'validate':
        stepLines.push(
          `export function ${step.name}(`,
        );
        stepLines.push(
          `  ctx: FlowContext<${pascal}Input, ${depsType}, ${stateName}>`,
        );
        stepLines.push(`): void {`);
        stepLines.push(`  // TODO: Add validation logic`);
        stepLines.push(
          `  // throw ValidationError.single('field', 'message');`,
        );
        stepLines.push(`}`);
        break;

      case 'step':
      case 'stepIf':
        stepLines.push(
          `export async function ${step.name}(`,
        );
        stepLines.push(
          `  ctx: FlowContext<${pascal}Input, ${depsType}, ${stateName}>`,
        );
        stepLines.push(`) {`);
        stepLines.push(`  // TODO: Implement ${step.name}`);
        stepLines.push(`  return {};`);
        stepLines.push(`}`);
        break;

      case 'transaction':
        stepLines.push(
          `export async function ${step.name}(`,
        );
        stepLines.push(
          `  ctx: FlowContext<${pascal}Input, ${depsType}, ${stateName}>,`,
        );
        stepLines.push(`  tx: unknown`);
        stepLines.push(`) {`);
        stepLines.push(`  // TODO: Implement transaction logic`);
        stepLines.push(`  return {};`);
        stepLines.push(`}`);
        break;

      case 'parallel':
        stepLines.push(
          `export async function ${step.name}(`,
        );
        stepLines.push(
          `  ctx: FlowContext<${pascal}Input, ${depsType}, ${stateName}>`,
        );
        stepLines.push(`) {`);
        stepLines.push(`  // TODO: Implement ${step.name}`);
        stepLines.push(`  return {};`);
        stepLines.push(`}`);
        break;
    }

    sections.push(
      `// --- ${name}/steps/${stepFile}.ts ---\n${stepLines.join('\n')}`,
    );
  }

  // --- flow.ts ---
  const flowLines: string[] = [];
  const flowImports = ['createFlow'];
  flowLines.push(`import { ${flowImports.join(', ')} } from '@celom/prose';`);

  const depsType =
    dependencies && dependencies.length > 0 ? `${pascal}Deps` : 'never';
  const typeNames = [`${pascal}Input`];
  if (dependencies && dependencies.length > 0) {
    typeNames.push(`${pascal}Deps`);
  }
  flowLines.push(`import type { ${typeNames.join(', ')} } from './types';`);

  for (const step of handlerSteps) {
    const stepFile = toKebabCase(step.name);
    flowLines.push(
      `import { ${step.name} } from './steps/${stepFile}';`,
    );
  }

  flowLines.push('');
  flowLines.push(
    `export const ${toCamelCase(name)} = createFlow<${pascal}Input, ${depsType}>('${name}')`,
  );

  // Wire steps into the flow using imported handlers
  for (const step of steps) {
    flowLines.push('');
    if (step.description) {
      flowLines.push(`  // ${step.description}`);
    }

    switch (step.type) {
      case 'validate':
        flowLines.push(`  .validate('${step.name}', ${step.name})`);
        break;

      case 'step':
        flowLines.push(`  .step('${step.name}', ${step.name})`);
        break;

      case 'stepIf':
        flowLines.push(
          `  .stepIf('${step.name}', (ctx) => true /* TODO: condition */, ${step.name})`,
        );
        break;

      case 'transaction':
        flowLines.push(`  .transaction('${step.name}', ${step.name})`);
        break;

      case 'parallel':
        flowLines.push(
          `  .parallel('${step.name}', 'shallow', ${step.name})`,
        );
        break;

      case 'event':
        flowLines.push(`  .event('${step.name}', (ctx) => ({`);
        flowLines.push(
          `    eventType: '${name}.${step.name}', // TODO: Set event type`,
        );
        flowLines.push(`  }), '${step.name}Event')`);
        break;

      case 'breakIf':
        flowLines.push(`  .breakIf(`);
        flowLines.push(`    (ctx) => false, // TODO: Add break condition`);
        flowLines.push(`    (ctx) => ({`);
        flowLines.push(`      // TODO: Define early exit return value`);
        flowLines.push(`    })`);
        flowLines.push(`  )`);
        break;
    }

    if (step.hasRetry) {
      flowLines.push(`  .withRetry({`);
      flowLines.push(`    maxAttempts: 3,`);
      flowLines.push(`    delayMs: 200,`);
      flowLines.push(`    backoffMultiplier: 2,`);
      flowLines.push(`  })`);
    }
  }

  if (hasBreakIf && !steps.some((s) => s.type === 'breakIf')) {
    flowLines.push('');
    flowLines.push(`  // Early exit condition`);
    flowLines.push(`  .breakIf(`);
    flowLines.push(`    (ctx) => false, // TODO: Add break condition`);
    flowLines.push(`    (ctx) => ({`);
    flowLines.push(`      // TODO: Define early exit return value`);
    flowLines.push(`    })`);
    flowLines.push(`  )`);
  }

  if (hasMapOutput) {
    flowLines.push('');
    flowLines.push(`  // Shape the output`);
    flowLines.push(`  .map((input, state) => ({`);
    flowLines.push(`    // TODO: Define output shape`);
    flowLines.push(`    ...state,`);
    flowLines.push(`  }))`);
  }

  flowLines.push(`  .build();`);

  sections.push(`// --- ${name}/flow.ts ---\n${flowLines.join('\n')}`);

  // --- Directory structure header ---
  const tree = [`${name}/`, `├── flow.ts`, `├── types.ts`];
  if (handlerSteps.length > 0) {
    tree.push(`└── steps/`);
    handlerSteps.forEach((step, i) => {
      const prefix = i === handlerSteps.length - 1 ? '    └── ' : '    ├── ';
      tree.push(`${prefix}${toKebabCase(step.name)}.ts`);
    });
  }

  return `## Project structure\n\n\`\`\`\n${tree.join('\n')}\n\`\`\`\n\n${sections.join('\n\n')}`;
}

export function registerScaffoldFlow(server: McpServer) {
  server.registerTool(
    'scaffold_flow',
    {
      description: 'Generate a complete @celom/prose flow definition from structured input. Returns ready-to-use TypeScript code with proper types, step ordering, and TODO comments. Use structured=true to generate multi-file output following the recommended project structure convention (types.ts, flow.ts, and individual step files).',
      inputSchema: {
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
        structured: z
          .boolean()
          .optional()
          .describe(
            'Generate multi-file output following the recommended project structure (types.ts, flow.ts, steps/). Recommended for core business operations with 4+ steps.',
          ),
      },
    },
    async (params) => {
      const code = params.structured
        ? generateStructuredFlowCode(params)
        : generateFlowCode(params);
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
