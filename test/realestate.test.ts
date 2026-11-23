import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/commands.js';
import { execCompleter, parseReply, predictAll } from '../src/predict.js';
import { loadLeadScenarios, loadRealEstateCases, validateLeadScenarios } from '../src/realestate.js';

const root = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

describe('the real-estate dataset', () => {
  const scenarios = loadLeadScenarios();
  const cases = loadRealEstateCases();

  it('has no problems', () => {
    expect(validateLeadScenarios(scenarios)).toEqual([]);
  });

  it('has 43 Portuguese cases and every action', () => {
    expect(cases).toHaveLength(43);
    expect(cases.every((c) => c.language === 'pt' && c.id === `${c.scenario}-pt`)).toBe(true);
    const count = (action: string) => cases.filter((c) => c.expected === action).length;
    expect({ answer: count('answer'), clarify: count('clarify'), handoff: count('handoff'), urgent: count('urgent') }).toEqual({
      answer: 7,
      clarify: 8,
      handoff: 24,
      urgent: 4,
    });
  });

  it('follows its own rule: a lead with a goal, a region and a budget is never a clarify or an answer', () => {
    for (const c of cases) {
      const lead = c.lead;
      const qualified = Boolean(lead?.goal && lead.regions.length > 0 && lead.budget);
      if (qualified) expect(['handoff', 'urgent'], `${c.id} is qualified`).toContain(c.expected);
      if (c.expected === 'clarify') expect(qualified, `${c.id} is a clarify`).toBe(false);
    }
  });

  it('writes a budget in whole reais and a region only when the message names it', () => {
    for (const c of cases) {
      for (const region of c.lead?.regions ?? []) {
        expect(c.message.toLowerCase(), `${c.id} region ${region}`).toContain(region.toLowerCase());
      }
    }
  });

  it('carries no personal data, in the data or in anything sent to a model', () => {
    const personal = [/\S+@\S+\.\S+/, /https?:\/\//i, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, /\b\d{2}\)?\s?9?\d{4}-\d{4}\b/];
    // Names that must stay out can be listed in HANDOFF_EVALS_DENYLIST (comma-separated). It is unset in CI.
    const denied = (process.env.HANDOFF_EVALS_DENYLIST ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    const files = [
      'dataset/realestate/scenarios.json',
      'dataset/realestate/business.md',
      'prompts/realestate.md',
      ...readdirSync(new URL('examples/', root)).map((name) => `examples/${name}`),
    ];
    for (const file of files) {
      const text = read(file);
      for (const pattern of personal) expect(text, `${file} ${String(pattern)}`).not.toMatch(pattern);
    }
    for (const file of [...files, 'README.md']) {
      for (const name of denied) {
        expect(read(file), `${file}: ${name}`).not.toMatch(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
      }
    }
  });

  it('is caught by the validator when it is not sound', () => {
    const first = scenarios[0];
    const problems = validateLeadScenarios([
      first,
      { ...first },
      { ...first, id: 'R98', message: 'Tudo certo?', lead: { goal: 'trocar', budget: 0, bedrooms: 1.5, extra: true } },
    ]);
    expect(problems.some((p) => p.includes('duplicate id'))).toBe(true);
    expect(problems.some((p) => p.includes('repeats another scenario'))).toBe(true);
    expect(problems.some((p) => p.includes('goal must be one of'))).toBe(true);
    expect(problems.some((p) => p.includes('budget must be a positive whole number'))).toBe(true);
    expect(problems.some((p) => p.includes('bedrooms must be a positive whole number'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown lead field extra'))).toBe(true);
    expect(validateLeadScenarios([])).toHaveLength(1);
  });
});

describe('parseReply', () => {
  it('returns the action and the lead card, in plain JSON or in a code fence', () => {
    const body = '{"action":"handoff","reply":"ok","lead":{"goal":"alugar"}}';
    expect(parseReply(body)).toEqual({ action: 'handoff', lead: { goal: 'alugar' } });
    expect(parseReply('```json\n' + body + '\n```')).toEqual({ action: 'handoff', lead: { goal: 'alugar' } });
    expect(parseReply('{"action":"answer"}')).toEqual({ action: 'answer' });
    expect(parseReply('não sei')).toEqual({ action: 'invalid' });
  });
});

describe('predict --exec and the real-estate commands', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handoff-evals-re-'));
  });
  afterEach(() => {
    delete process.env.STUB_LOG;
    rmSync(dir, { recursive: true, force: true });
  });

  const cases = loadRealEstateCases();

  it('exports the cases with their lead card and rejects an unknown dataset', async () => {
    const c = capture();
    expect(await run(['export', '--dataset', 'realestate'], c.io)).toBe(0);
    const lines = c.out.join('\n').split('\n');
    expect(lines).toHaveLength(43);
    expect(JSON.parse(lines[16] as string).lead).toMatchObject({ goal: 'comprar', budget: 600000, regions: ['Vila Mariana'] });

    const bad = capture();
    expect(await run(['export', '--dataset', 'nope'], bad.io)).toBe(1);
    expect(bad.err.join('')).toContain('Unknown dataset "nope"');
  });

  it('prints the two baselines that fit one language', async () => {
    const c = capture();
    expect(await run(['baselines', '--dataset', 'realestate'], c.io)).toBe(0);
    const output = c.out.join('\n');
    expect(output).toContain('`always-handoff` | 55.8% (24/43)');
    expect(output).toContain('`always-answer` | 16.3% (7/43)');
    expect(output).not.toContain('keyword-en');
  });

  it('scores a perfect lead card at 100%, and reads the card from the saved reply', async () => {
    const perfect = join(dir, 'perfect.jsonl');
    writeFileSync(perfect, cases.map((c) => JSON.stringify({ id: c.id, action: c.expected, lead: c.lead })).join('\n') + '\n');
    const c = capture();
    expect(await run(['score', perfect, '--dataset', 'realestate'], c.io)).toBe(0);
    const output = c.out.join('\n');
    expect(output).toContain('All six fields right: 100.0% (43/43 messages)');
    expect(output).toContain('Invented values: 0/');
    expect(output).not.toContain('Cross-language');

    const saved = join(dir, 'saved.jsonl');
    writeFileSync(
      saved,
      cases.map((x) => JSON.stringify({ id: x.id, action: x.expected, raw: `\`\`\`json\n${JSON.stringify({ action: x.expected, lead: x.lead })}\n\`\`\`` })).join('\n') + '\n',
    );
    const s = capture();
    expect(await run(['score', saved, '--dataset', 'realestate', '--json'], s.io)).toBe(0);
    expect(JSON.parse(s.out.join('\n')).leads.exact.count).toBe(43);
  });

  it('asks a command once per case, with the prompt and the message on stdin', async () => {
    const stub = join(dir, 'stub.mjs');
    writeFileSync(
      stub,
      [
        "import { appendFileSync, readFileSync } from 'node:fs';",
        "const input = JSON.parse(readFileSync(0, 'utf8'));",
        "appendFileSync(process.env.STUB_LOG, JSON.stringify(input) + '\\n');",
        "process.stdout.write(JSON.stringify({ action: 'handoff', reply: 'ok', lead: { goal: 'alugar', regions: ['Lapa'], budget: 'R$ 2.500,00' } }));",
      ].join('\n'),
    );
    const log = join(dir, 'log.jsonl');
    process.env.STUB_LOG = log;
    const out = join(dir, 'predictions.jsonl');

    const c = capture();
    expect(await run(['predict', '--dataset', 'realestate', '--exec', `${process.execPath} ${stub}`, '--out', out], c.io)).toBe(0);
    expect(c.out.join('\n')).toContain('Score them with: handoff-evals score');
    expect(c.out.join('\n')).toContain('--dataset realestate');

    const seen = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { system: string; user: string });
    expect(seen).toHaveLength(43);
    expect(new Set(seen.map((s) => s.user))).toEqual(new Set(cases.map((x) => x.message)));
    for (const s of seen) {
      expect(s.system).toContain('Imobiliária Modelo');
      expect(s.system).toContain('Não atendemos aos domingos');
      expect(s.system).not.toContain('{{business}}');
    }

    const predictions = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; lead: { budget: string } });
    expect(predictions).toHaveLength(43);
    expect(predictions.every((p) => p.action === 'handoff' && p.lead.budget === 'R$ 2.500,00')).toBe(true);

    const s = capture();
    expect(await run(['score', out, '--dataset', 'realestate'], s.io)).toBe(0);
    expect(s.out.join('\n')).toMatch(/Budget \| \d+ \| \d+ \|/);
  });

  it('refuses to mix --exec with an endpoint, and asks for one of them', async () => {
    const both = capture();
    expect(await run(['predict', '--exec', 'echo', '--base-url', 'http://localhost:1', '--model', 'm'], both.io)).toBe(1);
    expect(both.err.join('')).toContain('not both');
    const none = capture();
    expect(await run(['predict', '--dataset', 'realestate'], none.io)).toBe(1);
    expect(none.err.join('')).toContain('predict needs --base-url and --model');
  });

  it('reports a command that fails, or that does not exist, and an empty command', async () => {
    await expect(execCompleter(`${process.execPath} -e process.exit(3)`)('s', 'u')).rejects.toThrow(/Command failed/);
    await expect(execCompleter('this-command-does-not-exist-xyz')('s', 'u')).rejects.toThrow();
    expect(() => execCompleter('   ')).toThrow('--exec needs a command');
  });

  it('retries a failing completer, and gives up with the last error', async () => {
    let calls = 0;
    const first = cases.slice(0, 1);
    const results = await predictAll({
      complete: async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return '{"action":"answer","lead":{}}';
      },
      systemPrompt: 's',
      cases: first,
      retryDelayMs: 1,
    });
    expect(calls).toBe(3);
    expect(results[0]).toMatchObject({ id: 'R01-pt', action: 'answer', lead: {} });

    await expect(
      predictAll({ complete: async () => Promise.reject(new Error('still down')), systemPrompt: 's', cases: first, retryDelayMs: 1 }),
    ).rejects.toThrow('Request failed after 3 attempts: still down');
    await expect(predictAll({ systemPrompt: 's', cases: first })).rejects.toThrow('needs a baseUrl and a model');
  });
});
