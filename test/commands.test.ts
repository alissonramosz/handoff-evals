import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/commands.js';
import { loadCases, readText } from '../src/dataset.js';
import { completion, startStub, type Stub } from './stub.js';

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

const cases = loadCases();
const expectedByMessage = new Map(cases.map((c) => [c.message, c.expected]));

describe('run', () => {
  let dir: string;
  let stub: Stub | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handoff-evals-'));
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const writePredictions = (decide: (c: (typeof cases)[number]) => string) => {
    const file = join(dir, 'predictions.jsonl');
    writeFileSync(file, cases.map((c) => JSON.stringify({ id: c.id, action: decide(c) })).join('\n') + '\n');
    return file;
  };

  it('prints help and exits 2 when there is no command', async () => {
    const c = capture();
    expect(await run([], c.io)).toBe(2);
    expect(c.out.join('\n')).toContain('Usage: handoff-evals');
  });

  it('prints the baselines table', async () => {
    const c = capture();
    expect(await run(['baselines'], c.io)).toBe(0);
    expect(c.out.join('\n')).toContain('| `keyword-en` | 80.0% | 36.0% | 40.0% | 36.0% |');
  });

  it('exports the cases as JSON Lines', async () => {
    const c = capture();
    expect(await run(['export'], c.io)).toBe(0);
    expect(c.out.join('\n') + '\n').toBe(readText('dataset/cases.jsonl'));
  });

  it('scores a predictions file, as a table and as JSON', async () => {
    const file = writePredictions((x) => x.expected);
    const table = capture();
    expect(await run(['score', file], table.io)).toBe(0);
    expect(table.out.join('\n')).toContain('| All | 100.0% (100/100) | 0/52 | 0/48 | 0/12 |');

    const json = capture();
    expect(await run(['score', file, '--json'], json.io)).toBe(0);
    expect((JSON.parse(json.out.join('\n')) as { overall: { accuracy: number } }).overall.accuracy).toBe(1);
  });

  it('explains problems in a predictions file', async () => {
    const file = join(dir, 'broken.jsonl');
    writeFileSync(file, '{"id":"S01-en","action":"answer"}\nnot json\n');
    const broken = capture();
    expect(await run(['score', file], broken.io)).toBe(1);
    expect(broken.err.join('\n')).toContain('line 2: not valid JSON');

    const partial = join(dir, 'partial.jsonl');
    writeFileSync(partial, '{"id":"S01-en","action":"answer"}\n');
    const missing = capture();
    expect(await run(['score', partial], missing.io)).toBe(1);
    expect(missing.err.join('\n')).toContain('Missing predictions for 99 case(s)');
  });

  it('rejects unknown commands and missing options', async () => {
    const unknown = capture();
    expect(await run(['dance'], unknown.io)).toBe(2);
    const noFile = capture();
    expect(await run(['score'], noFile.io)).toBe(1);
    const noModel = capture();
    expect(await run(['predict', '--base-url', 'http://localhost'], noModel.io)).toBe(1);
    expect(noModel.err.join('\n')).toContain('--base-url and --model');
    const noValue = capture();
    expect(await run(['predict', '--model'], noValue.io)).toBe(1);
    expect(noValue.err.join('\n')).toContain('--model needs a value');
  });

  it('runs a model through predict, writes the predictions and they score at 100%', async () => {
    stub = await startStub((message) => ({
      status: 200,
      body: completion(JSON.stringify({ action: expectedByMessage.get(message), reply: 'ok' })),
    }));
    const out = join(dir, 'out.jsonl');
    const c = capture();
    const code = await run(
      ['predict', '--base-url', stub.url, '--model', 'm', '--api-key-env', 'STUB_KEY', '--out', out, '--concurrency', '8'],
      c.io,
      { STUB_KEY: 'k' },
    );
    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain(`Wrote 100 predictions to ${out}`);
    expect(readFileSync(out, 'utf8').trim().split('\n')).toHaveLength(100);
    expect(stub.seen[0]?.auth).toBe('Bearer k');
    // The default prompt carries the business information.
    expect(stub.seen[0]?.body.messages[0]?.content).toContain('Casa Aurora');

    const scored = capture();
    expect(await run(['score', out], scored.io)).toBe(0);
    expect(scored.out.join('\n')).toContain('| All | 100.0% (100/100) |');
  });

  it('uses your own prompt and refuses a key variable that is not set', async () => {
    stub = await startStub((message) => ({
      status: 200,
      body: completion(JSON.stringify({ action: expectedByMessage.get(message), reply: 'ok' })),
    }));
    const prompt = join(dir, 'prompt.md');
    writeFileSync(prompt, 'My own router prompt.');
    const out = join(dir, 'custom.jsonl');
    const c = capture();
    expect(await run(['predict', '--base-url', stub.url, '--model', 'm', '--prompt', prompt, '--out', out], c.io)).toBe(0);
    expect(stub.seen[0]?.body.messages[0]?.content).toBe('My own router prompt.');

    const noKey = capture();
    expect(
      await run(['predict', '--base-url', stub.url, '--model', 'm', '--api-key-env', 'MISSING_KEY', '--out', out], noKey.io, {}),
    ).toBe(1);
    expect(noKey.err.join('\n')).toContain('MISSING_KEY is empty or not set');
  });
});
