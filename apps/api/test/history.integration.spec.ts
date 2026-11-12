import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HistoryListSchema, TruckDetailSchema } from '@haulbook/shared';
import { configureApp } from '../src/app.setup';
import { CompaniesModule } from '../src/companies/companies.module';
import { CompaniesService } from '../src/companies/companies.service';
import { HistoryModule } from '../src/history/history.module';
import { HistoryService, type HistoryRecord } from '../src/history/history.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The conversion history against a real Postgres 18 (DATABASE_URL_TEST). Self-skips when no
 * test DB is configured.
 */
const describeDb = process.env.DATABASE_URL_TEST ? describe : describe.skip;

/** One converted report for a truck: two months, the first with a known odometer. */
const report = (company: string, unit: string, outputFile: string): HistoryRecord => ({
  company,
  unit,
  promilesUnit: unit,
  origin: 'portal',
  source: 'wialon',
  sourceFile: `${unit}_IFTA_Single_Unit_Mileage_Report.csv`,
  outputFile,
  distanceUnit: 'M',
  trips: [
    {
      beginDate: '2026-10-01',
      endDate: '2026-10-31',
      beginOdo: '1000',
      endOdo: '1120.5',
      distance: 120.5,
      states: ['TX', 'OK'],
    },
    {
      beginDate: '2026-11-01',
      endDate: '2026-11-30',
      beginOdo: '1120.5',
      endOdo: '1200.5',
      distance: 80,
      states: ['OK', 'KS'],
    },
  ],
});

describeDb('History (Postgres integration)', () => {
  let app: INestApplication;
  let companies: CompaniesService;
  let history: HistoryService;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CompaniesModule, HistoryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    companies = moduleRef.get(CompaniesService);
    history = moduleRef.get(HistoryService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.conversion.deleteMany();
    await prisma.company.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs each report with its date range, odometers and miles, newest first', async () => {
    await companies.record([{ company: 'ACME TRUCKING LLC', units: ['22'] }]);
    await history.record([report('acme trucking llc', '22', 'ACME_unit-22.csv')]);
    await history.record([report('ACME TRUCKING LLC', '22', 'ACME_unit-22_2.csv')]);

    const res = await http().get('/api/v1/history').expect(200);
    const list = HistoryListSchema.parse(res.body);
    expect(list.more).toBe(false);
    expect(list.entries.map((e) => e.outputFile)).toEqual([
      'ACME_unit-22_2.csv',
      'ACME_unit-22.csv',
    ]);
    const [{ companyId, truckId }] = (await companies.list()).companies.map((c) => ({
      companyId: c.id,
      truckId: c.trucks[0].id,
    }));
    expect(list.entries[1]).toMatchObject({
      company: 'ACME TRUCKING LLC', // the saved spelling
      companyId,
      unit: '22',
      truckId,
      origin: 'portal',
      source: 'wialon',
      beginDate: '2026-10-01',
      endDate: '2026-11-30',
      beginOdo: '1000',
      endOdo: '1200.5',
      distance: 200.5,
      distanceUnit: 'M',
      states: ['TX', 'OK', 'KS'],
    });
    expect(list.entries[1].trips).toHaveLength(2);

    const limited = HistoryListSchema.parse((await http().get('/api/v1/history?limit=1')).body);
    expect(limited).toMatchObject({ more: true, entries: [{ outputFile: 'ACME_unit-22_2.csv' }] });
    await http().get('/api/v1/history?limit=0').expect(400);
  });

  it('shows one truck with its company and history, and filters by truck', async () => {
    await companies.record([
      { company: 'ACME', units: ['22', '25'], source: 'motive' },
      { company: 'XYZ', units: ['22'] },
    ]);
    await history.record([
      report('ACME', '22', 'a.csv'),
      report('ACME', '25', 'b.csv'),
      report('XYZ', '22', 'c.csv'),
    ]);
    const acme = (await companies.list()).companies.find((c) => c.name === 'ACME')!;
    const truck = acme.trucks.find((t) => t.unit === '22')!;

    const res = await http().get(`/api/v1/trucks/${truck.id}`).expect(200);
    const detail = TruckDetailSchema.parse(res.body);
    expect(detail.company).toEqual({ id: acme.id, name: 'ACME', source: 'motive' });
    expect(detail.truck).toMatchObject({ id: truck.id, unit: '22' });
    expect(detail.history.map((h) => h.outputFile)).toEqual(['a.csv']);

    const byTruck = await http().get(`/api/v1/history?truckId=${truck.id}`).expect(200);
    expect(byTruck.body.entries.map((e: { outputFile: string }) => e.outputFile)).toEqual([
      'a.csv',
    ]);
    const byCompany = await http().get(`/api/v1/history?companyId=${acme.id}`).expect(200);
    expect(byCompany.body.entries).toHaveLength(2);
    await http().get('/api/v1/trucks/nope').expect(404);
  });

  it('keeps the history linked through a merge, and keeps the names once deleted', async () => {
    await companies.record([
      { company: 'ACME TRUCKING LLC', units: ['22'] },
      { company: 'Acme Trucking', units: ['22'] },
    ]);
    await history.record([report('Acme Trucking', '22', 'old.csv')]);
    const [short, long] = (await companies.list()).companies;
    await companies.merge(short.id, long.id);

    const [entry] = (await history.list({ limit: 10 })).entries;
    const kept = await companies.get(long.id);
    expect(entry).toMatchObject({
      company: 'Acme Trucking', // as written at the time
      companyId: long.id,
      truckId: kept.trucks[0].id,
    });

    await companies.remove(long.id);
    expect((await history.list({ limit: 10 })).entries[0]).toMatchObject({
      company: 'Acme Trucking',
      companyId: null,
      truckId: null,
    });
  });
});
