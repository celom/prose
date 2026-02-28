import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

interface FlowAnalysis {
  flowName: string | null;
  inputType: string | null;
  depsType: string | null;
  steps: Array<{
    name: string;
    type: string;
    hasRetry: boolean;
    hasCondition: boolean;
  }>;
  hasMap: boolean;
  hasBuild: boolean;
  hasBreakIf: boolean;
  stepCount: number;
}

export function analyzeFlowSource(sourceCode: string): FlowAnalysis {
  const analysis: FlowAnalysis = {
    flowName: null,
    inputType: null,
    depsType: null,
    steps: [],
    hasMap: false,
    hasBuild: false,
    hasBreakIf: false,
    stepCount: 0,
  };

  // Extract flow name and type params from createFlow
  const createFlowMatch = sourceCode.match(
    /createFlow<([^>]+)>\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  );
  if (createFlowMatch) {
    const typeParams = createFlowMatch[1];
    analysis.flowName = createFlowMatch[2];

    // Split type params (handle nested generics)
    const parts = splitTypeParams(typeParams);
    analysis.inputType = parts[0]?.trim() ?? null;
    analysis.depsType = parts[1]?.trim() ?? null;
  }

  // Extract step calls with their names
  const stepPattern =
    /\.(step|validate|stepIf|transaction|parallel|event|events|breakIf|withRetry|map|build)\s*\(/g;
  let match;

  while ((match = stepPattern.exec(sourceCode)) !== null) {
    const method = match[1];
    const afterMatch = sourceCode.slice(
      match.index + match[0].length,
      match.index + match[0].length + 200,
    );

    switch (method) {
      case 'step':
      case 'validate':
      case 'transaction': {
        const nameMatch = afterMatch.match(/^['"]([^'"]+)['"]/);
        analysis.steps.push({
          name: nameMatch ? nameMatch[1] : `unnamed_${analysis.steps.length}`,
          type: method,
          hasRetry: false,
          hasCondition: false,
        });
        break;
      }

      case 'stepIf': {
        const nameMatch = afterMatch.match(/^['"]([^'"]+)['"]/);
        analysis.steps.push({
          name: nameMatch ? nameMatch[1] : `unnamed_${analysis.steps.length}`,
          type: 'stepIf',
          hasRetry: false,
          hasCondition: true,
        });
        break;
      }

      case 'parallel': {
        const nameMatch = afterMatch.match(/^['"]([^'"]+)['"]/);
        analysis.steps.push({
          name: nameMatch ? nameMatch[1] : `unnamed_${analysis.steps.length}`,
          type: 'parallel',
          hasRetry: false,
          hasCondition: false,
        });
        break;
      }

      case 'event':
      case 'events': {
        const nameMatch = afterMatch.match(/^['"]([^'"]+)['"]/);
        analysis.steps.push({
          name: nameMatch
            ? nameMatch[1]
            : method === 'events'
              ? 'publishEvents'
              : 'publishEvent',
          type: method,
          hasRetry: false,
          hasCondition: false,
        });
        break;
      }

      case 'breakIf':
        analysis.hasBreakIf = true;
        analysis.steps.push({
          name: `break_${analysis.steps.length}`,
          type: 'breakIf',
          hasRetry: false,
          hasCondition: true,
        });
        break;

      case 'withRetry':
        if (analysis.steps.length > 0) {
          analysis.steps[analysis.steps.length - 1].hasRetry = true;
        }
        break;

      case 'map':
        analysis.hasMap = true;
        break;

      case 'build':
        analysis.hasBuild = true;
        break;
    }
  }

  analysis.stepCount = analysis.steps.filter(
    (s) => s.type !== 'breakIf',
  ).length;

  return analysis;
}

function splitTypeParams(typeParams: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of typeParams) {
    if (ch === '<' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current);
  return parts;
}

export function registerAnalyzeFlow(server: McpServer) {
  server.registerTool(
    'analyze_flow',
    {
      description: 'Analyze a @celom/prose flow definition from source code. Extracts flow structure, step types, state shape, and potential issues.',
      inputSchema: {
        sourceCode: z
          .string()
          .describe(
            'TypeScript source code containing a @celom/prose flow definition',
          ),
      },
    },
    async ({ sourceCode }) => {
      const analysis = analyzeFlowSource(sourceCode);

      const lines: string[] = [];
      lines.push(`## Flow Analysis`);
      lines.push('');
      lines.push(`**Name:** ${analysis.flowName ?? 'Unknown'}`);
      lines.push(`**Input type:** ${analysis.inputType ?? 'Unknown'}`);
      lines.push(`**Dependencies type:** ${analysis.depsType ?? 'None'}`);
      lines.push(`**Step count:** ${analysis.stepCount}`);
      lines.push(`**Has .map():** ${analysis.hasMap ? 'Yes' : 'No'}`);
      lines.push(`**Has .build():** ${analysis.hasBuild ? 'Yes' : 'No'}`);
      lines.push(
        `**Has .breakIf():** ${analysis.hasBreakIf ? 'Yes' : 'No'}`,
      );
      lines.push('');
      lines.push('### Steps');
      lines.push('');
      lines.push(
        '| # | Name | Type | Retry | Condition |',
      );
      lines.push(
        '|---|------|------|-------|-----------|',
      );

      analysis.steps.forEach((step, i) => {
        lines.push(
          `| ${i + 1} | ${step.name} | ${step.type} | ${step.hasRetry ? 'Yes' : '-'} | ${step.hasCondition ? 'Yes' : '-'} |`,
        );
      });

      // Check for issues
      const issues: string[] = [];
      if (!analysis.hasBuild) {
        issues.push('Missing .build() call — flow is not executable');
      }
      const stepNames = analysis.steps.map((s) => s.name);
      const duplicates = stepNames.filter(
        (name, i) => stepNames.indexOf(name) !== i,
      );
      if (duplicates.length > 0) {
        issues.push(`Duplicate step names: ${duplicates.join(', ')}`);
      }
      if (
        analysis.steps.some((s) => s.type === 'transaction') &&
        analysis.depsType &&
        !analysis.depsType.includes('DatabaseClient') &&
        !analysis.depsType.includes('db')
      ) {
        issues.push(
          '.transaction() used but deps type may not include DatabaseClient',
        );
      }
      if (
        analysis.steps.some(
          (s) => s.type === 'event' || s.type === 'events',
        ) &&
        analysis.depsType &&
        !analysis.depsType.includes('FlowEventPublisher') &&
        !analysis.depsType.includes('eventPublisher')
      ) {
        issues.push(
          '.event() used but deps type may not include FlowEventPublisher',
        );
      }

      if (issues.length > 0) {
        lines.push('');
        lines.push('### Potential Issues');
        lines.push('');
        for (const issue of issues) {
          lines.push(`- ${issue}`);
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n'),
          },
        ],
      };
    },
  );
}
