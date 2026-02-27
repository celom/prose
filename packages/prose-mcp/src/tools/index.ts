import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerScaffoldFlow } from './scaffold-flow.js';
import { registerAnalyzeFlow } from './analyze-flow.js';
import { registerListFlows } from './list-flows.js';
import { registerValidateFlowPattern } from './validate-flow-pattern.js';

export function registerTools(server: McpServer) {
  registerScaffoldFlow(server);
  registerAnalyzeFlow(server);
  registerListFlows(server);
  registerValidateFlowPattern(server);
}
