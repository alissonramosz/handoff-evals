import { fraction, pct, type Rate } from './score.js';
import type { Case, LeadFields, Prediction } from './types.js';

/** The fields of the lead card that are scored, in the order of the report. */
export const LEAD_FIELDS = ['goal', 'propertyType', 'regions', 'budget', 'bedrooms', 'payment'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export function emptyLead(): LeadFields {
  return { goal: null, propertyType: null, regions: [], budget: null, bedrooms: null, payment: null };
}

/** Fill in what a scenario leaves out: a field that is not written is a field the message does not state. */
export function completeLead(partial: Partial<LeadFields> | undefined): LeadFields {
  return { ...emptyLead(), ...(partial ?? {}), regions: [...(partial?.regions ?? [])] };
}

const strip = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Compare words without accents, case, spaces or dashes: "à vista", "A vista" and "a-vista" are the same. */
export const textKey = (text: string): string => strip(text).replace(/[^a-z0-9]+/g, '');

const MULTIPLIERS: Record<string, number> = { mil: 1_000, k: 1_000, mi: 1_000_000, milhao: 1_000_000, milhoes: 1_000_000 };

/**
 * A Brazilian amount as a whole number of reais:
 * "R$ 2.500,00", "2.500", "2,5 mil", "500 mil", "300k", "1,2 milhão" and "uns 2 milhões".
 * A number is rounded. Anything else gives null.
 */
export function parseBRL(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const match = /(\d[\d.,]*)\s*(milhoes|milhao|mil|mi|k)?(?![a-z])/.exec(strip(value));
  if (!match?.[1]) return null;
  let digits = match[1].replace(/[.,]+$/, '');
  if (digits.includes(',')) digits = digits.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, '');
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * (MULTIPLIERS[match[2] ?? ''] ?? 1));
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === 'string') {
    const match = /\d+/.exec(value);
    return match ? Number(match[0]) : null;
  }
  return null;
}

function label(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || ['null', 'none', 'n/a'].includes(trimmed.toLowerCase()) ? null : trimmed;
}

function names(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.map(label).filter((name): name is string => name !== null);
}

/** Read the `lead` object of a model reply leniently: a value of the wrong type counts as not filled in. */
export function readLead(value: unknown): LeadFields {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    goal: label(v.goal),
    propertyType: label(v.propertyType),
    regions: names(v.regions),
    budget: parseBRL(v.budget),
    bedrooms: wholeNumber(v.bedrooms),
    payment: label(v.payment),
  };
}

/**
 * correct: stated and right. missed: stated, left empty. wrong: stated, other value.
 * absent: not stated and left empty. invented: not stated, but filled in.
 */
export type Outcome = 'correct' | 'missed' | 'wrong' | 'absent' | 'invented';

const filled = (field: LeadField, lead: LeadFields): boolean => (field === 'regions' ? lead.regions.length > 0 : lead[field] !== null);

function same(field: LeadField, expected: LeadFields, predicted: LeadFields): boolean {
  if (field === 'regions') {
    const want = new Set(expected.regions.map(textKey));
    const got = new Set(predicted.regions.map(textKey));
    return want.size === got.size && [...want].every((key) => got.has(key));
  }
  if (field === 'budget' || field === 'bedrooms') return expected[field] === predicted[field];
  return textKey(String(expected[field])) === textKey(String(predicted[field]));
}

export function compareLead(expected: LeadFields, predicted: LeadFields): Record<LeadField, Outcome> {
  const outcome = {} as Record<LeadField, Outcome>;
  for (const field of LEAD_FIELDS) {
    const stated = filled(field, expected);
    const given = filled(field, predicted);
    outcome[field] = stated ? (!given ? 'missed' : same(field, expected, predicted) ? 'correct' : 'wrong') : given ? 'invented' : 'absent';
  }
  return outcome;
}

export interface FieldMetrics {
  /** Cases whose message states the field. */
  stated: number;
  correct: number;
  missed: number;
  wrong: number;
  /** Cases whose message does not state the field. */
  unstated: number;
  /** Unstated, but the system filled it in. */
  invented: number;
}

export interface LeadReport {
  cases: number;
  fields: Record<LeadField, FieldMetrics>;
  /** Messages where every one of the six fields is right, empty ones included. */
  exact: Rate;
  /** Fields the message does not state that the system filled in anyway. */
  invented: Rate;
  /** Replies with no `lead` object at all. They count as every field left empty. */
  missingLead: number;
}

const rate = (count: number, of: number): Rate => ({ count, of, rate: of === 0 ? 0 : count / of });

export function scoreLeads(cases: Case[], predictions: Prediction[]): LeadReport {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const fields = Object.fromEntries(
    LEAD_FIELDS.map((f) => [f, { stated: 0, correct: 0, missed: 0, wrong: 0, unstated: 0, invented: 0 }]),
  ) as Record<LeadField, FieldMetrics>;
  let total = 0;
  let exact = 0;
  let missingLead = 0;

  for (const c of cases) {
    if (!c.lead) continue;
    total += 1;
    const given = byId.get(c.id)?.lead;
    if (typeof given !== 'object' || given === null) missingLead += 1;
    const outcome = compareLead(c.lead, readLead(given));
    let allRight = true;
    for (const field of LEAD_FIELDS) {
      const m = fields[field];
      const o = outcome[field];
      if (o === 'correct' || o === 'missed' || o === 'wrong') m.stated += 1;
      else m.unstated += 1;
      if (o === 'correct') m.correct += 1;
      if (o === 'missed') m.missed += 1;
      if (o === 'wrong') m.wrong += 1;
      if (o === 'invented') m.invented += 1;
      if (o !== 'correct' && o !== 'absent') allRight = false;
    }
    if (allRight) exact += 1;
  }

  const unstated = LEAD_FIELDS.reduce((sum, f) => sum + fields[f].unstated, 0);
  const invented = LEAD_FIELDS.reduce((sum, f) => sum + fields[f].invented, 0);
  return { cases: total, fields, exact: rate(exact, total), invented: rate(invented, unstated), missingLead };
}

const FIELD_LABELS: Record<LeadField, string> = {
  goal: 'Goal',
  propertyType: 'Property type',
  regions: 'Regions',
  budget: 'Budget',
  bedrooms: 'Bedrooms',
  payment: 'Payment',
};

/** A Markdown summary: one row per lead field, then the measures over the whole card. */
export function formatLeadReport(report: LeadReport): string {
  const lines = [
    '| Lead field | Stated in the message | Correct | Missed | Wrong value | Invented (of the unstated) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...LEAD_FIELDS.map((f) => {
      const m = report.fields[f];
      return `| ${FIELD_LABELS[f]} | ${m.stated} | ${m.correct} | ${m.missed} | ${m.wrong} | ${m.invented}/${m.unstated} |`;
    }),
    '',
    `All six fields right: ${pct(report.exact.rate)} (${fraction(report.exact)} messages)`,
    `Invented values: ${fraction(report.invented)} of the fields a message does not state`,
    `Replies without a lead object: ${report.missingLead}`,
  ];
  return lines.join('\n');
}
