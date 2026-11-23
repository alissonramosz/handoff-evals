import { describe, expect, it } from 'vitest';
import { completeLead, compareLead, formatLeadReport, parseBRL, readLead, scoreLeads } from '../src/lead.js';
import type { Case } from '../src/types.js';

describe('parseBRL', () => {
  it.each([
    ['R$ 2.500,00', 2500],
    ['R$ 3.500,00 por mês', 3500],
    ['2.500', 2500],
    ['3800', 3800],
    ['2,5 mil', 2500],
    ['1,8 mil', 1800],
    ['500 mil', 500000],
    ['500k', 500000],
    ['750K', 750000],
    ['1,2 milhão', 1200000],
    ['1,5 milhões', 1500000],
    ['uns 2 milhões', 2000000],
    ['1.200.000', 1200000],
    ['R$ 1.200.000,00', 1200000],
    ['1.5k', 1500],
  ])('reads %s as %d', (text, value) => {
    expect(parseBRL(text)).toBe(value);
  });

  it('keeps a number, rounded, and gives null for anything else', () => {
    expect(parseBRL(2500)).toBe(2500);
    expect(parseBRL(1200000.0000001)).toBe(1200000);
    expect(parseBRL(null)).toBeNull();
    expect(parseBRL(undefined)).toBeNull();
    expect(parseBRL('sem limite')).toBeNull();
    expect(parseBRL(Number.NaN)).toBeNull();
    expect(parseBRL({})).toBeNull();
  });
});

describe('readLead', () => {
  it('reads a clean lead card', () => {
    const card = { goal: 'comprar', propertyType: 'casa', regions: ['Moema'], budget: 900000, bedrooms: 3, payment: 'fgts' };
    expect(readLead(card)).toEqual(card);
  });

  it('is lenient about types: a string for a list, text for a number, "null" for empty', () => {
    expect(
      readLead({ goal: 'null', propertyType: ' casa ', regions: 'Moema', budget: 'R$ 2.500,00', bedrooms: '2 quartos', payment: '' }),
    ).toEqual({ goal: null, propertyType: 'casa', regions: ['Moema'], budget: 2500, bedrooms: 2, payment: null });
  });

  it('treats a missing or odd lead as empty', () => {
    expect(readLead(undefined)).toEqual(completeLead({}));
    expect(readLead('oops')).toEqual(completeLead({}));
    expect(readLead({ regions: [1, null, 'Lapa'] })).toEqual(completeLead({ regions: ['Lapa'] }));
  });
});

describe('compareLead', () => {
  const expected = completeLead({ goal: 'alugar', regions: ['Santo André'], budget: 2500, payment: 'a vista' });

  it('calls a right value correct, whatever the accents, case and dashes', () => {
    const outcome = compareLead(expected, readLead({ goal: 'ALUGAR', regions: ['santo andre'], budget: '2.500', payment: 'à vista' }));
    expect(outcome).toEqual({
      goal: 'correct',
      propertyType: 'absent',
      regions: 'correct',
      budget: 'correct',
      bedrooms: 'absent',
      payment: 'correct',
    });
  });

  it('tells wrong, missed and invented apart', () => {
    const outcome = compareLead(
      expected,
      readLead({ goal: 'comprar', budget: null, propertyType: 'casa', regions: ['Santo André', 'Mauá'], payment: 'a vista' }),
    );
    expect(outcome.goal).toBe('wrong');
    expect(outcome.budget).toBe('missed');
    expect(outcome.propertyType).toBe('invented');
    expect(outcome.regions).toBe('wrong');
    expect(outcome.bedrooms).toBe('absent');
  });

  it('compares money as numbers, not as text', () => {
    expect(compareLead(completeLead({ budget: 2500 }), readLead({ budget: 2.5 })).budget).toBe('wrong');
    expect(compareLead(completeLead({ budget: 1200000 }), readLead({ budget: '1,2 milhão' })).budget).toBe('correct');
  });
});

describe('scoreLeads', () => {
  const cases: Case[] = [
    { id: 'A-pt', scenario: 'A', language: 'pt', message: 'm1', expected: 'handoff', category: 'x', lead: completeLead({ goal: 'alugar', budget: 2500 }) },
    { id: 'B-pt', scenario: 'B', language: 'pt', message: 'm2', expected: 'answer', category: 'x', lead: completeLead({}) },
    { id: 'C-pt', scenario: 'C', language: 'pt', message: 'm3', expected: 'answer', category: 'x' },
  ];

  it('gives full marks to a perfect system and ignores a case with no lead card', () => {
    const report = scoreLeads(cases, [
      { id: 'A-pt', action: 'handoff', lead: { goal: 'alugar', budget: 2500 } },
      { id: 'B-pt', action: 'answer', lead: {} },
    ]);
    expect(report.cases).toBe(2);
    expect(report.exact).toMatchObject({ count: 2, of: 2 });
    expect(report.invented.count).toBe(0);
    expect(report.missingLead).toBe(0);
  });

  it('counts wrong, missed, invented and missing', () => {
    const report = scoreLeads(cases, [
      { id: 'A-pt', action: 'handoff', lead: { goal: 'comprar', regions: ['Lapa'] } },
      { id: 'B-pt', action: 'answer' },
    ]);
    expect(report.fields.goal).toMatchObject({ stated: 1, correct: 0, wrong: 1 });
    expect(report.fields.budget).toMatchObject({ stated: 1, missed: 1 });
    expect(report.fields.regions).toMatchObject({ unstated: 2, invented: 1 });
    expect(report.exact.count).toBe(1);
    expect(report.invented).toMatchObject({ count: 1, of: 10 });
    expect(report.missingLead).toBe(1);
  });

  it('does not count a card with an invented value as exact, even when the rest is right', () => {
    const report = scoreLeads(cases.slice(0, 1), [{ id: 'A-pt', action: 'handoff', lead: { goal: 'alugar', budget: 2500, regions: ['Lapa'] } }]);
    expect(report.fields.regions.invented).toBe(1);
    expect(report.exact.count).toBe(0);
  });

  it('prints a table with a row per field', () => {
    const table = formatLeadReport(scoreLeads(cases, []));
    for (const field of ['Goal', 'Property type', 'Regions', 'Budget', 'Bedrooms', 'Payment']) {
      expect(table).toContain(`| ${field} |`);
    }
    expect(table).toContain('Replies without a lead object: 2');
  });
});
