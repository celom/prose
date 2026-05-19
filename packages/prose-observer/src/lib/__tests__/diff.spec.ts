import { shallowStateDiff } from '../diff.js';

describe('shallowStateDiff', () => {
  it('reports added keys', () => {
    expect(shallowStateDiff({ a: 1 }, { a: 1, b: 2 })).toEqual({
      added: { b: 2 },
      removed: [],
      changed: {},
    });
  });

  it('reports removed keys', () => {
    expect(shallowStateDiff({ a: 1, b: 2 }, { a: 1 })).toEqual({
      added: {},
      removed: ['b'],
      changed: {},
    });
  });

  it('reports changed keys with before/after', () => {
    expect(shallowStateDiff({ a: 1 }, { a: 2 })).toEqual({
      added: {},
      removed: [],
      changed: { a: { before: 1, after: 2 } },
    });
  });

  it('treats nested object replacement as a single changed entry', () => {
    const before = { user: { name: 'alice' } };
    const after = { user: { name: 'bob' } };
    const diff = shallowStateDiff(before, after);
    expect(diff.changed.user).toEqual({
      before: { name: 'alice' },
      after: { name: 'bob' },
    });
    expect(diff.added).toEqual({});
    expect(diff.removed).toEqual([]);
  });

  it('uses Object.is to compare values (NaN equals NaN)', () => {
    const diff = shallowStateDiff({ x: NaN }, { x: NaN });
    expect(diff.changed).toEqual({});
  });

  it('treats non-object inputs as empty state', () => {
    expect(shallowStateDiff(null, { a: 1 })).toEqual({
      added: { a: 1 },
      removed: [],
      changed: {},
    });
    expect(shallowStateDiff({ a: 1 }, undefined)).toEqual({
      added: {},
      removed: ['a'],
      changed: {},
    });
  });
});
