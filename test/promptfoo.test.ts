import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINES, formatBaselineTable, runBaseline } from '../src/baselines.js';
import { casesToJsonl, loadCases } from '../src/dataset.js';

// Keeps the promptfoo recipe in integrations/promptfoo in step with the dataset and the scorer,
// without promptfoo installed and without a network.
const dir = fileURLToPath(new URL('../integrations/promptfoo/', import.meta.url));
const read = (name: string) => readFileSync(join(dir, name), 'utf8');
const cases = loadCases();
const configs = ['promptfooconfig.yaml', 'promptfooconfig.model.yaml'];

type Assertion = (output: string, context: { vars: Record<string, string> }) => {
  pass: boolean;
  namedScores: Record<string, number>;
};

describe('promptfoo recipe', () => {
  it('has every file its configs refer to', () => {
    for (const config of configs) {
      const text = read(config);
      const refs = [...text.matchAll(/file:\/\/(\S+)/g)].map((m) => m[1] as string);
      const scripts = [...text.matchAll(/exec:node (\S+\.mjs)/g)].map((m) => m[1] as string);
      expect(refs.length).toBeGreaterThan(0);
      expect(scripts.length).toBeGreaterThan(0);
      for (const file of [...refs, ...scripts]) expect(existsSync(join(dir, file)), `${config}: ${file}`).toBe(true);
    }
  });

  it('commands in the model config that point into the repository exist', () => {
    const command = /exec:node provider-model\.mjs node (\S+)/.exec(read('promptfooconfig.model.yaml'));
    expect(command?.[1]).toBeDefined();
    expect(existsSync(join(dir, '..', '..', command?.[1] ?? 'missing'))).toBe(true);
  });

  it('runs the same 100 cases as `export`, in the same order', () => {
    const tests = read('tests.jsonl').trim().split('\n').map((line) => JSON.parse(line) as { vars: Record<string, string> });
    expect(tests).toHaveLength(cases.length);
    const exported = casesToJsonl(cases).trim().split('\n').map((line) => JSON.parse(line) as Record<string, string>);
    expect(tests.map((t) => t.vars)).toEqual(
      exported.map(({ message, expected, language, id, scenario, category }) => ({ message, expected, language, id, scenario, category })),
    );
  });

  it('its assertion gives the same numbers as the scorer for every baseline', async () => {
    const mod = (await import(join(dir, 'assert.mjs'))) as { default: Assertion };
    for (const baseline of BASELINES) {
      const report = runBaseline(baseline, cases);
      const total: Record<string, number> = {};
      for (const c of cases) {
        const output = JSON.stringify({ action: baseline.predict(c) });
        const result = mod.default(output, { vars: { expected: c.expected, language: c.language } });
        for (const [key, value] of Object.entries(result.namedScores)) total[key] = (total[key] ?? 0) + value;
      }
      expect(total.correct, baseline.name).toBe(report.overall.correct);
      expect(total.unsafe_error, baseline.name).toBe(report.overall.unsafe.count);
      expect(total.needless_handoff, baseline.name).toBe(report.overall.needlessHandoff.count);
      expect(total.missed_urgent, baseline.name).toBe(report.overall.missedUrgent.count);
      for (const lang of ['en', 'pt', 'es', 'ru'] as const) {
        expect(total[`correct_${lang}`], `${baseline.name} ${lang}`).toBe(report.byLanguage[lang].correct);
      }
    }
  });

  it('the baseline provider answers like the baseline when promptfoo calls it', () => {
    // promptfoo runs: <command> <prompt> <options as JSON> <context as JSON>
    for (const baseline of BASELINES) {
      for (const c of cases.filter((x) => x.id.endsWith('-en')).slice(0, 8)) {
        const stdout = execFileSync('node', [join(dir, 'provider-baseline.mjs'), baseline.name, c.message, '{}', '{}'], { encoding: 'utf8' });
        expect(JSON.parse(stdout)).toEqual({ action: baseline.predict(c) });
      }
    }
  });

  it('its README shows the baseline numbers the main README shows', () => {
    expect(read('README.md')).toContain(formatBaselineTable(cases).split('\n').slice(2).join('\n'));
  });
});
