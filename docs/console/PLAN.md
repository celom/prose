---
slug: prose-console-plan
parent: ./SPEC.md
status: draft
---

# Implementation Plan: Prose Console v1

Implements [`./SPEC.md`](./SPEC.md). Frame is at [`../frame/00-prose-console.md`](../frame/00-prose-console.md); vocabulary at [`../frame/DOMAIN.md`](../frame/DOMAIN.md). When this plan and the spec disagree, the spec wins.

## Overview

27 tasks across 7 phases. Phase 0 resolves the three spec Open Questions that block code (analyzer approach, UI framework, `parentStepName` runtime change). Phases 1–2 build the wire format + headless Sidecar end-to-end before any pixel renders. Phase 3 ships the Trace view. Phases 4 and 5 (Flow catalog, Live tail) are parallelizable after Phase 3. Phase 6 is ship polish.

## Architecture Decisions Already Made

Inherited from the frame and spec; the plan does not re-litigate them.

- Sidecar process model with loopback TCP IPC for v1.
- Emitter ships in `@celom/prose`; UI bundle and Sidecar binary ship in `@celom/prose-console`.
- In-memory ring buffer; optional JSONL disk dump; no SQLite, no `DurabilityStore` read.
- Loopback bind by default; redaction default-on with locked key list; user `redact` hook composes *after*.
- Auto-generate **Correlation ID** with one-time warning; do not throw.
- **Trace view** is a DAG that fuses **Static graph** + **Runtime overlay**; never degrade to a Gantt or log.

## Dependency Graph

```
Phase 0 (decisions, human-driven)
    │
    ▼
Phase 1: Wire foundation
    1.1 wire protocol types ──┐
    1.2 analyze-flow → FlowGraph (depends on Task 0.1)
    1.3a Emitter pure logic (depends on 1.1, Task 0.3)
    1.3b Emitter transport (depends on 1.3a)
    │
    ▼
Phase 2: Sidecar headless
    2.1 package bootstrap
    2.2 IPC ingest        ◄── 1.1, 1.3b, 2.1
    2.3 ring buffer
    2.4 workspace analyzer  ◄── 1.2
    2.5 HTTP + CLI         ◄── 2.2, 2.3, 2.4
    2.6 e2e headless        ◄── Phase 1 + 2.1–2.5
    │
    ▼
Phase 3: Trace view UI (depends on 0.2, Phase 2)
    3.1 UI scaffold
    3.2a Static graph layout
    3.2b Static graph edges
    3.3 Runtime overlay
    3.4 State-diff inspector
    3.5 Drift banner
    │
    ▼
Phase 4: Flow catalog ──┐
                        ├── Parallelizable after Phase 3
Phase 5: Live tail   ──┘
    │
    ▼
Phase 6: Ship polish
```

## Task List

### Phase 0: Decisions (human-driven)

#### Task 0.1: Decide static-analyzer approach

Resolves [SPEC Open Question #1](./SPEC.md#open-questions).

**Description:** Decide between extending the existing regex-based `packages/prose/src/mcp/tools/analyze-flow.ts` with topology output, or rewriting to use TypeScript AST traversal (`ts-morph`). The spec recommends ts-morph, with the AST dep paid by `@celom/prose-console`, not `@celom/prose`.

**Acceptance:**
- Written decision in `docs/frame/01-static-analysis-integration.md` naming the chosen approach.
- Decision answers: where does the analyzer live, is the AST dep shared or Console-only, what does the `FlowGraph` output shape look like.

**Verification:** Decision doc exists, referenced from SPEC.md; SPEC Open Question #1 marked resolved.

**Dependencies:** None.

**Files:** `docs/frame/01-static-analysis-integration.md`.

**Size:** S (decision, not code).

---

#### Task 0.2: Decide UI framework + DAG library

Resolves [SPEC Open Question #4](./SPEC.md#open-questions).

**Description:** Choose UI framework (React / Solid / Svelte / Preact) and DAG layout library (Dagre.js / ELK.js / Reaflow / React Flow). Build a throwaway spike that renders one realistic Prose Flow with skip, parallel, and break decorations to validate the choice.

**Acceptance:**
- Written decision in `docs/frame/02-trace-view.md` naming framework + layout library.
- Spike renders the fixture Flow with all four state decorations visible.
- Bundle-size budget for the UI bundle is named (separate from the `@celom/prose` 5KB Emitter budget).

**Verification:** Spike runs; reviewer agrees the rendering is acceptable; decision doc landed.

**Dependencies:** None.

**Files:** `docs/frame/02-trace-view.md`; throwaway `packages/prose-console/spike/` (deleted after decision).

**Size:** M (spike + decision).

---

#### Task 0.3: Land `parentStepName` in `@celom/prose`

Resolves [SPEC Open Question #2](./SPEC.md#open-questions).

**Description:** Add an optional `parentStepName?: string` field to the `FlowObserver` Step events so parallel branches can be explicitly parented instead of timestamp-inferred. Non-breaking: existing observer implementations continue to work.

**Acceptance:**
- Optional field present on `onStepStart` / `onStepComplete` / `onStepError` / `onStepRetry` / `onStepSkipped`.
- Existing `DefaultObserver` and `pinoObserver` compile without changes.
- Unit test executes a `.parallel()` Flow and asserts each parallel Step receives a non-null `parentStepName` pointing at the `.parallel()` Step that fanned it out.

**Verification:** `pnpm nx test prose` passes; `pnpm nx build prose` passes.

**Dependencies:** None.

**Files:** `packages/prose/src/lib/observer.ts`, `packages/prose/src/lib/flow-executor.ts`, `packages/prose/src/lib/__tests__/observer.spec.ts`.

**Size:** M.

---

### Phase 0 Checkpoint
- [ ] Three decisions documented in `docs/frame/`.
- [ ] `parentStepName` change merged in `@celom/prose`.
- [ ] SPEC Open Questions #1, #2, #4 struck through and linked to their decision docs.
- [ ] Reviewed with human before Phase 1.

---

### Phase 1: Wire foundation

#### Task 1.1: Define wire-format protocol types

**Description:** Create `packages/prose-console/src/sidecar/protocol.ts` defining the handshake envelope (`HelloEmitter` / `HelloSidecar` with `protocolVersion: 1`) and the per-event union (`flow.start` / `flow.complete` / `flow.error` / `flow.break` / `step.start` / `step.complete` / `step.error` / `step.retry` / `step.skipped`). Each event carries `correlationId`, `originId`, optional `parentStepName`. Provide a version-mismatch refusal helper.

**Acceptance:**
- Every `FlowObserver` hook has a serializable wire-event counterpart.
- All event types round-trip through `JSON.stringify` / `JSON.parse` with no data loss.
- Handshake mismatch produces the expected refusal payload + upgrade hint string.

**Verification:** Vitest unit tests in `__tests__/protocol.spec.ts`.

**Dependencies:** Task 0.3.

**Files:** `packages/prose-console/src/sidecar/protocol.ts`, `packages/prose-console/src/sidecar/__tests__/protocol.spec.ts`.

**Size:** M.

---

#### Task 1.2: Extend `analyze-flow` to emit `FlowGraph`

**Description:** Per Task 0.1's chosen approach, extend the analyzer to return a `FlowGraph` (`{ nodes: Node[]; edges: Edge[]; }`) alongside the existing flat step list. `Node` carries `name`, `type` (`validate` / `step` / `stepIf` / `breakIf` / `parallel` / ...). `Edge` carries `from`, `to`, `kind` (`sequential` / `conditional-skip` / `parallel-branch` / `break-exit`). Existing MCP consumers see no breaking change.

**Acceptance:**
- `analyzeFlowSource(src)` returns the existing fields *plus* `graph: FlowGraph`.
- Golden test: a fixture Flow with `.stepIf()`, `.parallel()`, `.breakIf()` produces exactly the expected nodes + edges.
- Existing `analyze-flow` MCP tool consumers receive the original fields unchanged.

**Verification:** `pnpm nx test prose` passes including new golden test.

**Dependencies:** Task 0.1.

**Files:** `packages/prose/src/mcp/tools/analyze-flow.ts`, `packages/prose/src/lib/flow-graph.ts`, `packages/prose/src/mcp/tools/__tests__/analyze-flow.spec.ts`, fixture Flow.

**Size:** M.

---

#### Task 1.3a: Emitter — redaction, correlation ID, attach helper (pure logic)

**Description:** Implement the pure-logic half of the Emitter in `packages/prose/src/lib/console-emitter.ts`. `createConsoleEmitter()` returns a `FlowObserver` whose hooks build wire events, run the locked-list default redaction, then run the user `redact` hook. `attach(options)` fills in `observer` and auto-generates a `correlationId` if missing, emitting a one-time-per-process warning. No transport yet — wire events are exposed via a test queue.

**Acceptance:**
- All locked-list keys (`authorization`, `password`, `apiKey`, `secret`, `token`, `accessToken`, `refreshToken`, `creditCard`, `cardNumber`, `cvv`, `ssn`, `pin`, `cookie`, `set-cookie`) redact case-insensitive and recursive.
- User `redact` hook composition: a hook that returns the original event still sees `[REDACTED]` in the locked-list keys (cannot un-redact).
- `unsafeDisableRedaction: true` throws when `NODE_ENV === 'production'`.
- `attach({})` returns options with `correlationId` set; `attach({ correlationId: 'foo' })` preserves `'foo'`.
- Warning fires once per process, even after 10+ `attach()` calls without a `correlationId`.

**Verification:** `pnpm nx test prose --testPathPattern=console-emitter` passes.

**Dependencies:** Task 1.1.

**Files:** `packages/prose/src/lib/console-emitter.ts`, `packages/prose/src/lib/__tests__/console-emitter.spec.ts`, `packages/prose/src/lib/index.ts` (re-export).

**Size:** M.

---

#### Task 1.3b: Emitter — transport (TCP send + reconnect)

**Description:** Plug TCP transport into the Emitter. Connects to `PROSE_CONSOLE_URL` (or `127.0.0.1:4915`); sends the protocol handshake; frames and ships events. On disconnect, reconnects with bounded backoff (max ~8 retries). Maintains a bounded in-memory queue (e.g., 1000 events) for offline buffering; drops oldest if exceeded. Connection failure must never throw to the host app.

**Acceptance:**
- Integration test (using a test TCP server) confirms handshake + event round-trip.
- Disconnect → reconnect within bounded backoff; queued events flush on reconnect.
- Sidecar unreachable scenario: host app continues, Emitter logs but does not throw.
- Queue overflow drops oldest events and logs a one-time warning.

**Verification:** Vitest integration test with a real TCP server.

**Dependencies:** Task 1.3a.

**Files:** `packages/prose/src/lib/console-emitter.ts` (extended), `packages/prose/src/lib/console-emitter-transport.ts`, `packages/prose/src/lib/__tests__/console-emitter.int.spec.ts`.

**Size:** M.

---

### Phase 1 Checkpoint
- [ ] All wire types exist and round-trip cleanly.
- [ ] Emitter passes every redaction, correlation-ID, transport test.
- [ ] `analyze-flow` returns `FlowGraph` for the golden fixture; existing consumers unchanged.
- [ ] `pnpm nx build prose` succeeds; bundle-size delta ≤ 5KB gzipped (manual check; CI gate lands in Task 6.3).

---

### Phase 2: Sidecar headless

#### Task 2.1: Bootstrap `@celom/prose-console` package

**Description:** Create the Nx project for `packages/prose-console` with `build`, `test`, `lint`, `dev` targets. `package.json` declares `bin: { "prose-console": "./dist/cli.js" }`. Bundler matches the workspace default (Vite). Directory structure (`src/sidecar/`, `src/ui/`, `src/cli.ts`) created; everything else is empty stubs.

**Acceptance:**
- `pnpm nx build prose-console` succeeds with empty stubs.
- `pnpm nx test prose-console` runs (zero tests is fine).
- `pnpm nx lint prose-console` passes.
- Project appears in `nx show projects`.

**Verification:** All four Nx targets pass.

**Dependencies:** None.

**Files:** `packages/prose-console/` skeleton (~10 stub files).

**Size:** M (one-time scaffolding; touches more files than typical but each is trivial).

---

#### Task 2.2: Sidecar IPC ingest + handshake

**Description:** TCP server on `127.0.0.1:4915` that accepts framed JSON connections, performs the protocol handshake, and forwards parsed events to an internal `EventEmitter`. Refuses mismatched protocol versions with the upgrade-hint payload. Supports multiple concurrent Emitter connections, each tagged with `originId`.

**Acceptance:**
- Handshake roundtrip test passes against the real Emitter (Task 1.3b).
- Mismatched-version refusal test passes; client sees a clear error, not a hang.
- Two concurrent connections with distinct `originId`s have their event streams interleaved correctly into the internal `EventEmitter`.

**Verification:** Vitest integration test using the real Emitter.

**Dependencies:** Tasks 1.1, 1.3b, 2.1.

**Files:** `packages/prose-console/src/sidecar/server.ts` (TCP half), `packages/prose-console/src/sidecar/__tests__/ipc-ingest.int.spec.ts`.

**Size:** M.

---

#### Task 2.3: Ring buffer

**Description:** In-memory **Trace** store. Each **Trace** is keyed by `correlationId` and holds an ordered event list. When the count of *completed* **Traces** exceeds `maxExecutions`, evict the oldest. In-flight **Traces** are never evicted, even if they exceed the cap.

**Acceptance:**
- Eviction at `maxExecutions` removes oldest completed, preserves in-flight.
- Query by `correlationId` returns the ordered event list.
- Query by `flowName` returns the most recent N **Traces** sorted newest-first.
- Buffer never exceeds `maxExecutions * 2` entries in steady state.

**Verification:** Vitest unit tests.

**Dependencies:** Task 1.1.

**Files:** `packages/prose-console/src/sidecar/ring-buffer.ts`, `packages/prose-console/src/sidecar/__tests__/ring-buffer.spec.ts`.

**Size:** S.

---

#### Task 2.4: Workspace analyzer wrapper + drift detection

**Description:** Wrap `analyzeFlowSource` + `list-flows` to scan a workspace directory, build a `Map<flowName, FlowGraph>`, and surface drift (a `stepName` in events not present in the graph, or vice versa) as a structured signal.

**Acceptance:**
- Given a fixture workspace with three Flows, the wrapper finds all three and produces a `FlowGraph` for each.
- `detectDrift(trace, graph)` returns the offending step name(s) when there is a mismatch; returns null when aligned.
- Workspace re-scan on file change is debounced (200ms) so a busy editor doesn't thrash the analyzer.

**Verification:** Unit + integration tests against a fixture workspace.

**Dependencies:** Task 1.2.

**Files:** `packages/prose-console/src/sidecar/analyzer.ts`, fixture workspace under `packages/prose-console/src/sidecar/__tests__/fixtures/`, tests.

**Size:** M.

---

#### Task 2.5: HTTP server + CLI

**Description:** Sidecar HTTP endpoints (read-only): `GET /api/flows` (catalog), `GET /api/traces` (list with `?flowName=` filter), `GET /api/traces/:correlationId` (single Trace + its `FlowGraph`), `GET /api/health`. CLI binary parses `--host`, `--port`, `--workspace`, `--max-executions`, `--dump-disk`; prints the 0.0.0.0 security banner before listening; exits cleanly on SIGINT/SIGTERM.

**Acceptance:**
- `npx @celom/prose-console --workspace ./fixture` starts a server; `GET /api/health` returns 200.
- `--host 0.0.0.0` prints the security banner *before* the server binds the listener.
- Port collision exits with a clear error message, not a stack trace.
- `--max-executions` is forwarded to the ring buffer.

**Verification:** Integration test spawns the CLI in a child process and curls the endpoints.

**Dependencies:** Tasks 2.2, 2.3, 2.4.

**Files:** `packages/prose-console/src/cli.ts`, `packages/prose-console/src/sidecar/server.ts` (HTTP half), `packages/prose-console/src/__tests__/cli.int.spec.ts`.

**Size:** M.

---

#### Task 2.6: End-to-end headless integration test

**Description:** One e2e test: spawn the Sidecar, execute a real `@celom/prose` Flow with the Emitter attached, fetch the Trace over HTTP, and assert the event sequence matches the Flow's expected execution path (including a skip, a parallel, and a break).

**Acceptance:**
- Test passes end-to-end without UI involvement.
- Test runs in CI.
- Test exercises every event type defined in Task 1.1's protocol.

**Verification:** `pnpm nx test prose-console --testPathPattern=e2e-headless`.

**Dependencies:** Phase 1 + Tasks 2.1–2.5.

**Files:** `packages/prose-console/src/__tests__/e2e-headless.spec.ts`, fixture Flow.

**Size:** M.

---

### Phase 2 Checkpoint
- [ ] Sidecar runs headless, ingests events from a real Emitter, serves HTTP API.
- [ ] End-to-end headless integration test passes.
- [ ] Security banner verified.
- [ ] Reviewed with human before Phase 3 (UI work is the largest spend).

---

### Phase 3: Trace view UI

#### Task 3.1: UI scaffold

**Description:** Build the UI per Task 0.2's framework + library choice. Vite-based dev server proxies to the Sidecar HTTP/WS. Single route stub for `/traces/:correlationId`. Production build is bundled by the Sidecar and served from the same port.

**Acceptance:**
- `pnpm nx run prose-console:dev` opens a browser at the Sidecar URL and renders an empty Trace view shell.
- Production build is included when `pnpm nx build prose-console` runs and is served by the Sidecar HTTP server.

**Verification:** Manual: open the URL, see the empty shell; production build verified by spawning the bundled binary.

**Dependencies:** Task 0.2, Phase 2.

**Files:** `packages/prose-console/src/ui/app.{tsx,ts}`, `packages/prose-console/src/ui/index.html`, `packages/prose-console/vite.config.ts`.

**Size:** M.

---

#### Task 3.2a: Static graph — layout + Node render

**Description:** Render the `FlowGraph.nodes` as DAG **Nodes** using the chosen layout library. Layout is deterministic — re-rendering the same `FlowGraph` produces an identical layout.

**Acceptance:**
- A 20-Step Flow renders without overlapping **Nodes**.
- Re-fetching the same Trace produces an identical layout (visual snapshot check).
- Each **Node** is labeled with the **Step** name.

**Verification:** Manual + Playwright snapshot.

**Dependencies:** Task 3.1.

**Files:** `packages/prose-console/src/ui/trace-view/static-graph.tsx`, layout helper.

**Size:** M.

---

#### Task 3.2b: Static graph — edge styles + branch visuals

**Description:** Render `FlowGraph.edges` with distinct visual treatment per `edge.kind`: `sequential` (solid), `conditional-skip` (dashed), `parallel-branch` (multi-edge fan), `break-exit` (terminal arrow with annotation).

**Acceptance:**
- All four edge kinds render distinctly and legibly.
- Parallel-branch edges visually group at the `.parallel()` Node.
- Break-exit edges terminate at a distinct terminal **Node** annotated with the return value (annotation lands in Task 3.3 if not here).

**Verification:** Visual check on fixture Flow + Playwright snapshot.

**Dependencies:** Task 3.2a.

**Files:** `packages/prose-console/src/ui/trace-view/edges.tsx`.

**Size:** S.

---

#### Task 3.3: Runtime overlay

**Description:** Apply visited / skipped / errored / broken / retried decorations to **Nodes** based on the **Trace** event log. Per-**Node** duration is rendered as an annotation. Retried **Nodes** show the attempt count.

**Acceptance:**
- A Trace with a skipped Step shows that **Node** faded.
- A retried Step shows attempt count (e.g., "2/3").
- A `breakIf`-exited Step shows the return value as annotation.
- An errored Step renders with error styling and surfaces `error.message` on hover/click.

**Verification:** Visual check on fixture Traces; Playwright snapshot per state.

**Dependencies:** Task 3.2b.

**Files:** `packages/prose-console/src/ui/trace-view/runtime-overlay.tsx`.

**Size:** M.

---

#### Task 3.4: State-diff inspector

**Description:** Side panel: when a **Node** is selected, show the state delta between that Step's start and complete events (added / removed / changed keys with values). Redacted values render as `[REDACTED]`, never the underlying value.

**Acceptance:**
- Selecting a Step **Node** shows added/removed/changed keys.
- Redacted values appear as `[REDACTED]` in the diff.
- The diff helper is a pure function with unit tests.

**Verification:** Unit test on the diff helper; manual + Playwright on the panel.

**Dependencies:** Task 3.3.

**Files:** `packages/prose-console/src/ui/trace-view/state-diff.tsx`, `packages/prose-console/src/ui/trace-view/diff.ts`, diff unit test.

**Size:** M.

---

#### Task 3.5: Drift banner

**Description:** When the Sidecar's `detectDrift` flags a mismatch on the current **Trace**, render a banner above the Trace view: "Build is out of date — rebuild or restart the Sidecar." Rendering continues; the banner is dismissible per session.

**Acceptance:**
- Loading a drifted Trace shows the banner; the rest of the Trace view still renders what it can.
- The banner names the specific step(s) that drifted.
- Dismissing the banner does not affect other Traces.

**Verification:** Manual + Playwright.

**Dependencies:** Tasks 3.3, 2.4.

**Files:** `packages/prose-console/src/ui/trace-view/drift-banner.tsx`.

**Size:** S.

---

### Phase 3 Checkpoint
- [ ] Trace view renders a real Flow execution with overlay, state-diff inspector, and drift banner.
- [ ] Playwright smoke covering one Trace passes.
- [ ] Reviewed with human; UX feedback collected before parallelizing Phases 4 + 5.

---

### Phase 4: Flow catalog

#### Task 4.1: Catalog aggregation

**Description:** Sidecar computes per-Flow aggregate stats over the current ring buffer: execution count, p50/p95 duration, error rate, top-3 `breakIf` exit values. Exposed by extending `GET /api/flows`. Recomputation is incremental (event-driven) where possible; falls back to full pass at most once per second.

**Acceptance:**
- Stats are correct for a fixture buffer of 20 Traces across 3 Flows.
- Stats update as new Traces complete.
- Endpoint response time < 50ms for a buffer of 1000 Traces.

**Verification:** Unit test of the aggregator; integration test of the endpoint.

**Dependencies:** Task 2.5.

**Files:** `packages/prose-console/src/sidecar/aggregator.ts`, tests.

**Size:** M.

---

#### Task 4.2: Catalog UI

**Description:** UI page listing every Flow with its aggregate stats. Clicking a Flow navigates to the most recent **Trace** for that Flow.

**Acceptance:**
- All Flows found by the workspace analyzer are listed, including those with zero executions.
- Stats render and update without manual refresh.
- Click on a Flow row navigates to `/traces/:correlationId` for the most recent Trace.

**Verification:** Manual + Playwright.

**Dependencies:** Tasks 3.1, 4.1.

**Files:** `packages/prose-console/src/ui/flow-catalog/`.

**Size:** M.

---

### Phase 5: Live tail

#### Task 5.1: WS streaming + coalescing

**Description:** Sidecar `/ws` endpoint pushes events as they arrive. Coalesce per `(correlationId, stepName)` at 60Hz; terminal events (`flow.complete`, `flow.error`, `flow.break`) are never coalesced or dropped.

**Acceptance:**
- Under a 1000 events/sec synthetic load, the WS client receives at most 60 messages/sec per `(correlationId, stepName)`.
- Terminal events always arrive (verified by counting them on the client).
- WS disconnect is handled gracefully on both sides.

**Verification:** Synthetic-load integration test.

**Dependencies:** Tasks 2.5, 1.1.

**Files:** `packages/prose-console/src/sidecar/live-tail.ts`, `packages/prose-console/src/sidecar/__tests__/live-tail.int.spec.ts`.

**Size:** M.

---

#### Task 5.2: Live tail UI

**Description:** UI page that subscribes to `/ws` and updates the **Runtime overlay** of an in-flight Trace **Node**-by-**Node** as events arrive, without manual refresh.

**Acceptance:**
- Triggering a Flow with the Live tail page open updates the overlay live.
- Switching between Traces does not leak subscriptions.

**Verification:** Playwright e2e with a synthetic Flow that emits over 5+ seconds.

**Dependencies:** Tasks 3.3, 5.1.

**Files:** `packages/prose-console/src/ui/live-tail/`.

**Size:** M.

---

### Phase 5 Checkpoint
- [ ] Live tail works under realistic load.
- [ ] All three UI surfaces (Trace view, Flow catalog, Live tail) functional end-to-end.

---

### Phase 6: Ship polish

#### Task 6.1: Disk dump

**Description:** Implement `disk-dump.ts`. With `--dump-disk`, write the ring buffer to `~/.prose-console/history.jsonl` on `SIGINT`/`SIGTERM`; on startup, reload. Format: one-line header `{"$protocol":N}` followed by JSONL events.

**Acceptance:**
- Round-trip test: write a buffer of 20 Traces, restart, all 20 load.
- Cross-version dump (`$protocol` header mismatches current) refuses load with a clear error and a hint to discard the file.
- Token from the locked-list redaction does not appear in the dump file.

**Verification:** Integration test (file written, process restarted, buffer matches).

**Dependencies:** Tasks 2.3, 1.1.

**Files:** `packages/prose-console/src/sidecar/disk-dump.ts`, integration test.

**Size:** S.

---

#### Task 6.2: First-run docs

**Description:** README for `@celom/prose-console`. Quickstart in ≤ 5 steps. Security section covering loopback default, redaction, escape hatch, 0.0.0.0 banner. Link from the main `@celom/prose` README.

**Acceptance:**
- A new user can follow the Quickstart and reach a rendered Trace without consulting any other doc.
- Security section calls out every Boundary's "Never" rule from SPEC.

**Verification:** Pair-test or self-test from a fresh checkout.

**Dependencies:** Phase 5 complete.

**Files:** `packages/prose-console/README.md`, update to `packages/prose/README.md`.

**Size:** S.

---

#### Task 6.3: Bundle-size guard in CI

**Description:** Script + CI gate that fails when `@celom/prose`'s parsed-JS gzipped size grows by more than the SPEC's 5KB budget from the prior release tag.

**Acceptance:**
- Local script reports current size vs baseline.
- CI gate fails on a deliberate regression (verified with a test PR).
- Baseline is updated automatically on each release tag.

**Verification:** Test PR that adds bloat fails CI; remove bloat, CI passes.

**Dependencies:** Phase 1 complete.

**Files:** `packages/prose/scripts/check-bundle-size.mjs`, CI workflow update (`.github/workflows/`).

**Size:** S.

---

#### Task 6.4: Playwright e2e

**Description:** Final e2e: spawn the Sidecar against a fixture workspace, execute a Flow, drive the UI through Trace view → Flow catalog → Live tail. Each SPEC Success Criterion has at least one assertion in this test.

**Acceptance:**
- Test passes locally and in CI.
- Every numbered Success Criterion (1–8) in SPEC has a corresponding assertion.
- Test runtime < 60s on CI.

**Verification:** `pnpm nx run prose-console:e2e`.

**Dependencies:** All prior tasks.

**Files:** `packages/prose-console/e2e/`, Playwright config.

**Size:** M.

---

### Final Checkpoint
- [ ] Every SPEC Success Criterion is verifiable from the test suite.
- [ ] Every Boundary (Always / Never) has at least one test enforcing it.
- [ ] Ready for `code-review-and-quality` → `git-workflow-and-versioning` → `shipping-and-launch`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Phase 0 UI framework choice introduces a heavy dep on the Sidecar install | Medium — DX, not runtime | Spike in Task 0.2 before commit; prefer small DAG libs (Dagre.js ≈ 30KB) |
| `parentStepName` runtime change is rejected in review | High — invalidates parallel rendering plan | Phase 0 lands it before any UI work; fallback path uses timestamp inference but spec-stated parallel rendering degrades |
| `analyze-flow` AST rewrite is more invasive than expected | Medium | Task 0.1 decides scope; if AST is heavy, keep regex + add narrow AST helpers only for conditional/parallel edges |
| Bundle-size budget on `@celom/prose` is blown by Emitter | Medium | Emitter uses only `node:` builtins; size-guard CI lands in Task 6.3 and fails fast |
| Sidecar grows beyond `node:http` + `ws` | Low — easy to spot in review | Boundary: explicit "Never bundle Express/Fastify" |
| Live tail floods WS clients at high event rate | Medium | 60Hz coalescing per `(correlationId, stepName)`; terminal events bypass; synthetic-load test required (Task 5.1) |
| Drift between source and built artifact mis-detected | Low | Drift banner is non-fatal; rendering continues; user can dismiss |
| MCP `analyze-flow` consumers break when the analyzer is extended | Medium | Task 1.2 acceptance explicitly requires no breaking change; golden test preserves the old fields |

## Open Questions for the Plan

- **Parallelize Phases 4 (Flow catalog) and 5 (Live tail)?** They share no code paths after Phase 3 completes. Recommend yes; flag for human approval at the Phase 3 Checkpoint.
- **Phase 0 decisions are human-gated.** Should I draft starting-point decision docs (`01-static-analysis-integration.md`, `02-trace-view.md`) for the human to react to, or wait for a separate signal?
- **`@celom/prose` MCP package size budget.** SPEC sets a 5KB gzipped budget for the Emitter addition to `@celom/prose`. Is the existing MCP server (`@modelcontextprotocol/sdk`, `zod` optional deps) already counted toward this, or is the budget Emitter-only?
