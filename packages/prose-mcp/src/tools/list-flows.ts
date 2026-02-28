import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { analyzeFlowSource } from './analyze-flow.js';

async function findTypeScriptFiles(
  dir: string,
  maxDepth: number = 5,
  currentDepth: number = 0,
): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];

  const files: string[] = [];
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === 'coverage' ||
        entry.name === '.next' ||
        entry.name === '.nuxt'
      ) {
        continue;
      }
      const subFiles = await findTypeScriptFiles(
        fullPath,
        maxDepth,
        currentDepth + 1,
      );
      files.push(...subFiles);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

export function registerListFlows(server: McpServer) {
  server.registerTool(
    'list_flows',
    {
      description: 'Scan a project directory for @celom/prose flow definitions and return a summary of each flow found.',
      inputSchema: {
        directory: z
          .string()
          .describe('Absolute path to the directory to scan'),
        maxDepth: z
          .number()
          .optional()
          .default(5)
          .describe('Maximum directory depth to scan (default: 5)'),
      },
    },
    async ({ directory, maxDepth }) => {
      const tsFiles = await findTypeScriptFiles(directory, maxDepth);

      const flows: Array<{
        filePath: string;
        flowName: string | null;
        stepCount: number;
        stepNames: string[];
      }> = [];

      for (const filePath of tsFiles) {
        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch {
          continue;
        }

        // Quick check before expensive analysis
        if (
          !content.includes('createFlow') &&
          !content.includes('@celom/prose')
        ) {
          continue;
        }

        const analysis = analyzeFlowSource(content);
        if (analysis.flowName) {
          flows.push({
            filePath: relative(directory, filePath),
            flowName: analysis.flowName,
            stepCount: analysis.stepCount,
            stepNames: analysis.steps.map((s) => s.name),
          });
        }
      }

      if (flows.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No @celom/prose flows found in ${directory}`,
            },
          ],
        };
      }

      const lines: string[] = [];
      lines.push(`## Found ${flows.length} flow(s)`);
      lines.push('');

      for (const flow of flows) {
        lines.push(`### ${flow.flowName}`);
        lines.push(`**File:** ${flow.filePath}`);
        lines.push(`**Steps (${flow.stepCount}):** ${flow.stepNames.join(' → ')}`);
        lines.push('');
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
