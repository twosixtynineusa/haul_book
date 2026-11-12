import { mkdirSync, writeFileSync } from 'node:fs';
import { HistoryEntrySchema } from '@haulbook/shared';
import { fixture } from '../../test/helpers/wialon-report';
import { companyReportPdf, selectReportTrips } from './company-report';
import { parseProMilesCsv } from './promiles-snapshot';

const promiles = parseProMilesCsv(fixture('promiles_expected_big_road_oct2026.csv').toString())[0];
const entry = HistoryEntrySchema.parse({
  id: 'one',
  convertedAt: '2026-11-01T10:00:00Z',
  origin: 'portal',
  company: 'ACME TRUCKING LLC',
  companyId: 'company',
  unit: '007',
  promilesUnit: '007',
  truckId: 'truck',
  source: 'big-road',
  sourceFile: 'Vehicle Mileage.xls',
  outputFile: 'ACME_unit-007.csv',
  beginDate: '2026-10-01',
  endDate: '2026-10-31',
  beginOdo: null,
  endOdo: null,
  distance: 351,
  distanceUnit: 'M',
  states: ['OR', 'WA'],
  trips: [
    {
      beginDate: '2026-10-01',
      endDate: '2026-10-31',
      beginOdo: null,
      endOdo: null,
      distance: 351,
      states: ['OR', 'WA'],
      promiles,
    },
  ],
});
describe('Company PDF report', () => {
  it('uses the newest exact-period conversion, preserves separate trucks and excludes partial periods', () => {
    const newer = { ...entry, id: 'new', convertedAt: '2026-11-02T10:00:00Z' };
    expect(selectReportTrips([entry, newer], {}).trips.map((t) => t.entry.id)).toEqual(['new']);
    expect(selectReportTrips([entry, { ...newer, truckId: 'other' }], {}).trips).toHaveLength(2);
    expect(selectReportTrips([entry], { from: '2026-10-02' })).toMatchObject({
      trips: [],
      partial: 1,
    });
    expect(selectReportTrips([entry], { from: '2026-11-01' })).toMatchObject({
      trips: [],
      partial: 0,
    });
  });
  it('flags different overlapping periods for the same truck', () => {
    const quarter = {
      ...entry,
      id: 'quarter',
      trips: [{ ...entry.trips[0], beginDate: '2026-09-01' }],
    };
    expect(selectReportTrips([entry, quarter], {}).overlap).toBe(true);
    expect(selectReportTrips([entry, { ...quarter, truckId: 'other' }], {}).overlap).toBe(false);
  });
  it('renders a multipage report for visual QA, including missing detail and long names', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      ...entry,
      id: `${i}`,
      unit: `${i + 1}`,
      truckId: `truck-${i}`,
      sourceFile: 'Fictional_report_with_a_long_filename_for_layout_verification_2026_10.csv',
      trips: entry.trips.map((t) => (i === 11 ? { ...t, promiles: undefined } : t)),
    }));
    const pdf = await companyReportPdf(
      { name: 'ACME TRUCKING LLC', dotNumber: '1234567', iftaAccount: 'ACME-2026' },
      entries,
      {},
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(3000);
    // Fictional test artifact only, under the git-ignored output folder.
    mkdirSync('/workspace/output/pdf', { recursive: true });
    writeFileSync('/workspace/output/pdf/company-report-qa.pdf', pdf);
  });
});
