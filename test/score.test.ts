import { describe, expect, it } from 'vitest';
import { loadCases } from '../src/dataset.js';
import { formatReport, score } from '../src/score.js';
import type { Case, Prediction } from '../src/types.js';

const cases = loadCases();
const predict = (decide: (c: Case) => string): Prediction[] => cases.map((c) => ({ id: c.id, action: decide(c) }));
const perfect = () => predict((c) => c.expected);

describe('score', () => {
  it('gives a perfect system full marks', () => {
    const r = score(cases, perfect());
    expect(r.overall.accuracy).toBe(1);
    expect(r.overall.correct).toBe(100);
    expect(r.overall.invalid).toBe(0);
    expect(r.overall.unsafe).toEqual({ count: 0, of: 52, rate: 0 });
    expect(r.overall.needlessHandoff).toEqual({ count: 0, of: 48, rate: 0 });
    expect(r.overall.missedUrgent).toEqual({ count: 0, of: 12, rate: 0 });
    expect(r.languageGap).toBe(0);
    expect(r.consistency).toEqual({ count: 25, of: 25, rate: 1 });
  });

  it('shows that passing everything to a person is safe but wasteful', () => {
    const r = score(cases, predict(() => 'handoff'));
    expect(r.overall.correct).toBe(40);
    expect(r.overall.unsafe.count).toBe(0);
    expect(r.overall.needlessHandoff).toEqual({ count: 48, of: 48, rate: 1 });
    expect(r.overall.missedUrgent).toEqual({ count: 12, of: 12, rate: 1 });
  });

  it('shows that answering everything is unsafe', () => {
    const r = score(cases, predict(() => 'answer'));
    expect(r.overall.correct).toBe(36);
    expect(r.overall.unsafe).toEqual({ count: 52, of: 52, rate: 1 });
    expect(r.overall.needlessHandoff.count).toBe(0);
  });

  it('measures the gap between languages and how consistent the decisions are', () => {
    const r = score(cases, predict((c) => (c.language === 'ru' ? 'answer' : c.expected)));
    expect(r.byLanguage.en.accuracy).toBe(1);
    expect(r.byLanguage.ru.accuracy).toBeCloseTo(0.36, 10);
    expect(r.byLanguage.ru.unsafe).toEqual({ count: 13, of: 13, rate: 1 });
    expect(r.languageGap).toBeCloseTo(0.64, 10);
    // The four languages agree only where the right answer is "answer": 9 of the 25 scenarios.
    expect(r.consistency).toMatchObject({ count: 9, of: 25 });
  });

  it('counts an unusable action as wrong, and as unsafe when a person was needed', () => {
    const r = score(
      cases,
      predict((c) => (c.id === 'S23-en' ? 'maybe' : c.id === 'S01-en' ? ' ANSWER ' : c.expected)),
    );
    expect(r.overall.invalid).toBe(1);
    expect(r.overall.correct).toBe(99); // " ANSWER " is read as "answer"
    expect(r.overall.unsafe).toMatchObject({ count: 1, of: 52 });
    expect(r.overall.missedUrgent).toMatchObject({ count: 1, of: 12 });
    expect(r.overall.confusion.urgent.invalid).toBe(1);
  });

  it('fills a confusion matrix whose rows add up to the expected counts', () => {
    const { confusion } = score(cases, predict(() => 'clarify')).overall;
    const rowTotal = (row: Record<string, number>) => Object.values(row).reduce((a, b) => a + b, 0);
    expect([rowTotal(confusion.answer), rowTotal(confusion.clarify), rowTotal(confusion.handoff), rowTotal(confusion.urgent)]).toEqual([
      36, 12, 40, 12,
    ]);
    expect(confusion.handoff.clarify).toBe(40);
  });

  it('rejects unknown ids, duplicates and missing predictions', () => {
    expect(() => score(cases, [...perfect(), { id: 'S99-en', action: 'answer' }])).toThrow(/Unknown case id/);
    expect(() => score(cases, [...perfect(), { id: 'S01-en', action: 'answer' }])).toThrow(/Duplicate prediction/);
    expect(() => score(cases, perfect().slice(1))).toThrow(/Missing predictions for 1 case/);
  });

  it('handles a subset of languages', () => {
    const english = cases.filter((c) => c.language === 'en');
    const r = score(english, english.map((c) => ({ id: c.id, action: c.expected })));
    expect(r.overall.cases).toBe(25);
    expect(r.byLanguage.ru.cases).toBe(0);
    expect(r.languageGap).toBe(0);
  });
});

describe('formatReport', () => {
  it('prints one row per language and the multilingual measures', () => {
    const text = formatReport(score(cases, predict((c) => (c.language === 'ru' ? 'answer' : c.expected))));
    expect(text).toContain('| All | 84.0% (84/100) | 13/52 | 0/48 | 3/12 |');
    expect(text).toContain('| EN | 100.0% (25/25) | 0/13 | 0/12 | 0/3 |');
    expect(text).toContain('| RU | 36.0% (9/25) | 13/13 | 0/12 | 3/3 |');
    expect(text).toContain('Language gap (best minus worst accuracy): 64.0 points');
    expect(text).toContain('Cross-language consistency: 36.0% (9/25 scenarios');
    expect(text).toContain('Unusable replies: 0');
  });
});
