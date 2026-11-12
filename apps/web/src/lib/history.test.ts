import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@haulbook/shared';
import { filterHistory, formatOdo, historyTotals, rangeText } from './history';

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'h1',
  convertedAt: '2026-11-07T12:00:00.000Z',
  origin: 'portal',
  company: 'ACME TRUCKING LLC',
  companyId: 'c1',
  unit: '22',
  promilesUnit: '22',
  truckId: 't1',
  source: 'wialon',
  sourceFile: '22_IFTA_Single_Unit_Mileage_Report.csv',
  outputFile: 'ACME-TRUCKING-LLC_unit-22_2026-10.csv',
  beginDate: '2026-10-01',
  endDate: '2026-10-31',
  beginOdo: '431000',
  endOdo: '432160.5',
  distance: 1160.5,
  distanceUnit: 'M',
  states: ['TX', 'OK'],
  trips: [],
  ...over,
});

describe('history', () => {
  it('writes odometers with separators, or a dash when unknown', () => {
    expect(formatOdo('432160.5')).toBe('432,160.5');
    expect(formatOdo(null)).toBe('—');
  });

  it('writes date ranges compactly', () => {
    expect(rangeText('2026-10-01', '2026-11-30')).toBe('Oct 1 – Nov 30, 2026');
    expect(rangeText('2025-12-01', '2026-01-31')).toBe('Dec 1, 2025 – Jan 31, 2026');
    expect(rangeText('2026-10-05', '2026-10-05')).toBe('Oct 5, 2026');
  });

  it('searches by company, unit #, source, file or state', () => {
    const list = [
      entry({}),
      entry({
        id: 'h2',
        company: 'XYZ',
        unit: '7',
        promilesUnit: '2017',
        source: 'motive',
        sourceFile: 'trip_reports.csv',
        outputFile: 'XYZ_unit-7_2026-10.csv',
      }),
    ];
    expect(filterHistory(list, 'motive').map((e) => e.id)).toEqual(['h2']);
    expect(filterHistory(list, '2017').map((e) => e.id)).toEqual(['h2']);
    expect(filterHistory(list, 'acme').map((e) => e.id)).toEqual(['h1']);
    expect(filterHistory(list, 'tx')).toHaveLength(2);
    expect(filterHistory(list, ' ')).toHaveLength(2);
  });

  it('adds up reports, miles and the dates covered', () => {
    expect(
      historyTotals([
        entry({}),
        entry({ beginDate: '2026-11-01', endDate: '2026-11-30', distance: 100 }),
        entry({ distanceUnit: 'K', distance: 50 }),
      ]),
    ).toEqual({ reports: 3, miles: 1260.5, km: 50, from: '2026-10-01', to: '2026-11-30' });
    expect(historyTotals([])).toMatchObject({ reports: 0, from: null, to: null });
  });
});
