import { describe, expect, it } from 'vitest';
import {
  fileKey,
  formatChoiceText,
  needsAttention,
  shownValue,
  sourceSwitchText,
  toChoices,
  unitsFor,
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
      companyDetected: false,
      unit: null,
      unitDetected: false,
      formatOptions: [],
      needs: [],
      knownSources: [],
      error: null,
    };
    expect(needsAttention(base)).toBe(false);
    expect(needsAttention({ ...base, needs: ['company'] })).toBe(true);
    expect(needsAttention({ ...base, error: 'nope' })).toBe(true);
    expect(needsAttention(undefined)).toBe(false);
    expect(fileKey({ name: 'a.csv', size: 3 })).toBe('a.csv:3');
  });
});

describe('source switches', () => {
  it('keeps a confirmed switch in the choices sent', () => {
    expect(toChoices([{ company: 'ACME', confirmSource: true }, { confirmSource: false }])).toEqual(
      [{ company: 'ACME', confirmSource: true }, {}],
    );
  });

  it('says which source the company came from and which this file is', () => {
    expect(sourceSwitchText('ACME TRUCKING LLC', 'ezlogz', ['wialon'])).toBe(
      'ACME TRUCKING LLC was imported from Wialon until now; this file is from EZLogz.',
    );
    expect(sourceSwitchText(null, null, ['wialon', 'motive'])).toBe(
      'This company was imported from Wialon or Motive until now; this file is from a different source.',
    );
  });
});

describe('formatChoiceText', () => {
  it('names the sources that share a layout', () => {
    expect(formatChoiceText(['bellamsp-anir', 'hos247'])).toBe(
      'This layout is exported by either BELLAMSP-ANIR or HOS247, and nothing says which: pick the system it came from.',
    );
  });
});
