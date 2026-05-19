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
} else if (command === 'console') {
  try {
    // Indirect dynamic import so Nx's project-graph analyzer doesn't infer a
    // build-time edge from @celom/prose to @celom/prose-observer (which would
    // form a cycle with the observer's own dep on @celom/prose).
    const observerEntry = '@celom/prose-observer' + '/cli.js';
    const observerModule = (await import(observerEntry)) as {
      main: (argv: string[]) => Promise<void>;
    };
    await observerModule.main(args.slice(1));
  } catch (e) {
    if (
      e instanceof Error &&
      'code' in e &&
      (e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
    ) {
      console.error(
        'Prose Console requires an extra package.\n' +
          'Install it with: npm install @celom/prose-observer'
      );
      process.exit(1);
    }
    throw e;
  }
} else {
  console.error(
    `Unknown command: ${command ?? '(none)'}\nUsage: prose <mcp|console>`
  );
  process.exit(1);
}
