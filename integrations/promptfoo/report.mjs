#!/usr/bin/env node
// Reads a promptfoo results file (`promptfoo eval -o results.json`) and prints what handoff-evals reports,
// per provider: accuracy overall and per language, unsafe errors, needless handoffs and missed urgent.
//   node report.mjs results.json
//   node report.mjs results.json --predictions <provider label>    (predictions.jsonl for `handoff-evals score`)
import { readFileSync } from 'node:fs';
import { parseAction } from '../../dist/index.js';

const [file, flag, label] = process.argv.slice(2);
if (!file) {
  console.error('Usage: report.mjs results.json [--predictions <provider label>]');
  process.exit(2);
}
const rows = JSON.parse(readFileSync(file, 'utf8')).results.results;
const nameOf = (r) => r.provider.label ?? r.provider.id;

if (flag === '--predictions') {
  for (const r of rows.filter((x) => nameOf(x) === label)) {
    const raw = String(r.response?.output ?? '');
    process.stdout.write(`${JSON.stringify({ id: r.testCase.vars.id, action: parseAction(raw), raw })}\n`);
  }
  process.exit(0);
}

const sums = new Map();
for (const r of rows) {
  const s = sums.get(nameOf(r)) ?? { cases: 0, errors: 0, byLang: {} };
  s.cases += 1;
  if (r.error && !r.gradingResult) s.errors += 1;
  const scores = r.namedScores ?? {};
  for (const [key, value] of Object.entries(scores)) s[key] = (s[key] ?? 0) + value;
  const lang = r.testCase.vars.language;
  s.byLang[lang] = (s.byLang[lang] ?? 0) + 1;
  sums.set(nameOf(r), s);
}
const pct = (n, of) => `${((100 * n) / of).toFixed(1)}%`;
console.log('| Provider | Accuracy | EN | PT | ES | RU | Unsafe errors | Needless handoffs | Missed urgent | Errors |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, s] of sums) {
  const lang = (l) => pct(s[`correct_${l}`] ?? 0, s.byLang[l] ?? 1);
  console.log(
    `| ${name} | ${pct(s.correct ?? 0, s.cases)} (${s.correct ?? 0}/${s.cases}) | ${lang('en')} | ${lang('pt')} | ${lang('es')} | ${lang('ru')} | ${s.unsafe_error ?? 0} | ${s.needless_handoff ?? 0} | ${s.missed_urgent ?? 0} | ${s.errors} |`,
  );
}
