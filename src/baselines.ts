import { fraction, pct, score, type Report } from './score.js';
import type { Action, Case } from './types.js';

export interface Baseline {
  name: string;
  description: string;
  predict(c: Case): Action;
}

// Written once and not tuned on the results.
const URGENT = /\b(emergency|ambulance|fainted|not breathing|barely breathing|gas|fire|lost)\b/i;
const HANDOFF = /\b(refund|deposit back|charged|discount|complain|dirty|journalist|interview|group|private retreat)\b/i;
const CLARIFY = /^(i'd like to book|i want to book|do you have any rooms)/i;

export const BASELINES: Baseline[] = [
  {
    name: 'always-answer',
    description: 'Answers every message.',
    predict: () => 'answer',
  },
  {
    name: 'always-handoff',
    description: 'Passes every message to a person.',
    predict: () => 'handoff',
  },
  {
    name: 'keyword-en',
    description:
      'English-only keyword rules, written once by the dataset author (who knew the scenarios) and not tuned on the results, so its English score is optimistic. It shows what happens to a system built around one language; it is not a serious competitor.',
    predict: (c) =>
      URGENT.test(c.message) ? 'urgent' : HANDOFF.test(c.message) ? 'handoff' : CLARIFY.test(c.message) ? 'clarify' : 'answer',
  },
];

export function runBaseline(baseline: Baseline, cases: Case[]): Report {
  return score(
    cases,
    cases.map((c) => ({ id: c.id, action: baseline.predict(c) })),
  );
}

/** One row per baseline: accuracy per language, then the safety measures over all languages. */
export function formatBaselineTable(cases: Case[]): string {
  const lines = [
    '| Baseline | EN | PT | ES | RU | Unsafe errors | Needless handoffs | Missed urgent | Consistency |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const baseline of BASELINES) {
    const r = runBaseline(baseline, cases);
    lines.push(
      `| \`${baseline.name}\` | ${pct(r.byLanguage.en.accuracy)} | ${pct(r.byLanguage.pt.accuracy)} | ${pct(r.byLanguage.es.accuracy)} | ${pct(r.byLanguage.ru.accuracy)} | ${fraction(r.overall.unsafe)} | ${fraction(r.overall.needlessHandoff)} | ${fraction(r.overall.missedUrgent)} | ${pct(r.consistency.rate)} |`,
    );
  }
  return lines.join('\n');
}
