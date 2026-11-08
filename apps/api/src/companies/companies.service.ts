import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Company as CompanyRow, Unit as UnitRow } from '@prisma/client';
import {
  SourceFormatIdSchema,
  companyKey,
  truckKey,
  type Company,
  type CompanyInputSchema,
  type CompanyList,
  type CompanyUpdateSchema,
  type SourceFormatId,
  type Truck,
  type TruckInputSchema,
  type TruckUpdateSchema,
} from '@haulbook/shared';
import type { z } from 'zod';
import type { SavedReading } from '../conversion/common';
import { PrismaService } from '../prisma/prisma.service';

/** One converted company's trucks, and where their odometers ended (if known). */
export interface RecordEntry {
  company: string;
  units: string[];
  odometers?: (SavedReading & { unit: string })[];
  /**
   * The source format its files were converted from: it becomes the company's approved
   * source (replacing any other, which conversion only allows once the user confirmed).
   */
  source?: SourceFormatId;
  /** Per truck: the format it came from and the end of its latest trip. */
  activity?: { unit: string; source: SourceFormatId; periodEnd: Date }[];
}

type CompanyInput = z.output<typeof CompanyInputSchema>;
type CompanyUpdate = z.output<typeof CompanyUpdateSchema>;
type TruckInput = z.output<typeof TruckInputSchema>;
type TruckUpdate = z.output<typeof TruckUpdateSchema>;
type CompanyWithUnits = CompanyRow & { units: UnitRow[] };

/** Natural order so units read 2, 10, 22, 29-LB rather than 10, 2, 22, 29-LB. */
const naturally = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

const isoDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');
const isLater = (a: Date | null, b: Date | null): a is Date => !!a && (!b || a > b);
const later = (a: Date | null, b: Date | null) => (isLater(a, b) ? a : b);

export function sourceOf(row: Pick<CompanyRow, 'source'>): SourceFormatId | null {
  const source = SourceFormatIdSchema.safeParse(row.source);
  return source.success ? source.data : null;
}

export function toTruck(u: UnitRow): Truck {
  const source = SourceFormatIdSchema.safeParse(u.lastSource);
  return {
    id: u.id,
    unit: u.number,
    vin: u.vin,
    plate: u.plate,
    notes: u.notes,
    odometer: u.odometer?.toString() ?? null,
    odometerAsOf: isoDate(u.odometerAsOf),
    lastSource: source.success ? source.data : null,
    lastPeriodEnd: isoDate(u.lastPeriodEnd),
    lastConvertedAt: u.lastConvertedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

function toCompany(c: CompanyWithUnits): Company {
  const lastConvertedAt = c.units.reduce<Date | null>((a, u) => later(u.lastConvertedAt, a), null);
  return {
    id: c.id,
    name: c.name,
    source: sourceOf(c),
    dotNumber: c.dotNumber,
    iftaAccount: c.iftaAccount,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    trucks: c.units.map(toTruck).sort((a, b) => naturally(a.unit, b.unit)),
    createdAt: c.createdAt.toISOString(),
    lastConvertedAt: lastConvertedAt?.toISOString() ?? null,
  };
}

/** A truck input → Unit data. The schema makes sure odometer + as-of come together. */
function truckData({ unit, odometer, odometerAsOf, ...details }: TruckInput | TruckUpdate) {
  return {
    ...details,
    ...(unit !== undefined ? { number: unit.trim() } : {}),
    ...(odometer !== undefined
      ? { odometer, odometerAsOf: odometerAsOf ? dateOf(odometerAsOf) : null }
      : {}),
  };
}

/**
 * The saved companies and their trucks (Postgres). Read by the portal's pickers
 * and Companies tab, and by conversion (a known company's spelling, its approved
 * source formats, its trucks' odometers); written after each successful
 * conversion so the list fills itself, and edited from the Companies tab.
 */
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CompanyList> {
    const rows = await this.prisma.company.findMany({ include: { units: true } });
    const companies = rows.map(toCompany).sort((a, b) => naturally(a.name, b.name));
    return { companies };
  }

  async get(id: string): Promise<Company> {
    return toCompany(await this.find(id));
  }

  async create(input: CompanyInput): Promise<Company> {
    const { name, ...details } = input;
    await this.assertNameFree(name);
    const row = await this.prisma.company.create({
      data: { name: cleanName(name), nameKey: companyKey(name), ...details },
      include: { units: true },
    });
    return toCompany(row);
  }

  async update(id: string, input: CompanyUpdate): Promise<Company> {
    await this.find(id);
    const { name, ...details } = input;
    if (name !== undefined) await this.assertNameFree(name, id);
    const row = await this.prisma.company.update({
      where: { id },
      data: {
        ...details,
        ...(name !== undefined ? { name: cleanName(name), nameKey: companyKey(name) } : {}),
      },
      include: { units: true },
    });
    return toCompany(row);
  }

  /** Deletes the company and its trucks (their saved odometers too). */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.prisma.company.delete({ where: { id } });
  }

  /**
   * Folds company `id` into `into` (two spellings of one carrier): its trucks move
   * across, a unit # both have keeps the later odometer/activity and fills blank
   * details, the kept company's approved source stays (or it takes `id`'s when it has
   * none), blank company details are filled in, conversion history follows the trucks,
   * and `id` is deleted.
   */
  async merge(id: string, into: string): Promise<Company> {
    if (id === into) throw new ConflictException('Pick a different company to merge into');
    const [from, to] = [await this.find(id), await this.find(into)];
    await this.prisma.$transaction(async (tx) => {
      for (const u of from.units) {
        const twin = to.units.find((t) => t.number === u.number);
        if (!twin) {
          await tx.unit.update({ where: { id: u.id }, data: { companyId: to.id } });
          continue;
        }
        await tx.conversion.updateMany({ where: { unitId: u.id }, data: { unitId: twin.id } });
        await tx.unit.delete({ where: { id: u.id } });
        await tx.unit.update({
          where: { id: twin.id },
          data: {
            vin: twin.vin ?? u.vin,
            plate: twin.plate ?? u.plate,
            notes: twin.notes ?? u.notes,
            ...(isLater(u.odometerAsOf, twin.odometerAsOf)
              ? { odometer: u.odometer, odometerAsOf: u.odometerAsOf }
              : {}),
            ...(isLater(u.lastPeriodEnd, twin.lastPeriodEnd)
              ? { lastSource: u.lastSource, lastPeriodEnd: u.lastPeriodEnd }
              : {}),
            lastConvertedAt: later(u.lastConvertedAt, twin.lastConvertedAt),
          },
        });
      }
      await tx.conversion.updateMany({ where: { companyId: from.id }, data: { companyId: to.id } });
      await tx.company.update({
        where: { id: to.id },
        data: {
          source: to.source ?? from.source,
          dotNumber: to.dotNumber ?? from.dotNumber,
          iftaAccount: to.iftaAccount ?? from.iftaAccount,
          contactName: to.contactName ?? from.contactName,
          phone: to.phone ?? from.phone,
          email: to.email ?? from.email,
          notes: to.notes ?? from.notes,
        },
      });
      await tx.company.delete({ where: { id: from.id } });
    });
    return this.get(to.id);
  }

  async addTruck(id: string, input: TruckInput): Promise<Company> {
    const company = await this.find(id);
    this.assertUnitFree(company, input.unit);
    await this.prisma.unit.create({
      data: { companyId: id, number: input.unit.trim(), ...truckData(input) },
    });
    return this.get(id);
  }

  async updateTruck(id: string, truckId: string, input: TruckUpdate): Promise<Company> {
    const company = await this.find(id);
    this.findTruck(company, truckId);
    if (input.unit !== undefined) this.assertUnitFree(company, input.unit, truckId);
    await this.prisma.unit.update({ where: { id: truckId }, data: truckData(input) });
    return this.get(id);
  }

  async removeTruck(id: string, truckId: string): Promise<Company> {
    this.findTruck(await this.find(id), truckId);
    await this.prisma.unit.delete({ where: { id: truckId } });
    return this.get(id);
  }

  /** The saved spelling of a company that matches `name` case/spacing-insensitively. */
  async canonicalNames(names: string[]): Promise<Map<string, string>> {
    const keys = [...new Set(names.map(companyKey))];
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.company.findMany({ where: { nameKey: { in: keys } } });
    return new Map(rows.map((c) => [c.nameKey, c.name]));
  }

  /**
   * The approved source of the saved companies among `names`, keyed companyKey. A company
   * with none yet (or not saved) is left out: its first converted file's format is approved.
   */
  async approvedSources(names: string[]): Promise<Map<string, SourceFormatId>> {
    const keys = [...new Set(names.map(companyKey))];
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.company.findMany({ where: { nameKey: { in: keys } } });
    return new Map(
      rows.flatMap((c) => {
        const source = sourceOf(c);
        return source ? [[c.nameKey, source] as const] : [];
      }),
    );
  }

  /**
   * Per unit #, the saved companies that run a truck with it. A file with no company takes
   * the one company that matches; several mean the user has to pick.
   */
  async ownersOfUnits(units: string[]): Promise<Map<string, string[]>> {
    const numbers = [...new Set(units.map((u) => u.trim()))];
    if (numbers.length === 0) return new Map();
    const rows = await this.prisma.unit.findMany({
      where: { number: { in: numbers } },
      include: { company: true },
    });
    return new Map(
      numbers.map((n) => [
        n,
        rows
          .filter((u) => u.number === n)
          .map((u) => u.company.name)
          .sort(naturally),
      ]),
    );
  }

  /** The saved odometers of these trucks, keyed truckKey(company, unit). */
  async savedOdometers(
    trucks: { company: string; unit: string }[],
  ): Promise<Map<string, SavedReading>> {
    if (trucks.length === 0) return new Map();
    const rows = await this.prisma.unit.findMany({
      where: {
        odometer: { not: null },
        odometerAsOf: { not: null },
        number: { in: [...new Set(trucks.map((t) => t.unit.trim()))] },
        company: { nameKey: { in: [...new Set(trucks.map((t) => companyKey(t.company)))] } },
      },
      include: { company: true },
    });
    return new Map(
      rows.map((u) => [
        truckKey(u.company.name, u.number),
        { reading: u.odometer!.toNumber(), asOf: u.odometerAsOf! },
      ]),
    );
  }

  /**
   * After a conversion: adds any companies/units not yet in the list (existing
   * ones keep their spelling and details), makes the format converted the company's
   * approved source, and per truck saves its end odometer and latest activity,
   * unless a later period is already saved (re-converting an old quarter must not
   * wind them back).
   */
  async record(entries: RecordEntry[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const { company, units, odometers = [], source, activity = [] } of entries) {
        const saved = await tx.company.upsert({
          where: { nameKey: companyKey(company) },
          create: { name: cleanName(company), nameKey: companyKey(company), source },
          update: {},
        });
        if (source && saved.source !== source) {
          await tx.company.update({ where: { id: saved.id }, data: { source } });
        }
        for (const number of new Set(units.map((u) => u.trim()))) {
          await tx.unit.upsert({
            where: { companyId_number: { companyId: saved.id, number } },
            create: { companyId: saved.id, number },
            update: {},
          });
        }
        for (const { unit, reading, asOf } of odometers) {
          await tx.unit.updateMany({
            where: {
              companyId: saved.id,
              number: unit.trim(),
              OR: [{ odometerAsOf: null }, { odometerAsOf: { lte: asOf } }],
            },
            data: { odometer: reading.toFixed(1), odometerAsOf: asOf },
          });
        }
        const now = new Date();
        for (const { unit, source, periodEnd } of activity) {
          const where = { companyId: saved.id, number: unit.trim() };
          await tx.unit.updateMany({ where, data: { lastConvertedAt: now } });
          await tx.unit.updateMany({
            where: {
              ...where,
              OR: [{ lastPeriodEnd: null }, { lastPeriodEnd: { lte: periodEnd } }],
            },
            data: { lastSource: source, lastPeriodEnd: periodEnd },
          });
        }
      }
    });
  }

  private async find(id: string): Promise<CompanyWithUnits> {
    const row = await this.prisma.company.findUnique({ where: { id }, include: { units: true } });
    if (!row) throw new NotFoundException('No such company');
    return row;
  }

  private findTruck(company: CompanyWithUnits, truckId: string): UnitRow {
    const unit = company.units.find((u) => u.id === truckId);
    if (!unit) throw new NotFoundException(`${company.name} has no such truck`);
    return unit;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const other = await this.prisma.company.findUnique({ where: { nameKey: companyKey(name) } });
    if (other && other.id !== exceptId) {
      throw new ConflictException(
        `A company named ${other.name} already exists. Merge the two instead.`,
      );
    }
  }

  private assertUnitFree(company: CompanyWithUnits, unit: string, exceptId?: string): void {
    const other = company.units.find((u) => u.number === unit.trim() && u.id !== exceptId);
    if (other) throw new ConflictException(`${company.name} already has unit ${other.number}`);
  }
}
