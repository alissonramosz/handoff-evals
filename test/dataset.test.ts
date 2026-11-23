import { describe, expect, it } from 'vitest';
import { casesToJsonl, loadCases, loadScenarios, readText, validateScenarios } from '../src/dataset.js';
import { LANGUAGES } from '../src/types.js';

const valid = () => ({
  id: 'S01',
  expected: 'answer',
  category: 'faq-hours',
  note: 'Why this action is right.',
  messages: { en: 'Hello there', pt: 'Olá, tudo bem?', es: 'Hola, ¿qué tal?', ru: 'Привет, как дела?' },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const problems = (change: (s: any) => void): string[] => {
  const scenario = valid();
  change(scenario);
  return validateScenarios([scenario]);
};

describe('the dataset', () => {
  it('has no integrity problems', () => {
    expect(validateScenarios(loadScenarios())).toEqual([]);
  });

  it('has 25 scenarios written in 4 languages: 100 cases, 25 per language', () => {
    const cases = loadCases();
    expect(loadScenarios()).toHaveLength(25);
    expect(cases).toHaveLength(100);
    for (const language of LANGUAGES) {
      expect(cases.filter((c) => c.language === language)).toHaveLength(25);
    }
  });

  it('keeps the planned mix of actions', () => {
    const count = (action: string) => loadScenarios().filter((s) => s.expected === action).length;
    expect([count('answer'), count('clarify'), count('handoff'), count('urgent')]).toEqual([9, 3, 10, 3]);
  });

  it('ships cases.jsonl in sync with scenarios.json', () => {
    expect(readText('dataset/cases.jsonl')).toBe(casesToJsonl(loadCases()));
  });

  it('has a prompt that takes the business information', () => {
    expect(readText('prompts/router.md')).toContain('{{business}}');
  });
});

describe('validateScenarios', () => {
  it('accepts a sound scenario', () => {
    expect(validateScenarios([valid()])).toEqual([]);
  });

  it('rejects anything that is not a non-empty array', () => {
    expect(validateScenarios([])).toHaveLength(1);
    expect(validateScenarios({})).toHaveLength(1);
  });

  it('reports a missing language', () => {
    expect(problems((s) => delete s.messages.pt)).toEqual(['scenario #1 (S01): missing pt message']);
  });

  it('reports an unknown language', () => {
    expect(problems((s) => (s.messages.fr = 'Bonjour'))).toEqual(['scenario #1 (S01): unknown languages fr']);
  });

  it('reports a bad id, action, category and note', () => {
    expect(problems((s) => (s.id = 'one'))[0]).toContain('id must look like S01');
    expect(problems((s) => (s.expected = 'call-the-police'))[0]).toContain('expected must be one of');
    expect(problems((s) => (s.category = 'Not Kebab'))[0]).toContain('category must be kebab-case');
    expect(problems((s) => (s.note = ' '))[0]).toContain('note is required');
  });

  it('reports a duplicate id and a repeated message', () => {
    const other = { ...valid(), messages: { ...valid().messages, en: 'A different sentence' } };
    expect(validateScenarios([valid(), other])).toEqual(
      expect.arrayContaining([
        'scenario #2 (S01): duplicate id',
        'scenario #2 (S01): pt message repeats S01-pt',
      ]),
    );
  });

  it('reports a message that is too long', () => {
    expect(problems((s) => (s.messages.en = 'x'.repeat(301)))[0]).toContain('longer than 300');
  });

  it('checks the script of each language', () => {
    expect(problems((s) => (s.messages.ru = 'Hello'))[0]).toContain('ru message has no Cyrillic');
    expect(problems((s) => (s.messages.pt = 'Привет'))[0]).toContain('pt message must be written in Latin script');
    expect(problems((s) => (s.messages.en = '12345'))[0]).toContain('en message must be written in Latin script');
  });
});
