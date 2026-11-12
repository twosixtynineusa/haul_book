import { describe, expect, it } from 'vitest';
import {
  companyChoiceText,
  companyOptions,
  companyOriginLabel,
  fileKey,
  formatChoiceText,
  needsAttention,
  periodText,
  shownValue,
  sourceSwitchText,
  toChoices,
  unitOptions,
  unitsFor,
  withOfferedProMilesUnits,
  askedTrucks,
} from './sources';
import { company } from './test-helpers';

describe('sources', () => {
  it('sends only what the user set, trimmed', () => {
    expect(
      toChoices([
        {},
        { format: 'wialon', company: '  ACME LLC ', unit: '' },
        { company: '   ', unit: ' 22 ' },
      ]),
    ).toEqual([{}, { format: 'wialon', company: 'ACME LLC' }, { unit: '22' }]);
  });

  it('shows the user’s text once touched, else what the file gave', () => {
    expect(shownValue(undefined, '22')).toBe('22');
    expect(shownValue('', '22')).toBe('');
    expect(shownValue('25', '22')).toBe('25');
    expect(shownValue(undefined, null)).toBe('');
  });

  it('finds a company’s saved units case/spacing-insensitively', () => {
    const companies = [company('Acme Trucking LLC', ['22', '25'])];
    expect(unitsFor(companies, 'acme  trucking llc')).toEqual(['22', '25']);
    expect(unitsFor(companies, 'Other')).toEqual([]);
    expect(unitsFor(companies, '')).toEqual([]);
  });

  it('flags files that need input or can’t be read', () => {
    const base = {
      name: 'a.csv',
      format: null,
      formatDetected: false,
      company: null,
      companyOrigin: null,
      companyOptions: [],
      unit: null,
      unitDetected: false,
      units: [],
      period: null,
      suggestedPeriod: null,
      formatOptions: [],
      promilesUnits: {},
      newTrucks: [],
      needs: [],
      knownSource: null,
      error: null,
    };
    expect(needsAttention(base)).toBe(false);
    expect(needsAttention({ ...base, needs: ['company'] })).toBe(true);
    expect(needsAttention({ ...base, error: 'nope' })).toBe(true);
    expect(needsAttention(undefined)).toBe(false);
    expect(fileKey({ name: 'a.csv', size: 3 })).toBe('a.csv:3');

    // New trucks: their own truck # is offered once, then what the user typed is kept.
    const motive = {
      ...base,
      units: ['Volvo 7', '31'],
      newTrucks: ['Volvo 7', '31'],
      promilesUnits: { 'Volvo 7': 'Volvo 7', '31': '31' },
      needs: ['promilesUnit' as const],
    };
    const file = { name: 'a.csv', size: 3 };
    const offered = withOfferedProMilesUnits({}, [file], [motive]);
    expect(offered['a.csv:3'].promilesUnits).toEqual({ 'Volvo 7': 'Volvo 7', '31': '31' });
    expect(withOfferedProMilesUnits(offered, [file], [motive])).toBe(offered);
    const typed = { promilesUnits: { 'Volvo 7': '2017', '31': ' ' } };
    expect(toChoices([typed])).toEqual([{ promilesUnits: { 'Volvo 7': '2017' } }]);
    // Sent, they're no longer "new" to the API but still asked here.
    expect(askedTrucks({ ...motive, newTrucks: [] }, typed)).toEqual(['Volvo 7', '31']);
    expect(askedTrucks({ ...motive, newTrucks: [] }, {})).toEqual([]);
  });
});

describe('source switches', () => {
  it('keeps a confirmed switch in the choices sent', () => {
    expect(toChoices([{ company: 'ACME', confirmSource: true }, { confirmSource: false }])).toEqual(
      [{ company: 'ACME', confirmSource: true }, {}],
    );
  });

  it('says which source the company came from and which this file is', () => {
    expect(sourceSwitchText('ACME TRUCKING LLC', 'ezlogz', 'wialon')).toBe(
      'ACME TRUCKING LLC was imported from Wialon until now; this file is from Ezlogz.',
    );
    expect(sourceSwitchText(null, null, null)).toBe(
      'This company was imported from another source until now; this file is from a different source.',
    );
  });
});

describe('formatChoiceText', () => {
  it('names the sources that share a layout', () => {
    expect(formatChoiceText(['bellamsp-anir', 'hos247'])).toBe(
      'This layout is exported by either Bellfam ELD or HOS 247, and nothing says which: pick the system it came from.',
    );
  });
});

describe('pick lists', () => {
  const companies = [
    company('ACME TRUCKING LLC', ['22', '25'], { source: 'motive' }),
    company('X Y Z FREIGHT LLC', ['22'], { source: null }),
  ];

  it('lists every saved company, the ones running the file’s unit # first', () => {
    expect(companyOptions(companies)).toEqual([
      { value: 'ACME TRUCKING LLC', hint: 'Motive · 2 trucks' },
      { value: 'X Y Z FREIGHT LLC', hint: '1 truck' },
    ]);
    expect(companyOptions(companies, ['x y z freight llc']).map((o) => o.hint)).toEqual([
      'has this truck # · 1 truck',
      'Motive · 2 trucks',
    ]);
  });

  it('lists the company’s trucks, or every saved truck with its companies', () => {
    expect(unitOptions(companies, 'acme trucking llc')).toEqual([{ value: '22' }, { value: '25' }]);
    expect(unitOptions(companies, '')).toEqual([
      { value: '22', hint: 'ACME TRUCKING LLC, X Y Z FREIGHT LLC' },
      { value: '25', hint: 'ACME TRUCKING LLC' },
    ]);
  });

  it('labels where the company came from, and asks which when a unit # is shared', () => {
    expect(companyOriginLabel('unit')).toBe('by truck #');
    expect(companyOriginLabel('file')).toBe('from file');
    expect(companyOriginLabel('user')).toBeNull();
    expect(companyChoiceText('22', ['ACME', 'XYZ'])).toBe(
      'Truck 22 is saved under ACME and XYZ: pick which company this file is for.',
    );
  });
});

describe('periods', () => {
  it('sends a period only once both dates are in', () => {
    expect(
      toChoices([
        { period: { begin: '2026-10-01', end: '' } },
        { period: { begin: '2026-10-01', end: '2026-10-31' } },
      ]),
    ).toEqual([{}, { period: { begin: '2026-10-01', end: '2026-10-31' } }]);
  });

  it('writes a period as dates', () => {
    expect(periodText({ begin: '2026-10-01', end: '2026-10-31' })).toBe(
      'Oct 1, 2026 – Oct 31, 2026',
    );
  });
});
