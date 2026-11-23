import { afterEach, describe, expect, it } from 'vitest';
import { loadCases } from '../src/dataset.js';
import { buildSystemPrompt, parseAction, predictAll } from '../src/predict.js';
import { score } from '../src/score.js';
import { completion, startStub, type Stub } from './stub.js';

describe('parseAction', () => {
  it.each([
    ['{"action":"handoff","reply":"A person will help."}', 'handoff'],
    ['```json\n{"action":"urgent","reply":"x"}\n```', 'urgent'],
    // Only the code block can be read here: the braces before it would confuse a plain search.
    ['Format: {ignore this}\n```json\n{"action":"clarify","reply":"x"}\n```', 'clarify'],
    ['Sure! {"action": "ANSWER", "reply": "x"} Hope this helps.', 'answer'],
    ['{"action":"call-the-police"}', 'invalid'],
    ['I would hand this one off.', 'invalid'],
    ['null', 'invalid'],
    ['{"reply":"there is no action"}', 'invalid'],
  ])('%j is read as %s', (text, expected) => {
    expect(parseAction(text)).toBe(expected);
  });
});

describe('buildSystemPrompt', () => {
  it('puts the business information in place', () => {
    expect(buildSystemPrompt('Rules.\n\n{{business}}', ' Info. ')).toBe('Rules.\n\nInfo.');
  });

  it('uses a prompt without the placeholder as it is', () => {
    expect(buildSystemPrompt('Just rules.', 'Info.')).toBe('Just rules.');
  });

  it('does not treat the business text as a replacement pattern', () => {
    expect(buildSystemPrompt('A {{business}} B', 'costs $& and $1')).toBe('A costs $& and $1 B');
  });
});

describe('predictAll', () => {
  const cases = loadCases();
  const expectedByMessage = new Map(cases.map((c) => [c.message, c.expected]));
  const perfectReply = (message: string) => completion(JSON.stringify({ action: expectedByMessage.get(message), reply: 'ok' }));
  let stub: Stub | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  const base = (url: string) => ({ baseUrl: url, model: 'test-model', systemPrompt: 'SYSTEM', cases, retryDelayMs: 1 });

  it('asks the model about every case and scores a perfect model at 100%', async () => {
    stub = await startStub((message) => ({ status: 200, body: perfectReply(message) }));
    const results = await predictAll({ ...base(stub.url), apiKey: 'test-key', concurrency: 5 });
    expect(results).toHaveLength(100);
    expect(score(cases, results).overall.accuracy).toBe(1);
    expect(stub.seen).toHaveLength(100);
    expect(new Set(stub.seen.map((s) => s.auth))).toEqual(new Set(['Bearer test-key']));
    expect(stub.seen[0]?.body).toMatchObject({ model: 'test-model', temperature: 0 });
    expect(stub.seen[0]?.body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(stub.maxInFlight()).toBeLessThanOrEqual(5);
    expect(stub.maxInFlight()).toBeGreaterThan(1);
  });

  it('sends no Authorization header when there is no key', async () => {
    stub = await startStub((message) => ({ status: 200, body: perfectReply(message) }));
    await predictAll({ ...base(stub.url) });
    expect(new Set(stub.seen.map((s) => s.auth))).toEqual(new Set([undefined]));
  });

  it('retries a rate limit and carries on', async () => {
    stub = await startStub((message, attempt) =>
      attempt === 1 ? { status: 429, body: { error: 'slow down' } } : { status: 200, body: perfectReply(message) },
    );
    const results = await predictAll({ ...base(stub.url), concurrency: 8 });
    expect(score(cases, results).overall.accuracy).toBe(1);
    expect(stub.seen).toHaveLength(200); // every message needed a second attempt
  });

  it('stops at the first error that retrying cannot fix, without leaking the key', async () => {
    stub = await startStub(() => ({ status: 401, body: { error: 'bad key' } }));
    const error = await predictAll({ ...base(stub.url), apiKey: 'secret-key-123' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 401');
    expect((error as Error).message).not.toContain('secret-key-123');
    expect(stub.seen.length).toBeLessThan(100);
  });

  it('gives up after the retries when the server keeps failing', async () => {
    stub = await startStub(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(predictAll({ ...base(stub.url), retries: 2, concurrency: 1 })).rejects.toThrow(/after 3 attempts: HTTP 500/);
    expect(stub.seen).toHaveLength(3);
  });

  it('keeps unusable replies as invalid, with the raw text', async () => {
    stub = await startStub(() => ({ status: 200, body: completion('I cannot help with that.') }));
    const results = await predictAll({ ...base(stub.url) });
    expect(results.every((r) => r.action === 'invalid' && r.raw === 'I cannot help with that.')).toBe(true);
    expect(score(cases, results).overall.invalid).toBe(100);
  });
});
