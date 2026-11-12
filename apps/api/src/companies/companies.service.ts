import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Company as CompanyRow, Prisma, Unit as UnitRow } from '@prisma/client';
import {
  SourceFormatIdSchema,
  companyKey,
  promilesUnitOf,
  truckKey,
  type Company,
  type CompanyInputSchema,
  type CompanyList,
  type CompanyUpdateSchema,
  type SourceFormatId,
  type Truck,
  type TruckInputSchema,
  type TruckMoved,
  type TruckUpdateSchema,
} from '@haulbook/shared';
import type { z } from 'zod';
import type { SavedReading } from '../conversion/common';
import { PrismaService } from '../prisma/prisma.service';

/** One converted company's trucks, and where their odometers ended (if known). */
export interface RecordEntry {
  company: string;
  units: string[];
  /** Truck # → the unit # ProMiles got: saved on each truck (null when it's the truck #). */
  promilesUnits?: Record<string, string>;
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
    promilesUnit: u.promilesUnit ?? u.number,
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

/**
 * Folds truck `from` into `into` (the same truck # at the company it joins): its history
 * follows, the later odometer and activity win, blank details are filled in, and `from`
 * is deleted. Company merges and truck moves both use it.
 */
async function foldTruck(tx: Prisma.TransactionClient, from: UnitRow, into: UnitRow) {
  await tx.conversion.updateMany({ where: { unitId: from.id }, data: { unitId: into.id } });
  await tx.unit.delete({ where: { id: from.id } });
  await tx.unit.update({
    where: { id: into.id },
    data: {
      promilesUnit: into.promilesUnit ?? from.promilesUnit,
      vin: into.vin ?? from.vin,
      plate: into.plate ?? from.plate,
      notes: into.notes ?? from.notes,
      ...(isLater(from.odometerAsOf, into.odometerAsOf)
        ? { odometer: from.odometer, odometerAsOf: from.odometerAsOf }
        : {}),
      ...(isLater(from.lastPeriodEnd, into.lastPeriodEnd)
        ? { lastSource: from.lastSource, lastPeriodEnd: from.lastPeriodEnd }
        : {}),
      lastConvertedAt: later(from.lastConvertedAt, into.lastConvertedAt),
    },
  });
}

/**
 * A truck input → Unit data. The schema makes sure odometer + as-of come together. A ProMiles
 * unit # equal to the truck # is stored as null (the same), so renaming the truck carries it.
 */
function truckData(
  { unit, promilesUnit, odometer, odometerAsOf, ...details }: TruckInput | TruckUpdate,
  number: string,
) {
  return {
    ...details,
    ...(unit !== undefined ? { number: unit.trim() } : {}),
    ...(promilesUnit !== undefined
      ? { promilesUnit: promilesUnit && promilesUnit !== number ? promilesUnit : null }
      : {}),
    ...(odometer !== undefined
      ? { odometer, odometerAsOf: odometerAsOf ? dateOf(odometerAsOf) : null }
      : {}),
  };
}

/** A truck as the ProMiles unit # guard sees it. */
interface Mapped {
  id: string;
  number: string;
  promilesUnit: string | null;
}

/**
 * Two trucks of one company sending the same unit # to ProMiles would merge two vehicles'
 * miles there: the first such pair among `trucks` (one company's, as they'll be saved).
 */
function promilesClash(trucks: Mapped[]): [Mapped, Mapped] | null {
  const seen = new Map<string, Mapped>();
  for (const t of trucks) {
    const unit = promilesUnitOf({ unit: t.number, promilesUnit: t.promilesUnit });
    const other = seen.get(unit);
    if (other) return [other, t];
    seen.set(unit, t);
  }
  return null;
}

function assertNoClash(company: string, trucks: Mapped[]): void {
  const clash = promilesClash(trucks);
  if (!clash) return;
  const [a, b] = clash;
  const unit = promilesUnitOf({ unit: b.number, promilesUnit: b.promilesUnit });
  throw new ConflictException(
    `${company} would send trucks ${a.number} and ${b.number} to ProMiles as the same ` +
      `unit # ${unit}. Give one of them another ProMiles unit # first.`,
  );
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
    assertNoClash(to.name, [
      ...to.units.map((t) => {
        const twin = from.units.find((u) => u.number === t.number);
        return { ...t, promilesUnit: t.promilesUnit ?? twin?.promilesUnit ?? null };
      }),
      ...from.units.filter((u) => !to.units.some((t) => t.number === u.number)),
    ]);
    await this.prisma.$transaction(async (tx) => {
      for (const u of from.units) {
        const twin = to.units.find((t) => t.number === u.number);
        if (twin) await foldTruck(tx, u, twin);
        else await tx.unit.update({ where: { id: u.id }, data: { companyId: to.id } });
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
    const data = truckData(input, input.unit.trim());
    assertNoClash(company.name, [
      ...company.units,
      { id: '', number: input.unit.trim(), promilesUnit: data.promilesUnit ?? null },
    ]);
    await this.prisma.unit.create({ data: { companyId: id, number: input.unit.trim(), ...data } });
    return this.get(id);
  }

  async updateTruck(id: string, truckId: string, input: TruckUpdate): Promise<Company> {
    const company = await this.find(id);
    const truck = this.findTruck(company, truckId);
    if (input.unit !== undefined) this.assertUnitFree(company, input.unit, truckId);
    const data = truckData(input, input.unit?.trim() ?? truck.number);
    assertNoClash(company.name, [
      ...company.units.filter((u) => u.id !== truckId),
      { ...truck, ...data },
    ]);
    await this.prisma.unit.update({ where: { id: truckId }, data });
    return this.get(id);
  }

  async removeTruck(id: string, truckId: string): Promise<Company> {
    this.findTruck(await this.find(id), truckId);
    await this.prisma.unit.delete({ where: { id: truckId } });
    return this.get(id);
  }

  /**
   * Moves a truck to company `into` with everything it owns: its details, saved odometer,
   * activity and conversion history (the names as written stay). When `into` already has
   * that truck #, the two become one, as in a company merge. `into` takes the truck's last
   * source as its approved one when it has none; the company it leaves keeps its own.
   * Refused when another truck of `into` already has its ProMiles unit #.
   */
  async moveTruck(id: string, truckId: string, into: string): Promise<TruckMoved> {
    if (id === into) throw new ConflictException('Pick a different company to move it to');
    const [from, to] = [await this.find(id), await this.find(into)];
    const truck = this.findTruck(from, truckId);
    const twin = to.units.find((t) => t.number === truck.number);
    const kept = twin ?? truck;
    assertNoClash(to.name, [
      ...to.units.filter((t) => t !== twin),
      { ...kept, promilesUnit: twin?.promilesUnit ?? truck.promilesUnit },
    ]);
    await this.prisma.$transaction(async (tx) => {
      if (twin) await foldTruck(tx, truck, twin);
      else await tx.unit.update({ where: { id: truck.id }, data: { companyId: to.id } });
      await tx.conversion.updateMany({ where: { unitId: kept.id }, data: { companyId: to.id } });
      if (!to.source && truck.lastSource) {
        await tx.company.update({ where: { id: to.id }, data: { source: truck.lastSource } });
      }
    });
    return {
      from: await this.get(from.id),
      into: await this.get(to.id),
      truckId: kept.id,
      merged: !!twin,
    };
  }

  /**
   * The saved trucks of the companies among `names` (keyed companyKey), with the unit #
   * ProMiles gets for each: conversion maps a file's trucks with them.
   */
  async trucksOf(
    names: string[],
  ): Promise<Map<string, { unit: string; promilesUnit: string | null }[]>> {
    const keys = [...new Set(names.map(companyKey))];
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.company.findMany({
      where: { nameKey: { in: keys } },
      include: { units: true },
    });
    return new Map(
      rows.map((c) => [
        c.nameKey,
        c.units.map((u) => ({ unit: u.number, promilesUnit: u.promilesUnit })),
      ]),
    );
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
      for (const {
        company,
        units,
        promilesUnits = {},
        odometers = [],
        source,
        activity = [],
      } of entries) {
        const saved = await tx.company.upsert({
          where: { nameKey: companyKey(company) },
          create: { name: cleanName(company), nameKey: companyKey(company), source },
          update: {},
        });
        if (source && saved.source !== source) {
          await tx.company.update({ where: { id: saved.id }, data: { source } });
        }
        for (const number of new Set(units.map((u) => u.trim()))) {
          const promiles = promilesUnits[number]?.trim();
          const own = promiles && promiles !== number ? promiles : null;
          await tx.unit.upsert({
            where: { companyId_number: { companyId: saved.id, number } },
            create: { companyId: saved.id, number, promilesUnit: own },
            update: promiles ? { promilesUnit: own } : {},
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
    if (other) throw new ConflictException(`${company.name} already has truck ${other.number}`);
  }
}
