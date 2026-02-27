import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

function validateFlowCode(sourceCode: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = sourceCode.split('\n');

  // Check for createFlow usage
  const hasCreateFlow = sourceCode.includes('createFlow');
  if (!hasCreateFlow) {
    issues.push({
      severity: 'error',
      message: 'No createFlow() call found — this does not appear to be a @celom/prose flow',
    });
    return issues;
  }

  // Check for .build()
  if (!sourceCode.includes('.build()')) {
    issues.push({
      severity: 'error',
      message: 'Missing .build() call — the flow is not executable without it',
    });
  }

  // Check for .map() after .build()
  const buildIndex = sourceCode.indexOf('.build()');
  const mapIndex = sourceCode.lastIndexOf('.map(');
  if (buildIndex !== -1 && mapIndex !== -1 && mapIndex > buildIndex) {
    issues.push({
      severity: 'error',
      message: '.map() is called after .build() — .map() must come before .build()',
    });
  }

  // Check for .withRetry() on validate steps
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if .withRetry() follows a .validate() (within ~5 lines)
    if (trimmed.startsWith('.withRetry(')) {
      // Look back for the step type
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prevLine = lines[j].trim();
        if (prevLine.includes('.validate(')) {
          issues.push({
            severity: 'warning',
            message: `.withRetry() at line ${i + 1} follows a .validate() step — validation steps are never retried`,
            line: i + 1,
          });
          break;
        }
        // If we hit another step type, stop looking
        if (
          prevLine.includes('.step(') ||
          prevLine.includes('.transaction(') ||
          prevLine.includes('.parallel(') ||
          prevLine.includes('.stepIf(')
        ) {
          break;
        }
      }
    }
  }

  // Check for duplicate step names
  const stepNamePattern = /\.(step|validate|stepIf|transaction|parallel)\s*\(\s*['"]([^'"]+)['"]/g;
  const stepNames = new Map<string, number[]>();
  let match;

  while ((match = stepNamePattern.exec(sourceCode)) !== null) {
    const name = match[2];
    const lineNum = sourceCode.slice(0, match.index).split('\n').length;
    if (!stepNames.has(name)) {
      stepNames.set(name, []);
    }
    stepNames.get(name)!.push(lineNum);
  }

  // Also check .event() and .events() for custom step names (3rd argument)
  // .event(channel, builder, 'stepName') / .events(channel, builders, 'stepName')
  const eventNamePattern = /\.(event|events)\s*\([^)]*,\s*[^,]+,\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = eventNamePattern.exec(sourceCode)) !== null) {
    const name = match[2];
    const lineNum = sourceCode.slice(0, match.index).split('\n').length;
    if (!stepNames.has(name)) {
      stepNames.set(name, []);
    }
    stepNames.get(name)!.push(lineNum);
  }

  for (const [name, lineNums] of stepNames) {
    if (lineNums.length > 1) {
      issues.push({
        severity: 'error',
        message: `Duplicate step name "${name}" at lines ${lineNums.join(', ')} — each step must have a unique name`,
      });
    }
  }

  // Check for .transaction() without db in deps
  if (sourceCode.includes('.transaction(')) {
    const createFlowMatch = sourceCode.match(
      /createFlow<([^>]+)>/,
    );
    if (createFlowMatch) {
      const typeParams = createFlowMatch[1];
      // Simple heuristic: if there's a second type param, check it
      const commaIndex = findTopLevelComma(typeParams);
      if (commaIndex === -1) {
        issues.push({
          severity: 'warning',
          message: '.transaction() is used but createFlow has no deps type parameter — ensure you pass a db dependency',
        });
      }
    }
  }

  // Check for .event()/.events() without eventPublisher in deps
  if (
    sourceCode.includes('.event(') ||
    sourceCode.includes('.events(')
  ) {
    const createFlowMatch = sourceCode.match(
      /createFlow<([^>]+)>/,
    );
    if (createFlowMatch) {
      const typeParams = createFlowMatch[1];
      const commaIndex = findTopLevelComma(typeParams);
      if (commaIndex === -1) {
        issues.push({
          severity: 'warning',
          message: '.event() is used but createFlow has no deps type parameter — ensure you pass an eventPublisher dependency',
        });
      }
    }
  }

  // Check for step handlers that use await but aren't async
  const stepHandlerPattern =
    /\.(step|stepIf|validate|transaction)\s*\([^,]+,\s*(\([^)]*\))\s*=>\s*\{/g;
  while ((match = stepHandlerPattern.exec(sourceCode)) !== null) {
    const beforeArrow = sourceCode.slice(
      Math.max(0, match.index - 10),
      match.index + match[0].length,
    );
    const afterArrow = sourceCode.slice(
      match.index + match[0].length,
      match.index + match[0].length + 500,
    );

    // Check if the handler body contains await but the function isn't async
    if (afterArrow.includes('await ') && !beforeArrow.includes('async')) {
      const lineNum = sourceCode
        .slice(0, match.index)
        .split('\n').length;
      issues.push({
        severity: 'error',
        message: `Step handler at line ${lineNum} uses \`await\` but is not marked \`async\``,
        line: lineNum,
      });
    }
  }

  return issues;
}

function findTopLevelComma(str: string): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

export function registerValidateFlowPattern(server: McpServer) {
  server.tool(
    'validate_flow_pattern',
    'Check @celom/prose flow code for common mistakes and anti-patterns. Returns a list of issues with severity and suggestions.',
    {
      sourceCode: z
        .string()
        .describe('TypeScript source code containing a @celom/prose flow'),
    },
    async ({ sourceCode }) => {
      const issues = validateFlowCode(sourceCode);

      if (issues.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No issues found. The flow pattern looks correct.',
            },
          ],
        };
      }

      const lines: string[] = [];
      lines.push(
        `## Found ${issues.length} issue(s)`,
      );
      lines.push('');

      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');

      if (errors.length > 0) {
        lines.push('### Errors');
        for (const issue of errors) {
          lines.push(
            `- ${issue.line ? `Line ${issue.line}: ` : ''}${issue.message}`,
          );
        }
        lines.push('');
      }

      if (warnings.length > 0) {
        lines.push('### Warnings');
        for (const issue of warnings) {
          lines.push(
            `- ${issue.line ? `Line ${issue.line}: ` : ''}${issue.message}`,
          );
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
