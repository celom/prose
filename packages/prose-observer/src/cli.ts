import { EventStream } from './lib/event-stream.js';
import { startServer } from './lib/server.js';

interface ParsedArgs {
  port: number;
  host: string;
  maxExecutions: number;
  help: boolean;
}

function parseArgs(args: ReadonlyArray<string>): ParsedArgs {
  const parsed: ParsedArgs = {
    port: 4000,
    host: '127.0.0.1',
    maxExecutions: 100,
    help: false,
  };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    const [key, rawValue] = splitArg(arg);
    if (key === '--port') {
      const n = Number(rawValue);
      if (!Number.isFinite(n) || n < 0 || n > 65_535) {
        throw new Error(`invalid --port: ${rawValue}`);
      }
      parsed.port = n;
    } else if (key === '--host') {
      if (!rawValue) throw new Error('--host requires a value');
      parsed.host = rawValue;
    } else if (key === '--max-executions') {
      const n = Number(rawValue);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`invalid --max-executions: ${rawValue}`);
      }
      parsed.maxExecutions = n;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

/**
 * Supports both `--port=4321` and `--port 4321` (the latter via the
 * preceding consumer; this helper only handles the `=` form). The CLI
 * loop above splits before dispatch, so positional pairs work too when
 * `argv` already has them adjacent.
 */
function splitArg(arg: string): [string, string | undefined] {
  const eq = arg.indexOf('=');
  if (eq === -1) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

const USAGE = `prose-console — local-dev observability for @celom/prose flows.

Usage:
  prose-console [--port=<port>] [--host=<host>] [--max-executions=<n>]
  prose console [...]                # same, via the @celom/prose CLI

Options:
  --port=<port>            HTTP/WS port (default 4000)
  --host=<host>            Bind interface (default 127.0.0.1; non-loopback
                           requires the in-process API + allowRemote: true)
  --max-executions=<n>     Ring buffer size for retained executions (default 100)
  -h, --help               Show this help

Standalone, this only serves the UI — there are no in-process flows pushing
events. Use the in-process \`consoleObserver()\` API for a unified observer +
server. See README.md for the wiring.
`;

/**
 * Programmatic entry — the `@celom/prose` CLI uses this when the user runs
 * \`prose console …\`. Returns a promise that resolves once the server is
 * listening; the process stays alive on the HTTP server's open handles.
 */
export async function main(argv: ReadonlyArray<string>): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`prose-console: ${(err as Error).message}`);
    console.error('\n' + USAGE);
    process.exit(2);
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  const eventStream = new EventStream(parsed.maxExecutions);
  const server = await startServer({
    port: parsed.port,
    host: parsed.host,
    eventStream,
  });
  console.log(`Prose Console: ${server.url}`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    console.log('\nshutting down…');
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

// Auto-run when invoked directly (bin / `node dist/cli.js`). When the prose
// CLI dynamic-imports this file, `import.meta.main` is false and the call to
// `main(args.slice(1))` upstairs is the only entry. Falls back to a manual
// argv[1] check on Node versions that don't yet expose `import.meta.main`.
const metaMain = (import.meta as { main?: boolean }).main;
const isEntry =
  metaMain === true ||
  (metaMain === undefined &&
    typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    typeof process.argv[1] === 'string' &&
    import.meta.url === pathToFileURL(process.argv[1]));
if (isEntry) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

function pathToFileURL(p: string): string {
  // Match Node's url.pathToFileURL output without pulling node:url just for this.
  if (p.startsWith('file://')) return p;
  return `file://${p.startsWith('/') ? p : '/' + p}`;
}
