import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';
import { registerPrompts } from './prompts/index.js';

declare const __PROSE_VERSION__: string;

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: '@celom/prose',
    version: __PROSE_VERSION__,
  });

  registerResources(server);
  registerTools(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
