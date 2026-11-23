import { BASELINES, runBaseline } from './baselines.js';
import { readText } from './dataset.js';
import { completeLead } from './lead.js';
import { fraction, pct } from './score.js';
import { ACTIONS, GOALS, PAYMENTS, PROPERTY_TYPES, type Case, type DatasetName, type LeadScenario } from './types.js';

/** The reference information and the default system prompt of each dataset. */
export const DATASET_FILES: Record<DatasetName, { business: string; prompt: string }> = {
  retreat: { business: 'dataset/business.md', prompt: 'prompts/router.md' },
  realestate: { business: 'dataset/realestate/business.md', prompt: 'prompts/realestate.md' },
};

export function loadLeadScenarios(): LeadScenario[] {
  return JSON.parse(readText('dataset/realestate/scenarios.json')) as LeadScenario[];
}

/** One case per scenario, in Portuguese, with the lead card the message should give. */
export function toLeadCases(scenarios: LeadScenario[]): Case[] {
  return scenarios.map((s) => ({
    id: `${s.id}-pt`,
    scenario: s.id,
    language: 'pt',
    message: s.message,
    expected: s.expected,
    category: s.category,
    lead: completeLead(s.lead),
  }));
}

export const loadRealEstateCases = (): Case[] => toLeadCases(loadLeadScenarios());

const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN = /[A-Za-zÀ-ÿ]/;
const LEAD_KEYS = ['goal', 'propertyType', 'regions', 'budget', 'bedrooms', 'payment'];

const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value);
const positiveInteger = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** What is wrong with the real-estate scenarios. An empty list means the dataset is sound. */
export function validateLeadScenarios(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['scenarios must be a non-empty array'];
  const problems: string[] = [];
  const ids = new Set<string>();
  const messages = new Set<string>();

  for (const [index, raw] of value.entries()) {
    const s = raw as Partial<LeadScenario>;
    const where = `scenario #${index + 1}${typeof s.id === 'string' ? ` (${s.id})` : ''}`;

    if (typeof s.id !== 'string' || !/^R\d{2}$/.test(s.id)) problems.push(`${where}: id must look like R01`);
    else if (ids.has(s.id)) problems.push(`${where}: duplicate id`);
    else ids.add(s.id);

    if (!oneOf(s.expected, ACTIONS)) problems.push(`${where}: expected must be one of ${ACTIONS.join(', ')}`);
    if (typeof s.category !== 'string' || !/^[a-z0-9-]+$/.test(s.category)) problems.push(`${where}: category must be kebab-case`);
    if (typeof s.note !== 'string' || s.note.trim() === '') problems.push(`${where}: note is required`);

    if (typeof s.message !== 'string' || s.message.trim() === '') {
      problems.push(`${where}: message is required`);
    } else {
      if (s.message.length > 300) problems.push(`${where}: message is longer than 300 characters`);
      if (CYRILLIC.test(s.message) || !LATIN.test(s.message)) problems.push(`${where}: message must be written in Latin script`);
      if (messages.has(s.message)) problems.push(`${where}: message repeats another scenario`);
      messages.add(s.message);
    }

    const lead = (s.lead ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(lead)) {
      if (!LEAD_KEYS.includes(key)) problems.push(`${where}: unknown lead field ${key}`);
    }
    if (lead.goal !== undefined && !oneOf(lead.goal, GOALS)) problems.push(`${where}: goal must be one of ${GOALS.join(', ')}`);
    if (lead.propertyType !== undefined && !oneOf(lead.propertyType, PROPERTY_TYPES)) {
      problems.push(`${where}: propertyType must be one of ${PROPERTY_TYPES.join(', ')}`);
    }
    if (lead.payment !== undefined && !oneOf(lead.payment, PAYMENTS)) problems.push(`${where}: payment must be one of ${PAYMENTS.join(', ')}`);
    if (lead.regions !== undefined && !(Array.isArray(lead.regions) && lead.regions.every((r) => typeof r === 'string' && r.trim() !== ''))) {
      problems.push(`${where}: regions must be a list of names`);
    }
    if (lead.budget !== undefined && !positiveInteger(lead.budget)) problems.push(`${where}: budget must be a positive whole number of reais`);
    if (lead.bedrooms !== undefined && !positiveInteger(lead.bedrooms)) problems.push(`${where}: bedrooms must be a positive whole number`);
  }
  return problems;
}

/** The two baselines that make sense for one language. Rules for the lead card would be a different project. */
export function formatRealEstateBaselines(cases: Case[]): string {
  const lines = [
    '| Baseline | Accuracy | Unsafe errors | Needless handoffs | Missed urgent |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const baseline of BASELINES.filter((b) => b.name !== 'keyword-en')) {
    const { overall } = runBaseline(baseline, cases);
    lines.push(
      `| \`${baseline.name}\` | ${pct(overall.accuracy)} (${overall.correct}/${overall.cases}) | ${fraction(overall.unsafe)} | ${fraction(overall.needlessHandoff)} | ${fraction(overall.missedUrgent)} |`,
    );
  }
  return lines.join('\n');
}
