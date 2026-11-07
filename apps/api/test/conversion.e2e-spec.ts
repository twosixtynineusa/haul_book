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
import { RAW, RAW_NAME, fixture, month, state, wialonReport } from './helpers/wialon-report';

const OUTPUT = process.env.OUTPUT_PATH as string;
const EXPECTED = fixture('promiles_expected_unit22_oct2026.csv').toString('utf8');
const COMPANY = 'ACME TRUCKING LLC';

/** In-memory stand-in for the Postgres-backed list (that one has its own integration spec). */
class FakeCompanies {
  saved = new Map<string, { name: string; units: Set<string>; sources: Set<string> }>();
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
    const known = names.filter((n) => this.saved.has(companyKey(n)));
    return new Map(known.map((n) => [companyKey(n), [...this.saved.get(companyKey(n))!.sources]]));
  }
  odometers = new Map<string, SavedReading>();
  async savedOdometers() {
    return this.odometers;
  }
  async record(entries: RecordEntry[]) {
    for (const { company, units, odometers = [], sources = [] } of entries) {
      const c = this.saved.get(companyKey(company)) ?? {
        name: company,
        units: new Set<string>(),
        sources: new Set<string>(),
      };
      units.forEach((u) => c.units.add(u));
      sources.forEach((s) => c.sources.add(s));
      this.saved.set(companyKey(company), c);
      for (const { unit, ...reading } of odometers) {
        this.odometers.set(truckKey(company, unit), reading);
      }
    }
  }
}

describe('Conversions (e2e)', () => {
  let app: INestApplication;
  const companies = new FakeCompanies();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConversionModule] })
      .overrideProvider(CompaniesService)
      .useValue(companies)
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
  const post = (
    url: string,
    sources: SourceChoice[] = [],
    files: [Buffer, string][] = [[RAW.bytes, RAW_NAME]],
    odometers?: Record<string, string>,
  ) => {
    const req = request(server()).post(url).field('sources', JSON.stringify(sources));
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
    const xlsx: [Buffer, string][] = [[Buffer.from('PK\u0003\u0004 not really'), 'motive.xlsx']];
    const unknown = await post('/api/v1/conversions/preview', [{ company: COMPANY }], xlsx);
    expect(unknown.body.files[0]).toMatchObject({ format: null, needs: ['format'] });

    const picked = await post(
      '/api/v1/conversions/preview',
      [{ format: 'motive', company: COMPANY }],
      xlsx,
    ).expect(200);
    expect(picked.body.files[0]).toMatchObject({ format: 'motive', formatDetected: false });
    expect(picked.body.files[0].error).toMatch(/Motive files can't be converted yet/);

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

  it('holds a known company’s file from a new source until the user confirms it', async () => {
    const company = 'SWITCH TEST LLC';
    // As if its earlier files had all come from Ezlogz.
    companies.saved.set(companyKey(company), {
      name: company,
      units: new Set(['22']),
      sources: new Set(['ezlogz']),
    });

    const held = await post('/api/v1/conversions/preview', [{ company }]).expect(200);
    const preview = ConversionPreviewSchema.parse(held.body);
    expect(preview.ready).toBe(false);
    expect(preview.files[0]).toMatchObject({
      format: 'wialon',
      needs: ['source'],
      knownSources: ['ezlogz'],
    });
    const refused = await post('/api/v1/conversions', [{ company }]).expect(400);
    expect(refused.body.message).toContain(
      'confirm converting it from a source new for this company',
    );

    await post('/api/v1/conversions', [{ company, confirmSource: true }]).expect(201);
    expect([...companies.saved.get(companyKey(company))!.sources]).toEqual(['ezlogz', 'wialon']);

    // Approved now: the next Wialon file for the company goes straight through.
    const next = await post('/api/v1/conversions/preview', [{ company }]).expect(200);
    expect(next.body).toMatchObject({
      ready: true,
      files: [expect.objectContaining({ needs: [] })],
    });
  });

  it('converts an IFTA Mileage By State export with company and unit from the file', async () => {
    const name = 'Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv';
    const file: [Buffer, string][] = [[fixture(name), name]];
    // Bellfam ELD and HOS247 export this exact layout, and ACME has only used Wialon:
    // nothing says which, so the user picks.
    const held = await post('/api/v1/conversions/preview', [], file).expect(200);
    expect(held.body.files[0]).toMatchObject({
      format: null,
      formatOptions: ['bellamsp-anir', 'hos247'],
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
      companyDetected: true,
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

  it('writes one file per company and lets the user override the unit #', async () => {
    const res = await post(
      '/api/v1/conversions',
      [{ company: 'XYZ FREIGHT LLC', unit: '1022' }, { company: COMPANY }],
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

  it('reports cross-file problems in the preview instead of failing', async () => {
    const res = await post(
      '/api/v1/conversions/preview',
      [{ company: COMPANY }, { company: COMPANY }],
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
