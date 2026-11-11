import * as fs from 'node:fs';
import * as path from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InboxListSchema } from '@haulbook/shared';
import { configureApp } from '../src/app.setup';
import { CompaniesService } from '../src/companies/companies.service';
import { InboxHttpModule } from '../src/inbox/inbox.controller';
import { InboxService } from '../src/inbox/inbox.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { INBOX_QUEUE } from '../src/queue/queue.module';
import { RAW, RAW_NAME, fixture } from './helpers/wialon-report';

/**
 * The watched input folder end to end against a real Postgres 18
 * (DATABASE_URL_TEST) and real temp input/output folders (test/setup-env.ts).
 * Self-skips when no test DB is configured.
 */
const describeDb = process.env.DATABASE_URL_TEST ? describe : describe.skip;

const INPUT = process.env.INPUT_PATH as string;
const OUTPUT = process.env.OUTPUT_PATH as string;
const EXPECTED = fixture('promiles_expected_unit22_oct2026.csv').toString('utf8');
const COMPANY = 'ACME TRUCKING LLC';
const TODAY = new Date().toISOString().slice(0, 10);

function drop(rel: string, bytes: Buffer = RAW.bytes): void {
  fs.mkdirSync(path.dirname(path.join(INPUT, rel)), { recursive: true });
  fs.writeFileSync(path.join(INPUT, rel), bytes);
}

function clear(dir: string): void {
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true });
}

describeDb('Inbox — watched input folder (Postgres integration)', () => {
  let app: INestApplication;
  let inbox: InboxService;
  let companies: CompaniesService;
  let prisma: PrismaService;
  const queue = { add: jest.fn() };

  /** Two scans: the first notes the file, the second converts it once it's unchanged. */
  const settle = async () => {
    await inbox.scan();
    return inbox.scan();
  };
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, InboxHttpModule] })
      .overrideProvider(getQueueToken(INBOX_QUEUE))
      .useValue(queue)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    inbox = moduleRef.get(InboxService);
    companies = moduleRef.get(CompaniesService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.inboxFile.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.company.deleteMany();
    clear(INPUT);
    clear(OUTPUT);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(INPUT, { recursive: true, force: true });
    fs.rmSync(OUTPUT, { recursive: true, force: true });
  });

  it('converts a report dropped in a company sub-folder and archives the source', async () => {
    drop(`${COMPANY}/${RAW_NAME}`);

    expect(await inbox.scan()).toMatchObject({ found: 1, converted: 0 }); // first sighting
    expect(await inbox.scan()).toMatchObject({ converted: 1 });

    const output = 'ACME-TRUCKING-LLC_unit-22_2026-10.csv';
    expect(fs.readFileSync(path.join(OUTPUT, output), 'utf8')).toBe(EXPECTED);
    expect(fs.existsSync(path.join(INPUT, COMPANY, RAW_NAME))).toBe(false);
    const archived = `archive/${TODAY}/${COMPANY}/${RAW_NAME}`;
    expect(fs.existsSync(path.join(INPUT, archived))).toBe(true);

    const list = InboxListSchema.parse((await request(server()).get('/api/v1/inbox')).body);
    expect(list.pending).toEqual([]);
    expect(list.recent).toEqual([
      expect.objectContaining({
        status: 'converted',
        company: COMPANY,
        unit: '22',
        format: 'wialon',
        outputs: [output],
        archivedPath: archived,
      }),
    ]);
    // Added to the company list on its own, with Wialon approved and the truck's activity.
    const [saved] = (await companies.list()).companies;
    expect(saved).toMatchObject({ name: COMPANY, source: 'wialon' });
    expect(saved.trucks).toEqual([
      expect.objectContaining({ unit: '22', lastSource: 'wialon', lastPeriodEnd: '2026-10-31' }),
    ]);
    // And logged in the history, linked to the company and truck.
    const logged = await prisma.conversion.findMany();
    expect(logged).toEqual([
      expect.objectContaining({
        companyId: saved.id,
        unitId: saved.trucks[0].id,
        companyName: COMPANY,
        unitNumber: '22',
        origin: 'inbox',
        source: 'wialon',
        sourceFile: RAW_NAME,
        outputFile: output,
        beginOdo: null,
      }),
    ]);
  });

  it('starts a truck at its saved odometer and saves where it ends', async () => {
    const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
    await companies.record([
      {
        company: COMPANY,
        units: ['22'],
        odometers: [{ unit: '22', reading: 5000, asOf: day(9, 30) }],
      },
    ]);
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 1 });

    const csv = fs.readFileSync(path.join(OUTPUT, fs.readdirSync(OUTPUT)[0]), 'utf8');
    expect(csv.split('\n')[2].split(',')[3]).toBe('5000');
    const saved = await companies.savedOdometers([{ company: COMPANY, unit: '22' }]);
    expect([...saved.values()]).toEqual([{ reading: 8618, asOf: day(10, 31) }]);
  });

  it('holds a file from another source until confirmed, which replaces the approved one', async () => {
    // Its approved source is Ezlogz; this one is a Wialon export.
    await companies.record([{ company: COMPANY, units: ['22'], source: 'ezlogz' }]);
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ needsInput: 1, converted: 0 });

    const [held] = InboxListSchema.parse(
      (await request(server()).get('/api/v1/inbox')).body,
    ).pending;
    expect(held).toMatchObject({
      status: 'needs_input',
      company: COMPANY,
      format: 'wialon',
      needs: ['source'],
      knownSource: 'ezlogz',
    });
    expect(fs.readdirSync(OUTPUT)).toEqual([]);
    expect(await inbox.scan()).toMatchObject({ converted: 0 }); // still waiting for the user

    const res = await request(server())
      .patch(`/api/v1/inbox/${held.id}`)
      .send({ confirmSource: true })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'converted', needs: [] });
    expect(await companies.approvedSources([COMPANY])).toEqual(
      new Map([[COMPANY.toLowerCase(), 'wialon']]),
    );

    // From now on the company's Wialon files convert without asking.
    drop(
      `${COMPANY}/${RAW_NAME.replace('05-16-23', '09-00-00')}`,
      Buffer.concat([RAW.bytes, Buffer.from('\r\n')]),
    );
    expect(await settle()).toMatchObject({ converted: 1, needsInput: 0 });
  });

  it('asks which source a shared-layout file is from, then remembers it for the company', async () => {
    const name = 'Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv';
    drop(name, fixture(name));
    expect(await settle()).toMatchObject({ needsInput: 1 });

    const [held] = InboxListSchema.parse(
      (await request(server()).get('/api/v1/inbox')).body,
    ).pending;
    expect(held).toMatchObject({
      company: COMPANY, // from the file's Carrier line
      unit: '7',
      format: null,
      formatOptions: ['bellamsp-anir', 'hos247'],
      needs: ['format'],
    });

    const res = await request(server())
      .patch(`/api/v1/inbox/${held.id}`)
      .send({ format: 'hos247' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'converted', format: 'hos247', formatOptions: [] });

    // The company is HOS 247 now: its next file in this layout converts without asking.
    drop(
      name.replace('1794000000000', '1794000000001'),
      Buffer.concat([fixture(name), Buffer.from('\n')]),
    );
    expect(await settle()).toMatchObject({ converted: 1, needsInput: 0 });
    expect((await inbox.list()).recent[0]).toMatchObject({ status: 'converted', format: 'hos247' });
  });

  it('waits until a file stops changing before picking it up', async () => {
    drop(RAW_NAME, RAW.bytes.subarray(0, 100));
    await inbox.scan();
    drop(RAW_NAME); // still being copied: bigger now
    expect(await inbox.scan()).toMatchObject({ converted: 0, needsInput: 0 });
    expect((await inbox.list()).pending[0]).toMatchObject({ status: 'waiting' });
  });

  it('settles a file whose mtime has nanosecond precision', async () => {
    drop(`${COMPANY}/${RAW_NAME}`);
    const seconds = 1794031083.0530722; // as stat'd on a host ext4 bind mount
    fs.utimesSync(path.join(INPUT, COMPANY, RAW_NAME), seconds, seconds);
    await inbox.scan();
    // Stored as whole ms: a sub-ms float didn't round-trip through Postgres exactly on the
    // host bind mount, so the file looked changed on every scan and never converted.
    const [row] = await prisma.inboxFile.findMany();
    expect(row.mtimeMs).toBe(Math.trunc(fs.statSync(path.join(INPUT, row.path)).mtimeMs));
    expect(await inbox.scan()).toMatchObject({ converted: 1 });
  });

  it('asks for the company in the portal, then converts and archives on submit', async () => {
    drop(RAW_NAME);
    expect(await settle()).toMatchObject({ needsInput: 1 });

    const { pending } = await inbox.list();
    expect(pending).toEqual([
      expect.objectContaining({
        status: 'needs_input',
        unit: '22',
        company: null,
        needs: ['company'],
      }),
    ]);
    expect(fs.existsSync(path.join(INPUT, RAW_NAME))).toBe(true); // stays until resolved

    // A later scan leaves it alone — it's waiting for the user.
    expect(await inbox.scan()).toMatchObject({ needsInput: 0, converted: 0 });

    const res = await request(server())
      .patch(`/api/v1/inbox/${pending[0].id}`)
      .send({ company: COMPANY })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'converted', company: COMPANY });
    expect(fs.existsSync(path.join(INPUT, 'archive', TODAY, RAW_NAME))).toBe(true);
    expect(fs.readdirSync(OUTPUT)).toEqual(['ACME-TRUCKING-LLC_unit-22_2026-10.csv']);
  });

  it('fills in the company when exactly one saved company runs that unit #', async () => {
    await companies.record([{ company: COMPANY, units: ['22'] }]);
    drop(RAW_NAME);
    expect(await settle()).toMatchObject({ converted: 1 });
    expect((await inbox.list()).recent[0]).toMatchObject({ company: COMPANY });

    // Two companies with unit 22: ambiguous, so it asks.
    await companies.record([{ company: 'XYZ FREIGHT LLC', units: ['22'] }]);
    drop(RAW_NAME.replace('05-16-23', '07-00-00'), Buffer.concat([RAW.bytes, Buffer.from('\r\n')]));
    expect(await settle()).toMatchObject({ needsInput: 1 });
    const [held] = (await inbox.list()).pending;
    expect(held).toMatchObject({
      company: null,
      companyOptions: [COMPANY, 'XYZ FREIGHT LLC'],
      needs: ['company'],
    });
    const res = await request(server())
      .patch(`/api/v1/inbox/${held.id}`)
      .send({ company: 'XYZ FREIGHT LLC' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'converted', company: 'XYZ FREIGHT LLC' });
  });

  it('waits for the period of a Motive distance summary, offering the likely month', async () => {
    const name = '1794000000-distance_summary_by_vehicle.csv';
    drop(`${COMPANY}/${name}`, fixture(name));
    expect(await settle()).toMatchObject({ needsInput: 1 });
    const [held] = (await inbox.list()).pending;
    expect(held).toMatchObject({
      format: 'motive',
      company: COMPANY,
      units: ['12', 'Volvo 9'],
      period: null,
      suggestedPeriod: { begin: '2026-10-01', end: '2026-10-31' },
      needs: ['period'],
    });

    const period = { begin: '2026-10-01', end: '2026-10-31' };
    const res = await request(server())
      .patch(`/api/v1/inbox/${held.id}`)
      .send({ period })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'converted', period, needs: [] });
    expect(fs.readFileSync(path.join(OUTPUT, res.body.outputs[0]), 'utf8')).toBe(
      fixture('promiles_expected_motive_summary_2trucks_oct2026.csv').toString('utf8'),
    );
  });

  it('converts a Motive file holding two trucks for the one company running both', async () => {
    const name = '1794000000-trip_reports_detail_by_vehicle.csv';
    // XYZ also runs a unit 31, but only ACME runs both trucks in the file.
    await companies.record([
      { company: COMPANY, units: ['Volvo 7', '31'], source: 'motive' },
      { company: 'XYZ FREIGHT LLC', units: ['31'], source: 'motive' },
    ]);
    drop(name, fixture(name));
    expect(await settle()).toMatchObject({ converted: 1 });
    expect((await inbox.list()).recent[0]).toMatchObject({
      status: 'converted',
      format: 'motive',
      company: COMPANY,
      unit: null,
      units: ['Volvo 7', '31'],
      outputs: ['ACME-TRUCKING-LLC_units-Volvo-7-31_2026-10.csv'],
    });
  });

  it('asks for the unit # and the format when the file doesn’t carry them', async () => {
    drop('october.csv');
    drop('excel-swift-q4.xlsx', Buffer.from('PK\u0003\u0004 not really excel'));
    await settle();
    const pending = [...(await inbox.list()).pending].sort((a, b) => a.name.localeCompare(b.name));
    expect(pending.map((p) => [p.name, p.status, p.needs])).toEqual([
      ['excel-swift-q4.xlsx', 'needs_input', ['format']],
      ['october.csv', 'needs_input', ['company', 'unit']],
    ]);

    // Picking a format that can't read it fails with the reason; dismiss moves it to failed/.
    const [swift, october] = pending;
    const picked = await request(server())
      .patch(`/api/v1/inbox/${swift.id}`)
      .send({ format: 'swift' })
      .expect(200);
    expect(picked.body).toMatchObject({ status: 'failed' });
    expect(picked.body.error).toMatch(/can't be read \(not an Excel 97–2003/);

    await request(server()).post(`/api/v1/inbox/${swift.id}/dismiss`).expect(200);
    expect(fs.existsSync(path.join(INPUT, 'failed', 'excel-swift-q4.xlsx'))).toBe(true);

    const done = await request(server())
      .patch(`/api/v1/inbox/${october.id}`)
      .send({ company: COMPANY, unit: '22' })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'converted', unit: '22' });
  });

  it('archives a re-dropped identical file as a duplicate instead of converting it twice', async () => {
    drop(`${COMPANY}/${RAW_NAME}`);
    await settle();
    drop(`${COMPANY}/${RAW_NAME}`); // same bytes again
    expect(await settle()).toMatchObject({ duplicates: 1, converted: 0 });
    expect(fs.readdirSync(OUTPUT)).toHaveLength(1);
    expect(fs.readdirSync(path.join(INPUT, 'archive', TODAY, COMPANY)).sort()).toEqual([
      RAW_NAME,
      RAW_NAME.replace('.csv', '_2.csv'),
    ]);
  });

  it('converts a re-dropped file again once its company was deleted', async () => {
    drop(`${COMPANY}/${RAW_NAME}`);
    await settle();
    const [saved] = (await companies.list()).companies;
    await companies.remove(saved.id);

    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 1, duplicates: 0 });
    expect(fs.readdirSync(OUTPUT).sort()).toEqual([
      'ACME-TRUCKING-LLC_unit-22_2026-10.csv',
      'ACME-TRUCKING-LLC_unit-22_2026-10_2.csv',
    ]);
    // Converted once more: a third drop is a duplicate again.
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 0, duplicates: 1 });
  });

  it('converts a re-dropped file again once its truck was deleted, not after a merge or move', async () => {
    drop(`${COMPANY}/${RAW_NAME}`);
    await settle();
    // Merged into another spelling: the truck (and its history) live on there.
    const other = await companies.create({ name: 'ACME TRUCKING' });
    const [saved] = (await companies.list()).companies.filter((c) => c.name === COMPANY);
    const merged = await companies.merge(saved.id, other.id);
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 0, duplicates: 1 });

    // Moved to another company: still the same truck, still converted.
    const other2 = await companies.create({ name: 'X Y Z FREIGHT LLC' });
    const moved = await companies.moveTruck(merged.id, merged.trucks[0].id, other2.id);
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 0, duplicates: 1 });

    await companies.removeTruck(other2.id, moved.truckId);
    drop(`${COMPANY}/${RAW_NAME}`);
    expect(await settle()).toMatchObject({ converted: 1, duplicates: 0 });
    expect(fs.readdirSync(OUTPUT)).toHaveLength(2);
  });

  it('converts a Motive file again only for the truck deleted since', async () => {
    const name = '1794000000-trip_reports_detail_by_vehicle.csv';
    await companies.record([{ company: COMPANY, units: ['Volvo 7', '31'], source: 'motive' }]);
    drop(name, fixture(name));
    await settle();
    const [saved] = (await companies.list()).companies;
    await companies.removeTruck(saved.id, saved.trucks.find((t) => t.unit === '31')!.id);

    // Nothing else says whose truck 31 is: the company still running Volvo 7 stands in.
    drop(name, fixture(name));
    expect(await settle()).toMatchObject({ converted: 1, duplicates: 0 });
    expect((await inbox.list()).recent[0]).toMatchObject({
      status: 'converted',
      company: COMPANY,
      units: ['Volvo 7', '31'],
      outputs: ['ACME-TRUCKING-LLC_unit-31_2026-10.csv'],
    });
    const logged = await prisma.conversion.findMany();
    expect(logged.map((r) => r.unitNumber).sort()).toEqual(['31', '31', 'Volvo 7']);

    drop(name, fixture(name));
    expect(await settle()).toMatchObject({ converted: 0, duplicates: 1 });
  });

  it('forgets files taken back out, and ignores partial downloads and its own folders', async () => {
    drop(RAW_NAME);
    drop('report.csv.crdownload');
    drop('.hidden.csv');
    drop('notes.txt', Buffer.from('hi'));
    drop(`archive/${TODAY}/old.csv`);
    expect(await inbox.scan()).toMatchObject({ found: 1 });

    fs.rmSync(path.join(INPUT, RAW_NAME));
    await inbox.scan();
    expect((await inbox.list()).pending).toEqual([]);
  });

  it('queues a scan on demand and validates portal input', async () => {
    await request(server()).post('/api/v1/inbox/scan').expect(202, { queued: true });
    expect(queue.add).toHaveBeenCalledWith('scan', {}, expect.anything());

    await request(server()).patch('/api/v1/inbox/nope').send({ company: COMPANY }).expect(404);
    drop(RAW_NAME);
    await settle();
    const [file] = (await inbox.list()).pending;
    const bad = await request(server())
      .patch(`/api/v1/inbox/${file.id}`)
      .send({ unit: 'a/b' })
      .expect(400);
    expect(bad.body.message).toMatch(/unit: Unit # cannot contain/);
  });
});
