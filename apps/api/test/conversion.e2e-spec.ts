import * as fs from 'node:fs';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ConversionPreviewSchema,
  ConversionResultSchema,
  OutputListSchema,
  companyKey,
  truckKey,
  type SourceChoice,
} from '@haulbook/shared';
import { configureApp } from '../src/app.setup';
import { CompaniesService, type RecordEntry } from '../src/companies/companies.service';
import type { SavedReading } from '../src/conversion/common';
import { ConversionModule } from '../src/conversion/conversion.module';
import { HistoryService, type HistoryRecord } from '../src/history/history.service';
import { IFTA_REPORT_SAMPLE, iftaReport } from './helpers/ifta-report';
import { bigRoadReport } from './helpers/big-road-report';
import { RAW, RAW_NAME, fixture, month, state, wialonReport } from './helpers/wialon-report';

const OUTPUT = process.env.OUTPUT_PATH as string;
const EXPECTED = fixture('promiles_expected_unit22_oct2026.csv').toString('utf8');
const COMPANY = 'ACME TRUCKING LLC';

/** In-memory stand-in for the Postgres-backed list (that one has its own integration spec). */
class FakeCompanies {
  saved = new Map<string, { name: string; units: Set<string>; source: string | null }>();
  async list() {
    return {
      companies: [...this.saved.values()].map((c) => ({ name: c.name, units: [...c.units] })),
    };
  }
  async canonicalNames(names: string[]) {
    const known = names.filter((n) => this.saved.has(companyKey(n)));
    return new Map(known.map((n) => [companyKey(n), this.saved.get(companyKey(n))!.name]));
  }
  async approvedSources(names: string[]) {
    const known = names.filter((n) => this.saved.get(companyKey(n))?.source);
    return new Map(known.map((n) => [companyKey(n), this.saved.get(companyKey(n))!.source!]));
  }
  async ownersOfUnits(units: string[]) {
    const all = [...this.saved.values()];
    return new Map(
      units.map((u) => [
        u,
        all
          .filter((c) => c.units.has(u))
          .map((c) => c.name)
          .sort(),
      ]),
    );
  }
  /** Truck # → ProMiles unit # saved per company (by companyKey). */
  promiles = new Map<string, Map<string, string | null>>();
  async trucksOf(names: string[]) {
    return new Map(
      names.map((n) => {
        const key = companyKey(n);
        const units = [...(this.saved.get(key)?.units ?? [])];
        const own = this.promiles.get(key);
        return [key, units.map((unit) => ({ unit, promilesUnit: own?.get(unit) ?? null }))];
      }),
    );
  }
  odometers = new Map<string, SavedReading>();
  async savedOdometers() {
    return this.odometers;
  }
  async record(entries: RecordEntry[]) {
    for (const { company, units, promilesUnits = {}, odometers = [], source } of entries) {
      const c = this.saved.get(companyKey(company)) ?? {
        name: company,
        units: new Set<string>(),
        source: null,
      };
      units.forEach((u) => c.units.add(u));
      const own = this.promiles.get(companyKey(company)) ?? new Map<string, string | null>();
      for (const [unit, promiles] of Object.entries(promilesUnits)) {
        own.set(unit, promiles === unit ? null : promiles);
      }
      this.promiles.set(companyKey(company), own);
      c.source = source ?? c.source;
      this.saved.set(companyKey(company), c);
      for (const { unit, ...reading } of odometers) {
        this.odometers.set(truckKey(company, unit), reading);
      }
    }
  }
}

/** A history trip over October 2026 with no odometer known. */
const octoberTrip = (distance: number, states: string) => ({
  beginDate: '2026-10-01',
  endDate: '2026-10-31',
  beginOdo: null,
  endOdo: null,
  distance,
  states: states.split(','),
});

/** Collects what would be written to the history table. */
class FakeHistory {
  async storedOutput() {
    return null;
  }
  async storedOutputs() {
    return [];
  }
  records: HistoryRecord[] = [];
  async record(records: HistoryRecord[]) {
    this.records.push(...records);
  }
}

describe('Conversions (e2e)', () => {
  let app: INestApplication;
  const companies = new FakeCompanies();
  const history = new FakeHistory();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConversionModule] })
      .overrideProvider(CompaniesService)
      .useValue(companies)
      .overrideProvider(HistoryService)
      .useValue(history)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(OUTPUT, { recursive: true, force: true });
  });

  const server = () => app.getHttpServer();
  /**
   * Every truck these tests convert, confirmed as its own ProMiles unit # (as the portal does
   * by default), so the cases below test what they're about. The waiting is tested on its own.
   */
  const SAME = Object.fromEntries(
    ['22', '25', '7', '99', '12', 'Volvo 9', 'Volvo 7', '31', '0412', '1022'].map((u) => [u, u]),
  );
  const post = (
    url: string,
    sources: SourceChoice[] = [],
    files: [Buffer, string][] = [[RAW.bytes, RAW_NAME]],
    odometers?: Record<string, string>,
    confirm = true,
  ) => {
    const choices = confirm
      ? files.map((_, i) => ({ promilesUnits: SAME, ...sources[i] }))
      : sources;
    const req = request(server()).post(url).field('sources', JSON.stringify(choices));
    if (odometers) req.field('odometers', JSON.stringify(odometers));
    for (const [bytes, name] of files) req.attach('files', bytes, name);
    return req;
  };

  it('detects the format and unit, asks for the company, and writes nothing', async () => {
    const res = await post('/api/v1/conversions/preview').expect(200);
    const preview = ConversionPreviewSchema.parse(res.body);
    expect(preview.files).toEqual([
      expect.objectContaining({
        name: RAW_NAME,
        format: 'wialon',
        formatDetected: true,
        unit: '22',
        unitDetected: true,
        company: null,
        needs: ['company'],
        error: null,
      }),
    ]);
    expect(preview.ready).toBe(false);
    expect(preview.trips).toEqual([]);
    expect(fs.readdirSync(OUTPUT)).toEqual([]);
  });

  it('asks for the format and unit when it can’t detect them', async () => {
    const xlsx: [Buffer, string][] = [[Buffer.from('PK\u0003\u0004 not really'), 'swift.xlsx']];
    const unknown = await post('/api/v1/conversions/preview', [{ company: COMPANY }], xlsx);
    expect(unknown.body.files[0]).toMatchObject({ format: null, needs: ['format'] });

    const picked = await post(
      '/api/v1/conversions/preview',
      [{ format: 'swift', company: COMPANY }],
      xlsx,
    ).expect(200);
    expect(picked.body.files[0]).toMatchObject({ format: 'swift', formatDetected: false });
    expect(picked.body.files[0].error).toMatch(/swift\.xlsx: can't be read \(not an Excel 97–2003/);

    const renamed = await post(
      '/api/v1/conversions/preview',
      [{ company: COMPANY }],
      [[RAW.bytes, 'october.csv']],
    ).expect(200);
    expect(renamed.body.files[0]).toMatchObject({ format: 'wialon', unit: null, needs: ['unit'] });
  });

  it('refuses to convert until every file is ready, saying what is missing', async () => {
    const res = await post('/api/v1/conversions').expect(400);
    expect(res.body.message).toContain(`${RAW_NAME}: enter the company name`);
    expect(fs.readdirSync(OUTPUT)).toEqual([]);
  });

  it('converts, names the file by company + unit, records them, and never overwrites', async () => {
    const first = await post('/api/v1/conversions', [{ company: COMPANY }]).expect(201);
    const result = ConversionResultSchema.parse(first.body);
    expect(result.outputs).toEqual([
      expect.objectContaining({
        name: 'ACME-TRUCKING-LLC_unit-22_2026-10.csv',
        company: COMPANY,
        units: ['22'],
      }),
    ]);
    expect(result.outputDir).toBe('./output');
    // Without an odometer the file matches the expected ProMiles file byte for byte.
    expect(fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8')).toBe(EXPECTED);
    expect(await companies.list()).toEqual({ companies: [{ name: COMPANY, units: ['22'] }] });

    // A differently-typed company name snaps to the saved spelling.
    const second = await post(
      '/api/v1/conversions',
      [{ company: 'acme trucking  llc' }],
      undefined,
      { [truckKey(COMPANY, '22')]: '184,310' },
    ).expect(201);
    expect(second.body.outputs[0].name).toBe('ACME-TRUCKING-LLC_unit-22_2026-10_2.csv');
    expect(second.body.trips[0]).toMatchObject({ company: COMPANY, beginOdo: '184310' });

    // Each conversion is logged: the first with the placeholder (no odometer known), the
    // second from the typed reading to where it ends.
    const miles = second.body.trips[0].totalDistance;
    expect(history.records.slice(-2)).toEqual([
      expect.objectContaining({
        company: COMPANY,
        unit: '22',
        origin: 'portal',
        source: 'wialon',
        sourceFile: RAW_NAME,
        outputFile: 'ACME-TRUCKING-LLC_unit-22_2026-10.csv',
        distanceUnit: 'M',
        trips: [expect.objectContaining({ beginOdo: null, endOdo: null, distance: miles })],
      }),
      expect.objectContaining({
        outputFile: 'ACME-TRUCKING-LLC_unit-22_2026-10_2.csv',
        trips: [
          {
            beginDate: '2026-10-01',
            endDate: '2026-10-31',
            beginOdo: '184310',
            endOdo: String(184310 + miles),
            distance: miles,
            states: second.body.trips[0].states,
          },
        ],
      }),
    ]);
  });

  it('matches a file with no company to the one saved company running its unit #', async () => {
    const res = await post('/api/v1/conversions/preview').expect(200);
    expect(res.body.files[0]).toMatchObject({
      format: 'wialon',
      company: COMPANY,
      companyOrigin: 'unit',
      companyOptions: [],
      unit: '22',
      needs: [],
    });
    // A typed company still wins.
    const typed = await post('/api/v1/conversions/preview', [{ company: 'NEW CO' }]).expect(200);
    expect(typed.body.files[0]).toMatchObject({ company: 'NEW CO', companyOrigin: 'user' });
  });

  it('saves where a truck’s odometer ends and starts its next month there', async () => {
    const company = 'ODO TEST LLC';
    const report = (no: string, name: string, from: string, to: string) =>
      wialonReport(
        [month(no, name, '120 mi', from, to), state(`${no}.1`, 'Texas', '120 mi', from)],
        '7',
      );
    const october = report('1', 'October', '2026-10-01 00:00:00', '2026-10-31 23:59:59');
    const november = report('1', 'November', '2026-11-01 00:00:00', '2026-11-30 23:59:59');

    await post('/api/v1/conversions', [{ company }], [[october.bytes, october.name]], {
      [truckKey(company, '7')]: '1000',
    }).expect(201);

    const preview = ConversionPreviewSchema.parse(
      (
        await post(
          '/api/v1/conversions/preview',
          [{ company }],
          [[november.bytes, november.name]],
        ).expect(200)
      ).body,
    );
    expect(preview.savedOdometers).toEqual({
      [truckKey(company, '7')]: { reading: '1120', asOf: '10/31/2026' },
    });
    expect(preview.trips[0]).toMatchObject({ beginOdo: '1120', beginOdoIsPlaceholder: false });
  });

  it('holds a file from a source other than the company’s approved one until confirmed', async () => {
    const company = 'SWITCH TEST LLC';
    // As if its earlier files had come from Ezlogz.
    companies.saved.set(companyKey(company), {
      name: company,
      units: new Set(['22']),
      source: 'ezlogz',
    });

    const held = await post('/api/v1/conversions/preview', [{ company }]).expect(200);
    const preview = ConversionPreviewSchema.parse(held.body);
    expect(preview.ready).toBe(false);
    expect(preview.files[0]).toMatchObject({
      format: 'wialon',
      needs: ['source'],
      knownSource: 'ezlogz',
    });
    const refused = await post('/api/v1/conversions', [{ company }]).expect(400);
    expect(refused.body.message).toContain(
      "confirm converting it from a source other than the company's approved one",
    );

    await post('/api/v1/conversions', [{ company, confirmSource: true }]).expect(201);
    // Wialon replaces Ezlogz as the one approved source.
    expect(companies.saved.get(companyKey(company))!.source).toBe('wialon');

    // Approved now: the next Wialon file for the company goes straight through.
    const next = await post('/api/v1/conversions/preview', [{ company }]).expect(200);
    expect(next.body).toMatchObject({
      ready: true,
      files: [expect.objectContaining({ needs: [] })],
    });

    // Unit 22 is now saved under two companies: a file with no company asks which.
    const ambiguous = await post('/api/v1/conversions/preview').expect(200);
    expect(ambiguous.body.files[0]).toMatchObject({
      company: null,
      companyOrigin: null,
      companyOptions: [COMPANY, company],
      needs: ['company'],
    });
  });

  it('converts a Motive distance summary once the user gives the period it covers', async () => {
    const company = 'SUMMARY TEST LLC';
    const name = '1794000000-distance_summary_by_vehicle.csv';
    const file: [Buffer, string][] = [[fixture(name), name]];
    const held = await post('/api/v1/conversions/preview', [{ company }], file).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: 'motive',
      units: ['12', 'Volvo 9'],
      period: null,
      // Exported on Nov 6, 2026: most likely October.
      suggestedPeriod: { begin: '2026-10-01', end: '2026-10-31' },
      needs: ['period'],
    });
    const refused = await post('/api/v1/conversions', [{ company }], file).expect(400);
    expect(refused.body.message).toContain(`${name}: enter the dates it covers`);

    const period = { begin: '2026-10-01', end: '2026-10-31' };
    const res = await post('/api/v1/conversions', [{ company, period }], file).expect(201);
    const result = ConversionResultSchema.parse(res.body);
    expect(result.files[0]).toMatchObject({ period, needs: [] });
    expect(result.outputs.map((o) => o.name)).toEqual([
      'SUMMARY-TEST-LLC_units-12-Volvo-9_2026-10.csv',
    ]);
    expect(fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8')).toBe(
      fixture('promiles_expected_motive_summary_2trucks_oct2026.csv').toString('utf8'),
    );
    expect(history.records.slice(-2).map((r) => [r.unit, r.source, r.trips])).toEqual([
      ['12', 'motive', [octoberTrip(4872, 'ID,MT,WA')]],
      ['Volvo 9', 'motive', [octoberTrip(2012, 'OR,TX,UT')]],
    ]);

    const quarter = { begin: '2026-09-01', end: '2026-10-31' };
    const bad = await post('/api/v1/conversions/preview', [{ company, period: quarter }], file);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/sources\[0\.period\.end\]: The period must stay inside one/);
  });

  it('converts an IFTA Mileage By State export with company and unit from the file', async () => {
    const name = 'Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv';
    const file: [Buffer, string][] = [[fixture(name), name]];
    // Bellfam ELD and HOS 247 export this exact layout, and ACME's approved source is Wialon:
    // nothing says which, so the user picks.
    const held = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: null,
      formatOptions: ['bellamsp-anir', 'hos247', 'quick-e-logs'],
      company: 'ACME TRUCKING LLC',
      needs: ['format'],
    });

    // Picked; and as ACME was converted from Wialon before, the new source is confirmed too.
    const choice = [{ format: 'bellamsp-anir' as const, confirmSource: true }];
    const res = await post('/api/v1/conversions', choice, file).expect(201);
    const result = ConversionResultSchema.parse(res.body);
    expect(result.files[0]).toMatchObject({
      format: 'bellamsp-anir',
      formatDetected: false,
      company: 'ACME TRUCKING LLC',
      companyOrigin: 'file',
      unit: '7',
      unitDetected: true,
      needs: [],
    });
    expect(result.outputs.map((o) => o.name)).toEqual(['ACME-TRUCKING-LLC_unit-7_2026-10.csv']);
    expect(fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8')).toBe(
      fixture('promiles_expected_ifta_by_state_unit7_oct2026.csv').toString('utf8'),
    );

    // From now on ACME's files in this layout are Bellfam ELD without asking.
    const next = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(next.body.files[0]).toMatchObject({
      format: 'bellamsp-anir',
      formatDetected: true,
      formatOptions: [],
      needs: [],
    });
  });

  it('approves Quick E Logs, remembers the choice, and holds a switch to Forza', async () => {
    const name = 'Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv';
    const files: [Buffer, string][] = [[fixture(name), name]];
    const company = 'QUICK TEST LLC';
    await post('/api/v1/conversions', [{ company, format: 'quick-e-logs' }], files).expect(201);
    const next = await post('/api/v1/conversions/preview', [{ company }], files).expect(200);
    expect(next.body.files[0]).toMatchObject({
      format: 'quick-e-logs',
      formatOptions: [],
      needs: [],
    });
    const forza: [Buffer, string][] = [[fixture('forza_ifta.csv'), 'random.csv']];
    const choice = { company, promilesUnits: { '07': '07' } };
    const held = await post('/api/v1/conversions/preview', [choice], forza).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: 'forza-eld',
      unit: '07',
      needs: ['source'],
      knownSource: 'quick-e-logs',
    });
    const res = await post(
      '/api/v1/conversions',
      [{ ...choice, confirmSource: true }],
      forza,
    ).expect(201);
    expect(fs.readFileSync(path.join(OUTPUT, res.body.outputs[0].name), 'utf8')).toBe(
      fixture('promiles_expected_forza_oct2026.csv').toString(),
    );
    expect(history.records.at(-1)).toMatchObject({ source: 'forza-eld', unit: '07' });
  });

  it('holds Big Road for company and period, then saves each truck separately', async () => {
    const file = bigRoadReport({
      rows: [
        ['007', 100, 0, 100],
        ['008', 0, 200, 200],
      ],
    });
    const files: [Buffer, string][] = [[file.bytes, file.name]];
    const held = await post('/api/v1/conversions/preview', [], files).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: 'big-road',
      units: ['007', '008'],
      needs: expect.arrayContaining(['company', 'period']),
      suggestedPeriod: null,
    });
    const choice = {
      company: 'BIG ROAD TEST LLC',
      period: { begin: '2026-10-01', end: '2026-10-31' },
      promilesUnits: { '007': '107', '008': '108' },
      unit: 'ignored',
    };
    const res = await post('/api/v1/conversions', [choice], files).expect(201);
    const result = ConversionResultSchema.parse(res.body);
    expect(result.files[0]).toMatchObject({
      period: choice.period,
      needs: [],
      units: ['007', '008'],
    });
    expect(history.records.slice(-2).map((r) => [r.unit, r.source, r.trips])).toEqual([
      ['007', 'big-road', [octoberTrip(100, 'OR')]],
      ['008', 'big-road', [octoberTrip(200, 'WA')]],
    ]);
    expect(result.outputs[0].units).toEqual(['007', '008']);
    const csv = fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8');
    expect(csv).toContain('\n107,10/1/2026,10/31/2026,1,D,M,OR,100,');
    expect(csv).toContain('\n108,10/1/2026,10/31/2026,1,D,M,WA,200,');
  });

  it('converts a Motive file holding two trucks, each with its own unit # and odometer', async () => {
    const name = '1794000000-trip_reports_detail_by_vehicle.csv';
    const file: [Buffer, string][] = [[fixture(name), name]];
    const held = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: 'motive',
      formatDetected: true,
      unit: null,
      units: ['Volvo 7', '31'],
      unitDetected: true,
      needs: ['company'],
    });

    // A unit # typed for a multi-truck file can't apply to either truck, so it's ignored. (ACME
    // was converted from other sources before, so Motive is confirmed as a new one.)
    const choice = [{ company: COMPANY, unit: '99', confirmSource: true }];
    const res = await post('/api/v1/conversions', choice, file).expect(201);
    const result = ConversionResultSchema.parse(res.body);
    expect(result.trips.map((t) => [t.unit, t.beginOdo, t.fileOdometer])).toEqual([
      ['Volvo 7', '431000', { begin: '431000', end: '432160' }],
      ['31', '1205330', { begin: '1205330', end: '1206148' }],
    ]);
    expect(result.outputs.map((o) => [o.name, o.units])).toEqual([
      ['ACME-TRUCKING-LLC_units-Volvo-7-31_2026-10.csv', ['Volvo 7', '31']],
    ]);
    expect(fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8')).toBe(
      fixture('promiles_expected_motive_2trucks_oct2026.csv').toString('utf8'),
    );
    // Each truck's end reading is saved for its next conversion: the file's Odometer End.
    expect(companies.odometers.get(truckKey(COMPANY, '31'))?.reading).toBe(1206148);
  });

  it('converts a Swift ELD / Vista ELD workbook once the user says which it is', async () => {
    const report = iftaReport({ trucks: IFTA_REPORT_SAMPLE, company: 'VISTA TEST LLC' });
    const file: [Buffer, string][] = [[report.bytes, report.name]];
    // Both export this exact workbook, and the company is new: nothing says which.
    const held = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: null,
      formatOptions: ['swift', 'vista-eld'],
      company: 'VISTA TEST LLC',
      companyOrigin: 'file',
      unit: '0412',
      needs: ['format'],
    });

    const res = await post('/api/v1/conversions', [{ format: 'vista-eld' }], file).expect(201);
    const result = ConversionResultSchema.parse(res.body);
    expect(result.outputs.map((o) => o.name)).toEqual(['VISTA-TEST-LLC_unit-0412_2026-10.csv']);
    expect(fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8')).toBe(
      fixture('promiles_expected_ifta_report_unit0412_oct2026.csv').toString('utf8'),
    );
    expect(history.records.at(-1)).toMatchObject({ unit: '0412', source: 'vista-eld' });

    // Vista ELD is the company's approved source now: its next workbook needs nothing.
    const next = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(next.body.files[0]).toMatchObject({
      format: 'vista-eld',
      formatDetected: true,
      needs: [],
    });
  });

  it('writes one file per company and lets the user override the unit #', async () => {
    const res = await post(
      '/api/v1/conversions',
      // (ACME's approved source is Motive by now, so Wialon is confirmed as its new one.)
      [
        { company: 'XYZ FREIGHT LLC', unit: '1022' },
        { company: COMPANY, confirmSource: true },
      ],
      [
        [RAW.bytes, RAW_NAME],
        [RAW.bytes, RAW_NAME.replace('22_', '25_')],
      ],
    ).expect(201);
    expect(res.body.outputs.map((o: { name: string }) => o.name)).toEqual([
      'XYZ-FREIGHT-LLC_unit-1022_2026-10.csv',
      'ACME-TRUCKING-LLC_unit-25_2026-10.csv',
    ]);
  });

  it('asks for a new truck’s ProMiles unit #, then writes it and names the file by both', async () => {
    const company = 'NEW HAUL LLC';
    const files: [Buffer, string][] = [[RAW.bytes, RAW_NAME]];
    const res = await post('/api/v1/conversions/preview', [{ company }], files, undefined, false);
    const preview = ConversionPreviewSchema.parse(res.body);
    expect(preview.ready).toBe(false);
    expect(preview.files[0]).toMatchObject({
      unit: '22',
      needs: ['promilesUnit'],
      newTrucks: ['22'],
      promilesUnits: { '22': '22' }, // offered as its own number
    });
    await post('/api/v1/conversions', [{ company }], files, undefined, false).expect(400);

    const saved = await post(
      '/api/v1/conversions',
      [{ company, promilesUnits: { '22': '9022' } }],
      files,
      undefined,
      false,
    ).expect(201);
    const result = ConversionResultSchema.parse(saved.body);
    expect(result.outputs.map((o) => o.name)).toEqual([
      'NEW-HAUL-LLC_unit-9022_from-22_2026-10.csv',
    ]);
    expect(result.trips[0]).toMatchObject({ unit: '22', promilesUnit: '9022' });
    const csv = fs.readFileSync(path.join(OUTPUT, result.outputs[0].name), 'utf8');
    expect(csv.split('\n')[2].split(',')[0]).toBe('9022');
    expect(history.records.at(-1)).toMatchObject({ unit: '22', promilesUnit: '9022' });

    // Saved on the truck: the next file needs nothing more.
    const again = await post('/api/v1/conversions/preview', [{ company }], files, undefined, false);
    expect(again.body.files[0]).toMatchObject({ needs: [], promilesUnits: { '22': '9022' } });
  });

  it('reports cross-file problems in the preview instead of failing', async () => {
    const res = await post(
      '/api/v1/conversions/preview',
      [
        { company: COMPANY, confirmSource: true },
        { company: COMPANY, confirmSource: true },
      ],
      [
        [RAW.bytes, RAW_NAME],
        [RAW.bytes, RAW_NAME.replace('05-16-23', '06-00-00')],
      ],
    ).expect(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.errors).toEqual([expect.stringMatching(/2026-10 is in more than one file/)]);
  });

  it('lists and downloads converted files', async () => {
    const list = OutputListSchema.parse(
      (await request(server()).get('/api/v1/outputs').expect(200)).body,
    );
    expect(list.files.map((f) => f.name)).toContain('ACME-TRUCKING-LLC_unit-22_2026-10.csv');

    const res = await request(server())
      .get('/api/v1/outputs/ACME-TRUCKING-LLC_unit-22_2026-10.csv')
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="ACME-TRUCKING-LLC_unit-22_2026-10.csv"',
    );
    expect(res.text).toBe(EXPECTED);
  });

  it.each(['..%2F..%2Fetc%2Fpasswd', '.env', 'missing.csv', 'notes.txt'])(
    'refuses to serve %s',
    async (name) => {
      await request(server()).get(`/api/v1/outputs/${name}`).expect(404);
    },
  );

  it('rejects bad requests with a reason', async () => {
    const none = await request(server()).post('/api/v1/conversions').expect(400);
    expect(none.body.message).toMatch(/at least one/);

    const txt = await post('/api/v1/conversions/preview', [], [[RAW.bytes, 'export.txt']]);
    expect(txt.status).toBe(400);
    expect(txt.body.message).toMatch(/only \.csv, \.xlsx, \.xls/);

    const format = await post('/api/v1/conversions/preview', [{ format: 'samsara' } as never]);
    expect(format.status).toBe(400);
    expect(format.body.message).toMatch(/sources\[0\.format\]/);

    const odo = await post('/api/v1/conversions/preview', [{ company: COMPANY }], undefined, {
      [truckKey(COMPANY, '22')]: 'abc',
    });
    expect(odo.status).toBe(400);
    expect(odo.body.message).toMatch(
      /odometers\[acme trucking llc unit 22\]: Odometer must be a number/,
    );
  });
});
