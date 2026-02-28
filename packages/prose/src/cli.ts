const args = process.argv.slice(2);
const command = args[0];

if (command === 'mcp') {
  try {
    const { startMcpServer } = await import('./mcp/server.js');
    await startMcpServer();
  } catch (e) {
    if (
      e instanceof Error &&
      'code' in e &&
      (e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
    ) {
      console.error(
        'MCP server requires additional dependencies.\n' +
          'Install them with: npm install @modelcontextprotocol/sdk zod'
      );
      process.exit(1);
    }
    throw e;
  }
} else {
  console.error(
    `Unknown command: ${command ?? '(none)'}\nUsage: prose mcp`
  );
  process.exit(1);
}
