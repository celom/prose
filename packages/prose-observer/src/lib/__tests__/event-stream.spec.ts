import { EventStream } from '../event-stream.js';
import type { ObserverEvent } from '../events.js';

const flowStart = (cid: string, flowName = 'f', ts = 1): ObserverEvent => ({
  type: 'flow.start',
  correlationId: cid,
  flowName,
  ts,
  input: { hello: 'world' },
});

const flowComplete = (cid: string, ts = 5): ObserverEvent => ({
  type: 'flow.complete',
  correlationId: cid,
  flowName: 'f',
  ts,
  output: { ok: true },
  durationMs: ts - 1,
});

describe('EventStream', () => {
  it('groups events by correlationId into execution records', () => {
    const stream = new EventStream();
    stream.push(flowStart('a', 'flow-a', 10));
    stream.push(flowStart('b', 'flow-b', 20));
    stream.push(flowComplete('a', 15));

    const a = stream.getExecution('a');
    expect(a?.flowName).toBe('flow-a');
    expect(a?.status).toBe('completed');
    expect(a?.startedAt).toBe(10);
    expect(a?.endedAt).toBe(15);
    expect(a?.events).toHaveLength(2);

    const b = stream.getExecution('b');
    expect(b?.status).toBe('running');
    expect(b?.endedAt).toBeUndefined();
  });

  it('evicts the oldest execution once maxExecutions is exceeded', () => {
    const stream = new EventStream(2);
    stream.push(flowStart('a'));
    stream.push(flowStart('b'));
    stream.push(flowStart('c'));

    expect(stream.getExecution('a')).toBeUndefined();
    expect(stream.getExecution('b')).toBeDefined();
    expect(stream.getExecution('c')).toBeDefined();

    const ids = stream.listExecutions().map((e) => e.correlationId);
    expect(ids).toEqual(['b', 'c']);
  });

  it('delivers every push to active subscribers and stops after unsubscribe', () => {
    const stream = new EventStream();
    const received: string[] = [];
    const unsubscribe = stream.subscribe((event) => {
      received.push(event.type);
    });

    stream.push(flowStart('a'));
    stream.push(flowComplete('a'));
    unsubscribe();
    stream.push(flowStart('b'));

    expect(received).toEqual(['flow.start', 'flow.complete']);
  });

  it('rejects nonsensical maxExecutions', () => {
    expect(() => new EventStream(0)).toThrow(RangeError);
  });

  it('sets terminal status from each flow-ending event variant', () => {
    const stream = new EventStream();
    stream.push(flowStart('ok'));
    stream.push(flowComplete('ok'));
    expect(stream.getExecution('ok')?.status).toBe('completed');

    stream.push(flowStart('err'));
    stream.push({
      type: 'flow.error',
      correlationId: 'err',
      flowName: 'f',
      ts: 5,
      error: { name: 'Error', message: 'boom' },
      durationMs: 4,
    });
    expect(stream.getExecution('err')?.status).toBe('failed');

    stream.push(flowStart('brk'));
    stream.push({
      type: 'flow.break',
      correlationId: 'brk',
      flowName: 'f',
      ts: 5,
      stepName: 'guard',
      returnValue: { early: true },
      durationMs: 4,
    });
    expect(stream.getExecution('brk')?.status).toBe('broken');
  });
});
