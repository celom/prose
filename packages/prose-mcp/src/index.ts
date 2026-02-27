#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';
import { registerPrompts } from './prompts/index.js';

const server = new McpServer({
  name: '@celom/prose-mcp',
  version: '0.1.0',
});

registerResources(server);
registerTools(server);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
