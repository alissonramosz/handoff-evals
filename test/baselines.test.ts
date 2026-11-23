import { describe, expect, it } from 'vitest';
import { BASELINES, formatBaselineTable, runBaseline } from '../src/baselines.js';
import { loadCases, readText } from '../src/dataset.js';

const cases = loadCases();
const baseline = (name: string) => {
  const found = BASELINES.find((b) => b.name === name);
  if (!found) throw new Error(`no baseline ${name}`);
  return found;
};

// These numbers are what the README shows. If they change, the README must change with them.
describe('baselines', () => {
  it('always-answer is right 36% of the time and never calls a person', () => {
    const r = runBaseline(baseline('always-answer'), cases);
    expect(r.overall.accuracy).toBe(0.36);
    expect(r.overall.unsafe).toEqual({ count: 52, of: 52, rate: 1 });
    expect(r.overall.needlessHandoff.count).toBe(0);
  });

  it('always-handoff is right 40% of the time and never answers', () => {
    const r = runBaseline(baseline('always-handoff'), cases);
    expect(r.overall.accuracy).toBe(0.4);
    expect(r.overall.unsafe.count).toBe(0);
    expect(r.overall.needlessHandoff).toEqual({ count: 48, of: 48, rate: 1 });
  });

  it('keyword-en does well in English and falls apart in the other languages', () => {
    const r = runBaseline(baseline('keyword-en'), cases);
    expect([r.byLanguage.en.accuracy, r.byLanguage.pt.accuracy, r.byLanguage.es.accuracy, r.byLanguage.ru.accuracy]).toEqual([
      0.8, 0.36, 0.4, 0.36,
    ]);
    expect(r.overall.unsafe).toMatchObject({ count: 42, of: 52 });
    expect(r.overall.missedUrgent).toMatchObject({ count: 8, of: 12 });
    expect(r.consistency).toMatchObject({ count: 14, of: 25 });
  });

  it('has its table printed in the README', () => {
    expect(readText('README.md')).toContain(formatBaselineTable(cases));
  });
});
