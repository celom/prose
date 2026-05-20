---
slug: prose-console
---

# Prose Console

**Prose Console** is a local devtool that lets a developer see what one of their **Flow** executions actually did — every **Step**, in order, as **Nodes** on the **Flow**'s **Static graph**, with durations and state changes painted on as a **Runtime overlay**.

It is not a production observability backend. It is not multi-tenant. It is not a hosted dashboard. Those are deferred futures, not v1.

The product splits across two npm packages and two processes: the **Emitter** runs inside the user's app and ships events; the **Sidecar** runs in a second terminal, holds the events, and serves the UI.

## What makes this product different from Temporal / Inngest / Effect / XState

Three of those four already ship a UI. None of them render the thing Prose actually is: a *statically analyzable* DSL where the shape of a **Flow** is known before any execution. The console can show that shape — every conditional branch, every parallel fan-out, every `breakIf` exit — as a graph, and *light it up* from runtime events. The static-and-runtime fusion is the differentiator. The same view in a Temporal-style tool degenerates to a Gantt of what happened, with no record of what didn't.

The runtime data is already there. **Prose Console** is a renderer, not new instrumentation.

## Decisions

### Audience: local dev tool first

The product targets Prose users debugging their own **Flows** on their local machine. Production observability — a hosted backend with retention, auth, multi-tenancy — is a deferred future, not part of v1.

The wire shape, the **Trace** model, and the renderer are identical between the two worlds. Production observability later reuses all of that and adds storage + auth on top. No throwaway work; the cost is deferred decisions, not deferred infrastructure.

The strategic counter-argument — that shipping local-first means a year of effort before competing head-to-head with Temporal — is real and was named. We accept it. Local-first has no competitor in the space; the wedge is real.

### Process model: sidecar

The user runs `npx @celom/prose-console` in a second terminal. Their app's **Emitter** ships events over IPC to that **Sidecar**. The **Sidecar** owns the UI, the persistence, and the listening sockets. The user's app owns nothing console-related except the **Emitter** plugged into `execute()`.

Three other shapes were considered:

- **In-process server.** Lowest first-run friction (one npm dep, hit a URL), but every user-app process inherits an HTTP server and a UI bundle, and the **Trace** dies with the app.
- **File-based replay.** Dead simple, traces become shareable JSONL, but no live experience — competes with `pino` logs rather than differentiating from them.
- **Hosted UI bridging to a local socket.** No bundle copy step, but CORS / mixed-content pain and a muddier trust model.

Sidecar wins because (a) it matches the dev-loop pattern users already know from Vite, Storybook, Next dev; (b) it survives the host app's lifecycle without bolting a persistence layer onto the in-app **Observer**; (c) the **Emitter** stays trivial — just an event emitter, no UI, no port binding, no security surface inside the user's app; (d) when production observability ships later, the **Emitter**-to-**Sidecar** wire format is exactly the **Emitter**-to-backend wire format, just pointed at a different destination.

The one-terminal-command first-run cost is acceptable for the target audience.

### Primary visual primitive: directed graph

The **Trace view** renders a DAG. Each **Step** is a **Node**. Edges encode control flow. `stepIf`-skipped **Nodes** appear faded; `breakIf` exits appear as terminal **Nodes** annotated with the return value; retries appear as **Node** decoration; `parallel` fan-out renders as concurrent edges. Durations are **Node** annotations, not edge lengths.

A Gantt timeline was the brainstorm's original primitive. It's better at "where is the time going" and "how do retries stack." But a Gantt is what Temporal and Inngest already do — and crucially, a Gantt cannot show *paths not taken*. A **Flow** with a `stepIf` branch and a `breakIf` shortcut has a story whose interesting part is which branch did it take and where did it bail — and that story is only legible on a graph that shows the unchosen branches dimmed alongside the chosen ones.

The DAG is also the visualization the user's intuition keeps reaching for ("nodes in the execution path"). That intuition is treated as load-bearing signal, not a casual phrasing.

Time isn't lost; it becomes annotation. Latency-dense use cases (heavy `.parallel()`, retry-heavy flows) earn a Gantt strip later as a secondary lens, but the canvas is the graph.

### Flow discovery: static-first, runtime overlay

The **Sidecar** is pointed at the user's workspace on startup. It runs the same static analyzer the `@celom/prose` MCP server already ships (`analyze-flow`, `list-flows`) and builds a **Static graph** for every **Flow** it can find. Runtime events arriving over IPC then paint a **Runtime overlay** onto those **Static graphs** — visited, skipped, errored, broken.

Runtime-only discovery was rejected because half the value of a DAG view is showing the *unchosen* branches. A trace that only contains the path that ran is a fancier log. The **Static graph** is what makes the **Trace view** different from a log scroll.

Source/runtime drift (user is running an old build while editing source) is handled by the **Sidecar** flagging mismatches when runtime events reference **Steps** not in the **Static graph** (or vice versa). Annoying, not catastrophic. A "build is out of date" banner is sufficient.

### Packaging: two npm packages

The runtime, the **Observer** interface, the existing `pinoObserver`, the durability store, the MCP server, and the new **Emitter** all live in `@celom/prose`. The **Sidecar** binary, the UI bundle, the persistence code, and the `prose-console` CLI live in `@celom/prose-console`.

Production installs of `@celom/prose` pay nothing for the console — no UI framework, no HTTP server, no static bundle. The user adds `@celom/prose-console` only as a dev dependency.

The three-package split the brainstorm originally proposed (`@celom/prose` + `@celom/prose-observer` + `@celom/prose-console`) was rejected. The middle package would be a few hundred lines of IPC client; the boundary doesn't earn its weight. If a third-party observer ecosystem materializes later, that's the moment to split — not now.

Wire-format compatibility between the two packages is a real concern. A version check on connection handles it: emitter announces its protocol version, sidecar accepts or refuses with an upgrade hint. The protocol is not expected to churn often.

### Persistence: pure consumer + optional disk dump

The **Sidecar** holds events in an in-memory ring buffer, sized by `maxExecutions`. When the **Sidecar** exits, **Traces** vanish — unless the user opted into a dump-to-disk knob (`~/.prose-console/history.jsonl`), in which case the buffer is dumped on shutdown and reloaded on startup.

The **Sidecar** does *not* read from the user's `DurabilityStore`, even though that surface exists in `@celom/prose`. Coupling the console to an external schema across every store adapter (Memory, SQLite, future Postgres) is more compat surface than v1 deserves. It also widens the threat model — durable runs contain PII; an unauthenticated local UI reading from the same store is a bigger blast radius than necessary. Reading from `DurabilityStore` is the natural data source *when* production observability ships, and the assumption stays open for that future.

The **Sidecar** also does *not* own its own SQLite. A persistent store inside the **Sidecar** is the right architecture for a hosted observability service; for a tool that lives next to `vite dev`, it's overbuilt.

### Correlation ID enforcement: auto-generate with warning

When the **Emitter** is attached and the caller did not pass a **Correlation ID** to `execute()`, the **Emitter** generates a UUID per execution and logs a one-time-per-process warning explaining the cross-system correlation it just lost.

The alternative — throwing at `execute()` time — was rejected because the console must work out-of-the-box for someone trying it for the first time. The warning teaches; the throw frustrates.

Projects with strict correlation-ID policies enforce them at the call site (a lint rule, a wrapper around `execute()`). That's not the package's job.

### Security defaults

Four bars, locked as a bundle:

1. The **Sidecar**'s HTTP/WS server binds `127.0.0.1` by default. Binding any other interface (`--host 0.0.0.0`) requires explicit opt-in and prints a loud startup banner naming the risk.
2. Default redaction runs at every event boundary on a known list of sensitive keys (`authorization`, `password`, `apiKey`, `secret`, `token`, `accessToken`, `refreshToken`, `creditCard`, `cardNumber`, `cvv`, `ssn`, `pin`, `cookie`, `set-cookie`). Matching is case-insensitive and recursive through nested objects. Replacement is `'[REDACTED]'`.
3. A user-supplied `redact: (event) => event` hook runs *after* the built-in defaults, so projects add scrubbing without losing the floor.
4. README, docs, and first-run console log all flag the risk of running an **Observer** over data containing secrets. The 0.0.0.0 banner names the real risk.

A dev-only escape hatch — `unsafeDisableRedaction: true` on the **Emitter**, refused unless `process.env.NODE_ENV !== 'production'`, with a startup warning when set — handles the legitimate friction of redaction-during-auth-debugging without making the production posture unsafe.

OTel relationship is *complement*, not *replace*. Users keep their OTel exporter. The **Correlation ID** is the shared bridge between OTel spans and Prose **Traces**.

## Assumptions

1. Prose users have their local source code available when running the **Sidecar**. The **Static graph** analyzer needs a workspace path. Users running the console against a built artifact without source are not the v1 audience.
2. `FlowObserver` events are sufficient to reconstruct a **Trace** for the UI. No Prose-internal state required by the **Trace view** is hidden from the existing observer surface.
3. Users running the console accept that runtime data (post user-supplied redaction) flows over `127.0.0.1` to a browser UI. The threat model assumes the local machine is trusted; secrets surviving redaction and leaking to a coworker on the same Wi-Fi is the worst-case failure mode the security defaults exist to prevent.
4. OTel and **Prose Console** coexist. The console does not impersonate an OTel backend.
5. The `@celom/prose` MCP server's static analyzer (`analyze-flow`, `list-flows`) is a stable enough surface that the **Sidecar** can depend on it. If that analyzer churns, the **Sidecar** churns with it. This is intentional coupling — one analyzer, two consumers.

## Stubs

Each entry below is a sub-topic that has its own decisions to make. Promoted to child frames as they get grilled.

- **trace-view** — DAG rendering specifics: graph library choice, layout algorithm, retry/skip/break visual treatment, state-diff inspector, **Node** interaction model. *Created 2026-05-20.*
- **flow-catalog** — aggregate stats view: what's listed per **Flow**, which statistics surface (p50/p95, error rates, common `breakIf` exit values), refresh model. *Created 2026-05-20.*
- **live-tail** — streaming experience: subscription model, backpressure when **Traces** flood, sampling strategy. *Created 2026-05-20.*
- **sidecar-architecture** — IPC transport (Unix socket vs loopback TCP), **Sidecar** discovery from the **Emitter**, lifecycle (foreground vs daemon), multiplexing across multiple user-app processes, port allocation. *Created 2026-05-20.*
- **event-protocol** — wire format details: event shapes per `FlowObserver` hook, version negotiation between **Emitter** and **Sidecar**, redaction implementation, state-capture modes (`full | diff | shallow | off`). *Created 2026-05-20.*
- **static-analysis-integration** — workspace discovery, monorepo handling, build-vs-source drift detection, mismatch UI. *Created 2026-05-20.*
- **production-observability** — the deferred v2: backend persistence, retention, auth, multi-tenancy, OTel relationship at scale, `DurabilityStore` readback as a data source. *Created 2026-05-20.*
- **parallel-branch-parenting** — small change to the `@celom/prose` `FlowObserver` interface: an optional `parentStepName` (or equivalent) on **Step** events so concurrency is explicit instead of timestamp-inferred. Independent of the console; can land in `@celom/prose` on its own merits. May be promoted out of this frame entirely if scoped as runtime work. *Created 2026-05-20.*

## Deferred questions

Not blocking spec, parked with a one-line reason.

- Specific graph library / UI framework — child frame (**trace-view**).
- IPC transport choice — child frame (**sidecar-architecture**).
- Disk-dump format (JSONL vs something more structured) — child frame (**event-protocol**).
- Sampling and backpressure for high-throughput **Flows** — child frame (**live-tail**).
