import { readFileSync } from 'node:fs';
import { ACTIONS, LANGUAGES, type Case, type Scenario } from './types.js';

// `src/` and `dist/` are both one level below the package root.
const root = new URL('../', import.meta.url);

export function readText(path: string): string {
  return readFileSync(new URL(path, root), 'utf8');
}

export function loadScenarios(): Scenario[] {
  return JSON.parse(readText('dataset/scenarios.json')) as Scenario[];
}

/** Every scenario in every language: the messages to evaluate. */
export function toCases(scenarios: Scenario[]): Case[] {
  return scenarios.flatMap((scenario) =>
    LANGUAGES.map((language) => ({
      id: `${scenario.id}-${language}`,
      scenario: scenario.id,
      language,
      message: scenario.messages[language],
      expected: scenario.expected,
      category: scenario.category,
    })),
  );
}

export function loadCases(): Case[] {
  return toCases(loadScenarios());
}

export function casesToJsonl(cases: Case[]): string {
  return cases.map((c) => JSON.stringify(c)).join('\n') + '\n';
}

const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN = /[A-Za-z]/;

/** What is wrong with the scenarios. An empty list means the dataset is sound. */
export function validateScenarios(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['scenarios must be a non-empty array'];
  const problems: string[] = [];
  const ids = new Set<string>();
  const seenMessages = new Map<string, string>();

  for (const [index, raw] of value.entries()) {
    const s = raw as Partial<Scenario>;
    const where = `scenario #${index + 1}${typeof s.id === 'string' ? ` (${s.id})` : ''}`;

    if (typeof s.id !== 'string' || !/^S\d{2}$/.test(s.id)) problems.push(`${where}: id must look like S01`);
    else if (ids.has(s.id)) problems.push(`${where}: duplicate id`);
    else ids.add(s.id);

    if (!(ACTIONS as readonly string[]).includes(s.expected as string)) {
      problems.push(`${where}: expected must be one of ${ACTIONS.join(', ')}`);
    }
    if (typeof s.category !== 'string' || !/^[a-z0-9-]+$/.test(s.category)) {
      problems.push(`${where}: category must be kebab-case`);
    }
    if (typeof s.note !== 'string' || s.note.trim() === '') problems.push(`${where}: note is required`);

    const messages = (s.messages ?? {}) as Record<string, unknown>;
    const unknownLanguages = Object.keys(messages).filter((k) => !(LANGUAGES as readonly string[]).includes(k));
    if (unknownLanguages.length > 0) problems.push(`${where}: unknown languages ${unknownLanguages.join(', ')}`);

    for (const language of LANGUAGES) {
      const text = messages[language];
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push(`${where}: missing ${language} message`);
        continue;
      }
      if (text.length > 300) problems.push(`${where}: ${language} message is longer than 300 characters`);
      const hasCyrillic = CYRILLIC.test(text);
      if (language === 'ru' && !hasCyrillic) problems.push(`${where}: ru message has no Cyrillic letters`);
      if (language !== 'ru' && (hasCyrillic || !LATIN.test(text))) {
        problems.push(`${where}: ${language} message must be written in Latin script`);
      }
      const previous = seenMessages.get(text);
      if (previous) problems.push(`${where}: ${language} message repeats ${previous}`);
      else seenMessages.set(text, `${String(s.id)}-${language}`);
    }
  }
  return problems;
}
