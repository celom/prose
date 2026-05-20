# Prose

A declarative TypeScript DSL for orchestrating multi-step business operations with type-safe state threading, optional durability, and pluggable observation. **Prose Console** is the local visualization product layered on top of Prose's existing observer interface.

## Language

### Runtime vocabulary

These terms are defined by the `@celom/prose` runtime and are referenced — never redefined — by frame docs.

**Flow**:
A declarative pipeline of **Steps** with type-safe state threading between them.
_Avoid_: workflow, pipeline (when referring to the Prose construct specifically).

**Step**:
One named unit of execution inside a **Flow** — validation, executor, transaction, event, or break.
_Avoid_: stage, task, node (when referring to the runtime construct; **Node** is reserved for the **Trace view**).

**Observer**:
The hook surface a **Flow** execution emits lifecycle events to — start, complete, error, retry, skip, break — via the `FlowObserver` interface.
_Avoid_: listener, hook, reporter.

**Correlation ID**:
The execution-scoped identifier that groups every event from a single **Flow** run, used to assemble a **Trace** and to bridge to other systems' logs.
_Avoid_: trace ID, request ID, run ID (these are distinct concepts elsewhere).

### Console vocabulary

These terms are introduced by **Prose Console** and live here.

**Prose Console**:
The local devtool that visualizes **Flow** executions as graphs of **Steps**, distributed across an in-app **Emitter** and a standalone **Sidecar**.
_Avoid_: dashboard, devtool, UI (these are aspects, not the product).

**Emitter**:
The `Observer` implementation that runs inside the user's app process and ships events over IPC to the **Sidecar**. Ships in `@celom/prose`.
_Avoid_: sender, client, adapter.

**Sidecar**:
The standalone local process (`npx @celom/prose-console`) that receives events from one or more **Emitters**, holds them in a ring buffer, runs the **Static graph** analyzer, and serves the UI. Ships in `@celom/prose-console`.
_Avoid_: server, daemon, agent.

**Trace**:
The complete set of events for one **Flow** execution, grouped by **Correlation ID**.
_Avoid_: run, execution log, history.

**Trace view**:
The UI surface that renders one **Trace** as a **Runtime overlay** on its **Static graph**.
_Avoid_: detail view, run view.

**Flow catalog**:
The UI surface that lists every analyzable **Flow** in the workspace with aggregate runtime statistics across recent **Traces**.
_Avoid_: index, dashboard, registry.

**Live tail**:
The UI surface that streams in-flight **Trace** events as they arrive at the **Sidecar**.
_Avoid_: tail, monitor, watch.

**Static graph**:
The DAG of a **Flow** derived by static analysis of its definition — every **Step**, every conditional branch, every parallel fan-out — independent of any execution. Reuses the analyzer the `@celom/prose` MCP server already ships.
_Avoid_: definition, schema, structure.

**Runtime overlay**:
The visual layer painted onto a **Static graph** that shows which **Nodes** were visited, skipped, errored, retried, or short-circuited by a particular **Trace**, with durations and state diffs as annotations.
_Avoid_: trace overlay, execution overlay.

**Node**:
The visual unit on a **Static graph** corresponding to one **Step**. (The runtime concept is **Step**; the visual concept is **Node**. Same thing seen from two sides.)
_Avoid_: vertex, box.

## Relationships

- A **Flow** is composed of one or more **Steps**.
- A **Flow** execution produces exactly one **Trace**, identified by one **Correlation ID**.
- A **Trace** contains zero or more events per **Step** (a **Step** may be skipped, may retry, may emit only a `start` if the execution was interrupted).
- A **Static graph** belongs to one **Flow** definition; many **Traces** for that **Flow** are rendered as **Runtime overlays** on the same **Static graph**.
- An **Emitter** ships events from one user app process; a **Sidecar** consumes events from one or more **Emitters**.
- **Prose Console** is the **Emitter** + **Sidecar** + UI together; no single piece is the product.

## Flagged ambiguities

- "step" was used to mean both the runtime construct and the visual unit. Resolved: **Step** is runtime, **Node** is visual. A **Node** on a **Static graph** represents a **Step** in the **Flow** definition.
- "observer" was used to mean both the `FlowObserver` interface and any concrete implementation. Resolved: **Observer** is the abstract role (the interface); **Emitter** is the specific console-shipping implementation.
