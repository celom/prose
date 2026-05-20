---
slug: prose-console-spec
parent: ../frame/00-prose-console.md
status: draft
---

# Spec: Prose Console v1

This spec implements the decisions captured in [`../frame/00-prose-console.md`](../frame/00-prose-console.md). It does **not** restate them — when the frame and spec appear to disagree, the frame wins and this spec is wrong. Shared vocabulary is canonical in [`../frame/DOMAIN.md`](../frame/DOMAIN.md).

## Objective

Ship a local devtool that lets a Prose user run their app + `npx @celom/prose-console` in two terminals and see, in a browser at `127.0.0.1`, every **Flow** execution rendered as its **Static graph** painted with a **Runtime overlay**, alongside a **Flow catalog** of aggregate stats and a **Live tail** of in-flight events.

Users are developers debugging their own **Flows** on their own machine. Not multi-tenant. Not hosted. No auth surface beyond loopback-bind defaults.

The wedge: every competitor (Temporal, Inngest, Effect, XState) that ships a UI renders only what ran. **Prose Console** renders the **Static graph** — including conditional branches not taken and `breakIf` shortcuts not triggered — and lights it up from runtime events.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node ≥ 20 | Matches `@celom/prose` baseline |
| Language | TypeScript 5.9, strict | Same `tsconfig.base.json` |
| Monorepo | Nx 22.5 with npm workspaces | New `@celom/prose-console` package alongside `@celom/prose` |
| Emitter dependencies | None beyond `@celom/prose` itself | The Emitter ships *in* `@celom/prose`; its bundle cost is enforced (see Success Criteria) |
| Sidecar IPC | Loopback TCP for v1; Unix socket opt-in deferred | See Open Question #3 |
| Sidecar HTTP/WS | `node:http` + `ws` | No Express/Fastify; the surface is tiny |
| UI framework + DAG lib | TBD in child frame **trace-view** | Leading candidates: React + Dagre/ELK/Reaflow |
| Test | Vitest 4 | Workspace default |
| Lint | ESLint 9 flat config | Workspace default |

## Commands

```
# Inside the prose monorepo
npx nx build prose-console              # Build the new package
npx nx test prose-console               # Vitest suite
npx nx lint prose-console               # ESLint
npx nx run prose-console:dev            # Sidecar with UI hot-reload

# Existing @celom/prose targets (Emitter rides their pipeline)
npx nx build prose
npx nx test prose

# What a user runs in their app
npx @celom/prose-console                 # Defaults: --host 127.0.0.1 --port 4915 --workspace .
npx @celom/prose-console --workspace /path/to/app
npx @celom/prose-console --host 0.0.0.0  # Prints loud security banner before start
npx @celom/prose-console --max-executions 200
npx @celom/prose-console --dump-disk     # Reload buffer from ~/.prose-console/history.jsonl on start; flush on exit
```

Port 4915 is unassigned by IANA and easy to remember (`4-9-1-5` reads as "four nine fifteen"); change is non-breaking.
Env override: `PROSE_CONSOLE_URL=http://127.0.0.1:4915` for the Emitter side.

## Project Structure

```
packages/
  prose/                                    [existing package]
    src/lib/
      observer.ts                           [existing; no breaking change]
      console-emitter.ts                    NEW. Default Emitter implementation
      flow-graph.ts                         NEW. FlowGraph type — the wire-shape of a Static graph
      __tests__/console-emitter.spec.ts     NEW
    src/mcp/tools/
      analyze-flow.ts                       EXTEND. Add FlowGraph topology output
                                                   (edges, parallel groups, conditional branches)
                                                   alongside existing flat step list
      list-flows.ts                         [unchanged]
  prose-console/                            [new package]
    src/
      sidecar/
        server.ts                           HTTP + WS listener, IPC ingest
        ring-buffer.ts                      In-memory Trace store, capped by maxExecutions
        analyzer.ts                         Wraps analyze-flow / list-flows for workspace scan
        protocol.ts                         Wire types, version negotiation
        redactor.ts                         Default redaction + user hook composition
        disk-dump.ts                        ~/.prose-console/history.jsonl reader/writer
      ui/
        app.tsx
        trace-view/                         DAG render + Runtime overlay + state-diff inspector
        flow-catalog/                       List of Flows + aggregate stats
        live-tail/                          In-flight Trace stream
      cli.ts                                `prose-console` binary
    package.json
docs/
  frame/                                    [existing decision docs]
  console/
    SPEC.md                                 This document
```

## Code Style

Conventions follow `@celom/prose` today. One representative snippet — the Emitter's public shape and the attach pattern that resolves the **Correlation ID** auto-generation problem:

```ts
import type {
  FlowObserver,
  FlowExecutionOptions,
  BaseFlowDependencies,
  FlowState,
} from '@celom/prose';

export interface EmitterOptions {
  /** Sidecar endpoint. Default: env PROSE_CONSOLE_URL or http://127.0.0.1:4915. */
  sidecar?: string;
  /** Per-process tag so the Sidecar can multiplex across multiple user-app processes. */
  originId?: string;
  /** User scrubber. Runs AFTER built-in defaults — cannot un-redact. */
  redact?: (event: EmitterEvent) => EmitterEvent;
  /** Dev-only escape hatch. Refused unless NODE_ENV !== 'production'. */
  unsafeDisableRedaction?: boolean;
}

export interface ConsoleEmitter<TInput, TDeps extends BaseFlowDependencies, TState extends FlowState>
  extends FlowObserver<TInput, TDeps, TState> {
  /**
   * Fills in observer + correlationId on FlowExecutionOptions, generating a UUID
   * and emitting a one-time-per-process warning if correlationId is missing.
   * Preserves any options the caller already set.
   */
  attach: (
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) => FlowExecutionOptions<TInput, TDeps, TState>;
}

export function createConsoleEmitter<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
>(opts: EmitterOptions = {}): ConsoleEmitter<TInput, TDeps, TState>;
```

Usage stays one line at the call site:

```ts
const emitter = createConsoleEmitter();
await flow.execute(input, deps, emitter.attach({ timeout: 5_000 }));
```

The `attach()` helper exists because the **Correlation ID** must be settled *before* `execute()` is called (the runtime reads it from `options.correlationId` into `FlowMeta` synchronously). Putting it on the Emitter keeps the auto-generation policy in one place and out of the user's hands.

**Conventions:**
- Use the DOMAIN vocabulary verbatim in code, comments, docs, and UI strings.
- No mid-file comments restating what code does. Comment only when the *why* is non-obvious (security invariant, race, frame-level decision being enforced).
- Public API in `src/index.ts` re-exports. Consumers do not import deep paths.
- Tests co-located under `__tests__/`.
- All errors are typed `Error` subclasses, never thrown strings or objects.

## Testing Strategy

| Level | Tool | Where | What it covers |
|---|---|---|---|
| Unit | Vitest | `__tests__/*.spec.ts` next to source | Pure logic: redaction, protocol framing, ring buffer eviction, FlowGraph analyzer, version-negotiation refusals |
| Integration | Vitest with real sockets | `packages/prose-console/src/**/__tests__/*.int.spec.ts` | Emitter ↔ Sidecar roundtrip end-to-end over the actual IPC transport, for one **Trace** through the four `FlowObserver` hooks that exercise edge cases (skip, retry, break, parallel) |
| UI smoke | Playwright | `packages/prose-console/e2e/` | Launch Sidecar, open browser, assert one **Trace** renders with **Runtime overlay**; assert the four security gates (loopback default, redaction, 0.0.0.0 banner, dev escape hatch) |

**Coverage targets:**
- `@celom/prose` Emitter ≥ 90% (security-critical, small surface).
- Sidecar core (`server.ts`, `ring-buffer.ts`, `protocol.ts`, `redactor.ts`) ≥ 85%.
- UI: smoke + key flows only. No pixel-perfect snapshots.

**Tests that MUST exist before v1:**
- Default redaction strips every key in the locked list (`authorization`, `password`, `apiKey`, `secret`, `token`, `accessToken`, `refreshToken`, `creditCard`, `cardNumber`, `cvv`, `ssn`, `pin`, `cookie`, `set-cookie`), case-insensitive, recursive through nested objects.
- User `redact` hook runs *after* defaults — assertion: a test that tries to un-redact via the hook still sees `[REDACTED]` in the wire payload.
- `unsafeDisableRedaction: true` is rejected (throws) when `NODE_ENV === 'production'`.
- Missing **Correlation ID** auto-generates a UUID AND emits exactly one warning per process (not per-execution). A second `execute()` without a **Correlation ID** does not warn again.
- Wire-format version mismatch refuses the connection with a clear upgrade hint; does not crash either side.
- Ring buffer evicts the oldest *completed* **Trace** at `maxExecutions`; in-flight **Traces** are never evicted.
- Disk dump round-trips a representative **Trace** (with skip, retry, break, parallel) without loss.
- **Static graph** ↔ runtime drift (a `stepName` arrives that isn't in the graph, or vice versa) shows a banner; rendering continues.
- 0.0.0.0 bind prints the security banner before the listener opens.

## Boundaries

**Always:**
- Bind `127.0.0.1` by default. Any other interface requires `--host` and prints the security banner *before* the listener opens.
- Run default redaction on every event boundary before any user code (including the user `redact` hook) sees the payload.
- Auto-generate a **Correlation ID** when missing and log a one-time-per-process warning.
- Use the DOMAIN vocabulary in code, docs, UI strings, and error messages.
- Bump the wire-format protocol version on any breaking change; reject mismatched versions explicitly with an upgrade hint.
- Preserve the `@celom/prose` package zero-dependency posture — the Emitter must not pull in transitive deps.

**Ask first:**
- Adding a runtime field to `FlowObserver` (e.g. `parentStepName`) — this is a `@celom/prose` API change with independent consumers. The frame's `parallel-branch-parenting` stub names this; the spec assumes it lands as non-breaking optional, but the actual landing is a separate PR with its own review.
- Reading from `DurabilityStore` from the Sidecar — explicitly out of scope for v1; revisit only as part of deferred production-observability v2.
- Adding any new persistent storage to the Sidecar (SQLite, IndexedDB, etc.) — the frame rejected this for v1.
- Choosing the graph layout library or UI framework — decision belongs in **trace-view** child frame.
- Choosing the IPC transport for the Unix-socket opt-in — decision belongs in **sidecar-architecture** child frame.
- Backpressure / sampling strategy for the **Live tail** — belongs in **live-tail** child frame.

**Never:**
- Bundle a UI / HTTP server / framework into `@celom/prose`. The Emitter is deps-free.
- Ship a Sidecar default that exposes anything beyond `127.0.0.1` without explicit flag + banner.
- Render runtime events without rendering the **Static graph** beneath them. The view never degrades to a Gantt or a log scroll — that is the entire wedge.
- Skip default redaction. The `unsafeDisableRedaction` flag exists for dev; production builds refuse it.
- Throw at `execute()` when **Correlation ID** is missing — warn-and-generate per frame.
- Add a third package (no `@celom/prose-observer`) until a third-party Observer ecosystem actually demands it.
- Mutate `FlowContext.state` from the Emitter. The Emitter reads; the runtime writes.

## Success Criteria

v1 ships when, on a fresh machine, a user can:

1. `npm install @celom/prose @celom/prose-console --save-dev` in an existing TS project already using `@celom/prose`.
2. Add `emitter.attach()` to one `execute()` call.
3. Run `npx @celom/prose-console --workspace .` in a second terminal.
4. Open the URL printed by the Sidecar.
5. Trigger their **Flow**.
6. See, in the UI, within 1s of the **Flow** completing:
   - **Trace view**: the **Flow**'s **Static graph** rendered as a DAG. Each **Step** is a **Node**. Visited **Nodes** filled; skipped **Nodes** faded; `breakIf` exits as terminal **Nodes** annotated with their return value; retried **Nodes** decorated with attempt count; `parallel` **Steps** rendered as concurrent edges. Per-**Node** duration as annotation. Per-**Node** state diff in an inspector pane.
   - **Flow catalog**: every **Flow** the analyzer found in the workspace, listed with execution count, p50/p95 duration, error rate, and most common `breakIf` exit values aggregated across the in-memory buffer.
   - **Live tail**: an in-flight **Flow** updates its **Runtime overlay** **Node**-by-**Node** as events arrive, without manual refresh.
7. With `NODE_ENV` unset and no custom `redact`, send a **Step** whose state contains `authorization: 'Bearer xyz'`; the UI shows `[REDACTED]`, never the token. The token also does not appear in the disk dump.
8. Run `npx @celom/prose-console --host 0.0.0.0` and see the security banner *before* the server starts listening.

Additionally:
- Protocol-version handshake is enforced. Mismatched versions are refused with a clear upgrade hint, on both ends.
- A **Flow** whose source has drifted from the running build shows a "build is out of date" banner instead of crashing.
- Adding the Emitter to `@celom/prose` increases its parsed-JS size by no more than ~5KB gzipped. (The runtime stays small. CI-enforced.)
- Sidecar cold start to UI-ready < 2s on a workspace with 50 **Flows**.

## Open Questions

Tracked in named child frames. The spec does not resolve them.

1. **Static-graph analyzer fidelity** — `static-analysis-integration`, `trace-view`. The current `analyze-flow.ts` is regex-based and emits a flat step list. The **Static graph** needs an edge list with conditional, parallel, and break topology. *Recommendation:* extend `analyze-flow` to emit a `FlowGraph` object additively (existing MCP consumers unaffected). Use a TypeScript AST traversal (`ts-morph`) for accuracy; the AST dep is paid by `@celom/prose-console`, not `@celom/prose`. Decision deferred to the child frame.

2. **`parentStepName` on Step events** — `parallel-branch-parenting`. Without this, parallel branches are timestamp-inferred, which is fragile. *Recommendation:* land it in `@celom/prose` as a non-breaking optional field before v1; this spec assumes it ships. Decision deferred to that frame.

3. **IPC transport** — `sidecar-architecture`. Loopback TCP for v1; Unix socket opt-in `--ipc unix:/path` deferred. Windows-friendly by default. Final call deferred.

4. **UI framework + graph lib** — `trace-view`. Fully open.

5. **Live-tail backpressure** — `live-tail`. At hundreds of events/sec the Sidecar will outrun the WS push. *Recommendation:* coalesce per-`(correlationId, stepName)` at 60Hz; never drop terminal events (`onFlowComplete`/`Error`/`Break`). Decision deferred.

6. **Multi-process multiplexing** — `sidecar-architecture`. Two services on the same dev machine emit to one Sidecar. *Recommendation:* tag every event at the Emitter with `originId`; UI groups by origin then by **Flow**. Decision deferred.

7. **Disk-dump format** — `event-protocol`. *Recommendation:* JSONL prefixed with one header line `{"$protocol":N}`. Decision deferred.

## Verification Before Implementation

The spec is ready when these are all true:

- [ ] Human has reviewed and approved.
- [ ] Success criteria are specific and testable (currently 8 numbered + 4 supplementary).
- [ ] Boundaries (Always / Ask First / Never) are concrete, not platitudes.
- [ ] Every Open Question is owned by a named child frame.
- [ ] Saved to `docs/console/SPEC.md`, version-controlled with the code.
