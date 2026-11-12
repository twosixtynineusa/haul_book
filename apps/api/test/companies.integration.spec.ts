import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CompanyListSchema,
  CompanySchema,
  TruckMovedSchema,
  truckKey,
  type CompanyList,
} from '@haulbook/shared';
import { configureApp } from '../src/app.setup';
import { CompaniesModule } from '../src/companies/companies.module';
import { CompaniesService } from '../src/companies/companies.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The company → unit list against a real Postgres 18 (DATABASE_URL_TEST,
 * provisioned by test/global-setup.ts). Self-skips when no test DB is configured.
 */
const describeDb = process.env.DATABASE_URL_TEST ? describe : describe.skip;

/** Name + unit #s only, in list order. */
const summary = (list: CompanyList) =>
  list.companies.map((c) => ({ name: c.name, units: c.trucks.map((t) => t.unit) }));

describeDb('Companies (Postgres integration)', () => {
  let app: INestApplication;
  let companies: CompaniesService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CompaniesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    companies = moduleRef.get(CompaniesService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.conversion.deleteMany();
    await prisma.company.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty, then fills itself from recorded conversions', async () => {
    await request(app.getHttpServer()).get('/api/v1/companies').expect(200, { companies: [] });

    await companies.record([{ company: 'X Y Z FREIGHT LLC', units: ['29-LB'] }]);
    await companies.record([{ company: 'ACME TRUCKING LLC', units: ['22', '10', '2'] }]);

    const res = await request(app.getHttpServer()).get('/api/v1/companies').expect(200);
    expect(summary(CompanyListSchema.parse(res.body))).toEqual([
      { name: 'ACME TRUCKING LLC', units: ['2', '10', '22'] },
      { name: 'X Y Z FREIGHT LLC', units: ['29-LB'] },
    ]);
  });

  it('matches companies case/spacing-insensitively and keeps the first spelling', async () => {
    await companies.record([{ company: 'Acme Trucking LLC', units: ['22'] }]);
    await companies.record([{ company: '  acme   trucking llc ', units: ['22', '25'] }]);

    expect(summary(await companies.list())).toEqual([
      { name: 'Acme Trucking LLC', units: ['22', '25'] },
    ]);
    expect(await companies.canonicalNames(['ACME TRUCKING LLC', 'Unknown Co'])).toEqual(
      new Map([['acme trucking llc', 'Acme Trucking LLC']]),
    );
  });

  it('saves each truck’s end odometer and never winds it back to an older period', async () => {
    const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
    await companies.record([
      {
        company: 'ACME',
        units: ['22', '25'],
        odometers: [{ unit: '22', reading: 13581, asOf: day(10, 31) }],
      },
    ]);
    // Re-converting September afterwards must not replace October's reading.
    await companies.record([
      {
        company: 'acme',
        units: ['22'],
        odometers: [{ unit: '22', reading: 900, asOf: day(9, 30) }],
      },
    ]);

    const saved = await companies.savedOdometers([
      { company: ' ACME ', unit: '22' },
      { company: 'ACME', unit: '25' },
    ]);
    expect(saved).toEqual(
      new Map([[truckKey('ACME', '22'), { reading: 13581, asOf: day(10, 31) }]]),
    );

    // A later period (or the same one, corrected) replaces it.
    await companies.record([
      {
        company: 'ACME',
        units: ['22'],
        odometers: [{ unit: '22', reading: 14000.5, asOf: day(10, 31) }],
      },
    ]);
    expect(
      (await companies.savedOdometers([{ company: 'ACME', unit: '22' }])).get(
        truckKey('ACME', '22'),
      ),
    ).toEqual({ reading: 14000.5, asOf: day(10, 31) });
  });

  it('keeps the same unit # under different companies apart', async () => {
    await companies.record([
      { company: 'A', units: ['22'] },
      { company: 'B', units: ['22'] },
    ]);
    expect(await prisma.unit.count()).toBe(2);
  });

  it('finds the companies running each unit #', async () => {
    await companies.record([
      { company: 'B', units: ['22', '25'] },
      { company: 'A', units: ['22'] },
    ]);
    expect(await companies.ownersOfUnits(['22', ' 25 ', '99'])).toEqual(
      new Map([
        ['22', ['A', 'B']],
        ['25', ['B']],
        ['99', []],
      ]),
    );
  });

  it('makes the format converted the approved source and records each truck’s latest activity', async () => {
    const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
    await companies.record([
      {
        company: 'ACME',
        units: ['22'],
        source: 'wialon',
        activity: [{ unit: '22', source: 'wialon', periodEnd: day(10, 31) }],
      },
    ]);
    // A confirmed switch replaces the approved source; an older period doesn't wind back the
    // truck's latest source/period.
    await companies.record([
      {
        company: 'acme',
        units: ['22'],
        source: 'ezlogz',
        activity: [{ unit: '22', source: 'ezlogz', periodEnd: day(9, 30) }],
      },
    ]);

    expect(await companies.approvedSources(['ACME', 'Nobody'])).toEqual(
      new Map([['acme', 'ezlogz']]),
    );
    const [acme] = (await companies.list()).companies;
    expect(acme.trucks[0]).toMatchObject({
      unit: '22',
      lastSource: 'wialon',
      lastPeriodEnd: '2026-10-31',
    });
    expect(acme.trucks[0].lastConvertedAt).not.toBeNull();
    expect(acme.lastConvertedAt).toBe(acme.trucks[0].lastConvertedAt);
  });

  describe('managed from the Companies tab', () => {
    const http = () => request(app.getHttpServer());
    const create = async (body: object) =>
      CompanySchema.parse((await http().post('/api/v1/companies').send(body).expect(201)).body);

    it('adds a company with its details, then edits and renames it', async () => {
      const acme = await create({ name: ' ACME  TRUCKING LLC ', dotNumber: '1234567', email: '' });
      expect(acme).toMatchObject({
        name: 'ACME TRUCKING LLC',
        dotNumber: '1234567',
        email: null,
        source: null,
        trucks: [],
      });

      const res = await http()
        .patch(`/api/v1/companies/${acme.id}`)
        .send({ name: 'Acme Trucking, LLC', phone: '555-0100', dotNumber: '' })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Acme Trucking, LLC',
        phone: '555-0100',
        dotNumber: null,
      });
      // The new spelling is what conversions now match.
      expect(await companies.canonicalNames(['acme trucking, llc'])).toEqual(
        new Map([['acme trucking, llc', 'Acme Trucking, LLC']]),
      );
    });

    it('sets one approved source: a new pick replaces the old, null clears it', async () => {
      const acme = await create({ name: 'ACME' });
      const patch = (source: string | null) =>
        http().patch(`/api/v1/companies/${acme.id}`).send({ source });
      expect((await patch('wialon').expect(200)).body.source).toBe('wialon');
      expect((await patch('motive').expect(200)).body.source).toBe('motive');
      expect(await companies.approvedSources(['acme'])).toEqual(new Map([['acme', 'motive']]));
      expect((await patch(null).expect(200)).body.source).toBeNull();
      expect(await companies.approvedSources(['acme'])).toEqual(new Map());
      await patch('nope').expect(400);
    });

    it('refuses a duplicate name or unit #, and bad input, with a reason', async () => {
      const acme = await create({ name: 'ACME' });
      await create({ name: 'XYZ' });
      const dupe = await http().post('/api/v1/companies').send({ name: 'acme' }).expect(409);
      expect(dupe.body.message).toMatch(/already exists\. Merge/);
      await http().patch(`/api/v1/companies/${acme.id}`).send({ name: 'xyz' }).expect(409);

      await http().post(`/api/v1/companies/${acme.id}/trucks`).send({ unit: '22' }).expect(201);
      await http().post(`/api/v1/companies/${acme.id}/trucks`).send({ unit: '22' }).expect(409);

      const bad = await http().post('/api/v1/companies').send({ name: 'B', email: 'nope' });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/email: Enter a valid email/);
      const half = await http()
        .post(`/api/v1/companies/${acme.id}/trucks`)
        .send({ unit: '25', odometer: '1000' });
      expect(half.status).toBe(400);
      expect(half.body.message).toMatch(/odometer and its as-of date together/);
      await http().patch('/api/v1/companies/nope').send({}).expect(404);
    });

    it('adds, edits and removes trucks; an edited odometer is what the next conversion uses', async () => {
      const acme = await create({ name: 'ACME' });
      const added = await http()
        .post(`/api/v1/companies/${acme.id}/trucks`)
        .send({ unit: ' 22 ', vin: '1XKAD49X0LJ123456', plate: 'TX 123' })
        .expect(201);
      const truck = CompanySchema.parse(added.body).trucks[0];
      expect(truck).toMatchObject({ unit: '22', vin: '1XKAD49X0LJ123456', odometer: null });

      const edited = await http()
        .patch(`/api/v1/companies/${acme.id}/trucks/${truck.id}`)
        .send({ odometer: '184,310.5', odometerAsOf: '2026-10-31', plate: '' })
        .expect(200);
      expect(edited.body.trucks[0]).toMatchObject({
        odometer: '184310.5',
        odometerAsOf: '2026-10-31',
        plate: null,
      });
      expect(await companies.savedOdometers([{ company: 'ACME', unit: '22' }])).toEqual(
        new Map([
          [truckKey('ACME', '22'), { reading: 184310.5, asOf: new Date(Date.UTC(2026, 9, 31)) }],
        ]),
      );

      const removed = await http()
        .delete(`/api/v1/companies/${acme.id}/trucks/${truck.id}`)
        .expect(200);
      expect(removed.body.trucks).toEqual([]);
    });

    it('merges two spellings: trucks move, shared units keep the later odometer', async () => {
      const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
      await companies.record([
        {
          company: 'ACME TRUCKING LLC',
          units: ['22'],
          source: 'wialon',
          odometers: [{ unit: '22', reading: 1000, asOf: day(9, 30) }],
        },
        {
          company: 'Acme Trucking',
          units: ['22', '25'],
          source: 'ezlogz',
          odometers: [{ unit: '22', reading: 2000, asOf: day(10, 31) }],
        },
      ]);
      const { companies: list } = await companies.list();
      const [short, long] = list; // "Acme Trucking" sorts first
      await prisma.company.update({ where: { id: short.id }, data: { phone: '555-0100' } });

      const res = await http()
        .post(`/api/v1/companies/${short.id}/merge`)
        .send({ into: long.id })
        .expect(200);
      const merged = CompanySchema.parse(res.body);
      expect(merged).toMatchObject({
        id: long.id,
        name: 'ACME TRUCKING LLC',
        source: 'wialon',
        phone: '555-0100',
      });
      expect(merged.trucks.map((t) => [t.unit, t.odometer])).toEqual([
        ['22', '2000'],
        ['25', null],
      ]);
      expect(summary(await companies.list())).toEqual([
        { name: 'ACME TRUCKING LLC', units: ['22', '25'] },
      ]);
      await http().post(`/api/v1/companies/${long.id}/merge`).send({ into: long.id }).expect(409);
    });

    it('edits a truck’s ProMiles unit #, and refuses one another truck already sends', async () => {
      const acme = await create({ name: 'ACME TRUCKING LLC' });
      const truckPath = (id: string) => `/api/v1/companies/${acme.id}/trucks/${id}`;
      const added = CompanySchema.parse(
        (
          await http()
            .post(`/api/v1/companies/${acme.id}/trucks`)
            .send({ unit: 'Volvo 01', promilesUnit: '2011' })
            .expect(201)
        ).body,
      );
      const volvo = added.trucks[0];
      expect(volvo).toMatchObject({ unit: 'Volvo 01', promilesUnit: '2011' });
      // Without one, it's the truck # itself.
      const two = CompanySchema.parse(
        (await http().post(`/api/v1/companies/${acme.id}/trucks`).send({ unit: '22' }).expect(201))
          .body,
      );
      const t22 = two.trucks.find((t) => t.unit === '22')!;
      expect(t22.promilesUnit).toBe('22');

      // 22 is truck 22's in ProMiles: refused, for an edit and a new truck alike.
      const taken = await http()
        .patch(truckPath(volvo.id))
        .send({ promilesUnit: '22' })
        .expect(409);
      expect(taken.body.message).toMatch(/trucks 22 and Volvo 01 .* same unit # 22/);
      await http()
        .post(`/api/v1/companies/${acme.id}/trucks`)
        .send({ unit: 'Volvo 02', promilesUnit: '2011' })
        .expect(409);

      // Blank (or the truck # itself) means the same as the truck #.
      const cleared = await http()
        .patch(truckPath(volvo.id))
        .send({ promilesUnit: '' })
        .expect(200);
      expect(cleared.body.trucks.find((t: { id: string }) => t.id === volvo.id)).toMatchObject({
        promilesUnit: 'Volvo 01',
      });
      expect((await prisma.unit.findUnique({ where: { id: volvo.id } }))!.promilesUnit).toBeNull();
    });

    describe('moving a truck to another company', () => {
      const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
      /** A history row for this truck, as a conversion would write it. */
      const logged = (companyId: string, unitId: string, unitNumber: string, outputFile: string) =>
        prisma.conversion.create({
          data: {
            companyId,
            unitId,
            companyName: 'as written',
            unitNumber,
            origin: 'portal',
            source: 'wialon',
            sourceFile: 'report.csv',
            outputFile,
            beginDate: day(10, 1),
            endDate: day(10, 31),
            distance: '100',
            distanceUnit: 'M',
            states: ['TX'],
            trips: [],
          },
        });
      const move = (id: string, truckId: string, into: string) =>
        http().post(`/api/v1/companies/${id}/trucks/${truckId}/move`).send({ into });

      it('takes its odometer, details, activity and history along', async () => {
        await companies.record([
          {
            company: 'ACME TRUCKING LLC',
            units: ['22', '25'],
            source: 'wialon',
            odometers: [{ unit: '22', reading: 13581, asOf: day(10, 31) }],
            activity: [{ unit: '22', source: 'wialon', periodEnd: day(10, 31) }],
          },
        ]);
        const xyz = await create({ name: 'X Y Z FREIGHT LLC' });
        const [acme] = (await companies.list()).companies.filter((c) => c.id !== xyz.id);
        const truck = acme.trucks.find((t) => t.unit === '22')!;
        await prisma.unit.update({ where: { id: truck.id }, data: { vin: '1XKAD49X0AJ000001' } });
        await logged(acme.id, truck.id, '22', 'a.csv');

        const res = await move(acme.id, truck.id, xyz.id).expect(200);
        const moved = TruckMovedSchema.parse(res.body);
        expect(moved).toMatchObject({ truckId: truck.id, merged: false });
        expect(moved.from.trucks.map((t) => t.unit)).toEqual(['25']);
        expect(moved.from.source).toBe('wialon');
        // X Y Z had no approved source yet: it takes the truck's.
        expect(moved.into.source).toBe('wialon');
        expect(moved.into.trucks).toEqual([
          expect.objectContaining({
            id: truck.id,
            unit: '22',
            vin: '1XKAD49X0AJ000001',
            odometer: '13581',
            odometerAsOf: '2026-10-31',
            lastSource: 'wialon',
            lastPeriodEnd: '2026-10-31',
          }),
        ]);
        expect(await prisma.conversion.findMany()).toEqual([
          expect.objectContaining({
            companyId: xyz.id,
            unitId: truck.id,
            companyName: 'as written',
          }),
        ]);
      });

      it('becomes one truck with the new company’s truck of the same number', async () => {
        await companies.record([
          {
            company: 'ACME TRUCKING LLC',
            units: ['22'],
            source: 'wialon',
            odometers: [{ unit: '22', reading: 2000, asOf: day(10, 31) }],
          },
          {
            company: 'X Y Z FREIGHT LLC',
            units: ['22'],
            source: 'ezlogz',
            odometers: [{ unit: '22', reading: 1000, asOf: day(9, 30) }],
          },
        ]);
        const [acme, xyz] = (await companies.list()).companies;
        const [mine, theirs] = [acme.trucks[0], xyz.trucks[0]];
        await prisma.unit.update({ where: { id: mine.id }, data: { plate: 'TX 123' } });
        await logged(acme.id, mine.id, '22', 'a.csv');
        await logged(xyz.id, theirs.id, '22', 'x.csv');

        const moved = TruckMovedSchema.parse(
          (await move(acme.id, mine.id, xyz.id).expect(200)).body,
        );
        expect(moved).toMatchObject({ truckId: theirs.id, merged: true });
        expect(moved.from.trucks).toEqual([]);
        expect(moved.into.source).toBe('ezlogz'); // its own approved source stays
        expect(moved.into.trucks).toEqual([
          expect.objectContaining({ id: theirs.id, odometer: '2000', plate: 'TX 123' }),
        ]);
        const history = await prisma.conversion.findMany({ orderBy: { outputFile: 'asc' } });
        expect(history.map((h) => [h.outputFile, h.companyId, h.unitId])).toEqual([
          ['a.csv', xyz.id, theirs.id],
          ['x.csv', xyz.id, theirs.id],
        ]);
      });

      it('refuses the same company, an unknown one, or a truck it doesn’t have', async () => {
        await companies.record([{ company: 'ACME', units: ['22'] }]);
        const [acme] = (await companies.list()).companies;
        const truck = acme.trucks[0];
        await move(acme.id, truck.id, acme.id).expect(409);
        await move(acme.id, truck.id, 'nope').expect(404);
        const xyz = await create({ name: 'X Y Z FREIGHT LLC' });
        await move(acme.id, 'nope', xyz.id).expect(404);
        await move(xyz.id, truck.id, acme.id).expect(404);
        await http()
          .post(`/api/v1/companies/${acme.id}/trucks/${truck.id}/move`)
          .send({})
          .expect(400);
      });

      it('refuses a move or merge that would give two trucks one ProMiles unit #', async () => {
        await companies.record([
          { company: 'ACME', units: ['Volvo 01'], promilesUnits: { 'Volvo 01': '2011' } },
          { company: 'XYZ', units: ['2011'] },
        ]);
        const [acme, xyz] = (await companies.list()).companies;
        const res = await move(acme.id, acme.trucks[0].id, xyz.id).expect(409);
        expect(res.body.message).toMatch(/XYZ would send trucks 2011 and Volvo 01/);
        await http().post(`/api/v1/companies/${acme.id}/merge`).send({ into: xyz.id }).expect(409);
        // Nothing moved.
        expect(summary(await companies.list())).toEqual([
          { name: 'ACME', units: ['Volvo 01'] },
          { name: 'XYZ', units: ['2011'] },
        ]);
      });
    });

    it('deletes a company with its trucks', async () => {
      await companies.record([{ company: 'ACME', units: ['22', '25'] }]);
      const [acme] = (await companies.list()).companies;
      await http().delete(`/api/v1/companies/${acme.id}`).expect(204);
      expect(await prisma.unit.count()).toBe(0);
      await http().delete(`/api/v1/companies/${acme.id}`).expect(404);
    });
  });
});
