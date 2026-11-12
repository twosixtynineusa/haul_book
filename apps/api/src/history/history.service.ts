import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Prisma, type Conversion as ConversionRow } from '@prisma/client';
import {
  HistoryTripSchema,
  SourceFormatIdSchema,
  companyKey,
  type HistoryEntry,
  type HistoryList,
  type HistoryOrigin,
  type HistoryQuerySchema,
  type HistoryTrip,
  type SourceFormatId,
  type TruckDetail,
} from '@haulbook/shared';
import type { z } from 'zod';
import { sourceOf, toTruck } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';
import { attachProMiles, parseProMilesCsv } from './promiles-snapshot';
import { companyReportPdf, type ReportPeriod } from './company-report';

/** One truck's part of one converted source report, as ConversionService hands it over. */
export interface HistoryRecord {
  company: string;
  unit: string;
  /** The unit # written to ProMiles. */
  promilesUnit: string;
  origin: HistoryOrigin;
  source: SourceFormatId;
  sourceFile: string;
  outputFile: string;
  distanceUnit: 'M' | 'K';
  /** In date order. */
  trips: HistoryTrip[];
}

type HistoryQuery = z.output<typeof HistoryQuerySchema>;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DAY_MS = 24 * 60 * 60_000;

function toEntry(row: ConversionRow): HistoryEntry {
  const source = SourceFormatIdSchema.safeParse(row.source);
  const trips = HistoryTripSchema.array().safeParse(row.trips);
  return {
    id: row.id,
    convertedAt: row.createdAt.toISOString(),
    origin: row.origin === 'inbox' ? 'inbox' : 'portal',
    company: row.companyName,
    companyId: row.companyId,
    unit: row.unitNumber,
    promilesUnit: row.promilesUnit ?? row.unitNumber,
    truckId: row.unitId,
    source: source.success ? source.data : null,
    sourceFile: row.sourceFile,
    outputFile: row.outputFile,
    beginDate: isoDate(row.beginDate),
    endDate: isoDate(row.endDate),
    beginOdo: row.beginOdo?.toString() ?? null,
    endOdo: row.endOdo?.toString() ?? null,
    distance: row.distance.toNumber(),
    distanceUnit: row.distanceUnit === 'K' ? 'K' : 'M',
    states: row.states,
    trips: trips.success ? trips.data : [],
  };
}

/**
 * The conversion history (Postgres `conversions`): written after every saved conversion,
 * from the portal or the input folder, and read by the History tab and the truck pages.
 * It runs after CompaniesService.record, so the company and its trucks exist to link to.
 */
@Injectable()
export class HistoryService implements OnModuleInit {
  private readonly logger = new Logger(HistoryService.name);
  constructor(private readonly prisma: PrismaService) {}

  async companyPdf(id: string, period: ReportPeriod): Promise<Buffer> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('No such company');
    const rows = await this.prisma.conversion.findMany({
      where: { companyId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return companyReportPdf(company, rows.map(toEntry), period);
  }

  /** Recover existing exports once, without re-converting sources or changing odometers. */
  async onModuleInit(): Promise<void> {
    await this.archiveExisting();
  }

  async archiveExisting(): Promise<{ archived: number; unavailable: number }> {
    await fsp.mkdir(env.outputPath, { recursive: true });
    let archived = 0;
    for (const name of await fsp.readdir(env.outputPath)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/.test(name)) continue;
      if (await this.storedOutput(name)) continue;
      try {
        const file = path.join(env.outputPath, name);
        const csv = await fsp.readFile(file, 'utf8');
        const trips = parseProMilesCsv(csv);
        const stat = await fsp.stat(file);
        await this.prisma.$transaction(async (tx) => {
          await tx.storedOutput.upsert({
            where: { name },
            create: { name, csv, trips, createdAt: stat.mtime },
            update: {},
          });
          const rows = await tx.conversion.findMany({ where: { outputFile: name } });
          for (const row of rows) {
            const parsed = HistoryTripSchema.array().safeParse(row.trips);
            if (!parsed.success) continue;
            const detailed = attachProMiles(parsed.data, row.promilesUnit ?? row.unitNumber, trips);
            await tx.conversion.update({
              where: { id: row.id },
              data: { trips: detailed as unknown as Prisma.InputJsonValue },
            });
          }
        });
        archived++;
      } catch (error) {
        this.logger.warn(
          `Could not archive ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const outputs = await this.prisma.storedOutput.findMany({ select: { name: true } });
    const unavailable = await this.prisma.conversion.count({
      where: { outputFile: { notIn: outputs.map((o) => o.name) } },
    });
    if (archived || unavailable)
      this.logger.log(
        `CSV archive: ${archived} recovered; ${unavailable} history rows without an available CSV`,
      );
    return { archived, unavailable };
  }

  storedOutput(name: string) {
    return this.prisma.storedOutput.findUnique({ where: { name } });
  }

  async storedOutputs(companyId?: string, truckId?: string) {
    const names =
      companyId || truckId
        ? (
            await this.prisma.conversion.findMany({
              where: {
                ...(companyId ? { companyId } : {}),
                ...(truckId ? { unitId: truckId } : {}),
              },
              select: { outputFile: true },
              distinct: ['outputFile'],
            })
          ).map((r) => r.outputFile)
        : undefined;
    return this.prisma.storedOutput.findMany({
      where: names ? { name: { in: names } } : {},
      select: { name: true, csv: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(
    records: HistoryRecord[],
    outputs: { name: string; csv: string }[] = [],
  ): Promise<void> {
    if (records.length === 0) return;
    const companies = await this.prisma.company.findMany({
      where: { nameKey: { in: [...new Set(records.map((r) => companyKey(r.company)))] } },
      include: { units: true },
    });
    const byKey = new Map(companies.map((c) => [c.nameKey, c]));
    const snapshots = new Map(outputs.map((o) => [o.name, parseProMilesCsv(o.csv)]));
    await this.prisma.$transaction(async (tx) => {
      for (const output of outputs) {
        const stored = await tx.storedOutput.upsert({
          where: { name: output.name },
          create: { ...output, trips: snapshots.get(output.name)! },
          update: {},
        });
        if (stored.csv !== output.csv)
          throw new Error(`A different CSV is already stored as ${output.name}`);
      }
      await tx.conversion.createMany({
        data: records.map((r) => {
          const company = byKey.get(companyKey(r.company));
          const unit = company?.units.find((u) => u.number === r.unit.trim());
          const first = r.trips[0];
          const last = r.trips[r.trips.length - 1];
          return {
            companyId: company?.id ?? null,
            unitId: unit?.id ?? null,
            companyName: company?.name ?? r.company,
            unitNumber: r.unit,
            promilesUnit: r.promilesUnit === r.unit ? null : r.promilesUnit,
            origin: r.origin,
            source: r.source,
            sourceFile: r.sourceFile,
            outputFile: r.outputFile,
            beginDate: dateOf(first.beginDate),
            endDate: dateOf(last.endDate),
            beginOdo: first.beginOdo,
            endOdo: last.endOdo,
            distance: new Prisma.Decimal(
              Math.round(r.trips.reduce((sum, t) => sum + t.distance, 0) * 100) / 100,
            ),
            distanceUnit: r.distanceUnit,
            states: [...new Set(r.trips.flatMap((t) => t.states))],
            trips: attachProMiles(
              r.trips,
              r.promilesUnit,
              snapshots.get(r.outputFile) ?? [],
            ) as unknown as Prisma.InputJsonValue,
          };
        }),
      });
    });
  }

  /**
   * Forgets conversions being undone (an input-folder row deleted or converted again): the
   * history rows these ProMiles files wrote go, and each truck they were for is put back
   * where it stood. Its latest activity becomes what's left of its history, and a saved
   * odometer this conversion wrote goes back to the reading it began from (as of the day
   * before), so converting the report again starts at the same odometer.
   */
  async forget(sourceFile: string, outputFiles: string[]): Promise<void> {
    if (outputFiles.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.conversion.findMany({
        where: { sourceFile, outputFile: { in: outputFiles } },
        include: { unit: true },
      });
      await tx.conversion.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      for (const name of outputFiles) {
        if (!(await tx.conversion.count({ where: { outputFile: name } }))) {
          await tx.storedOutput.deleteMany({ where: { name } });
        }
      }
      for (const { unit, ...row } of rows) {
        if (!unit) continue;
        const left = { where: { unitId: unit.id } };
        const latest = await tx.conversion.findFirst({ ...left, orderBy: { endDate: 'desc' } });
        const newest = await tx.conversion.findFirst({ ...left, orderBy: { createdAt: 'desc' } });
        const shown = unit.lastPeriodEnd?.getTime() === row.endDate.getTime();
        const wrote =
          !!row.endOdo &&
          !!unit.odometer?.equals(row.endOdo) &&
          unit.odometerAsOf?.getTime() === row.endDate.getTime();
        await tx.unit.update({
          where: { id: unit.id },
          data: {
            ...(shown
              ? {
                  lastSource: latest?.source ?? null,
                  lastPeriodEnd: latest?.endDate ?? null,
                  lastConvertedAt: newest?.createdAt ?? null,
                }
              : {}),
            ...(wrote
              ? {
                  odometer: row.beginOdo,
                  odometerAsOf: row.beginOdo ? new Date(row.beginDate.getTime() - DAY_MS) : null,
                }
              : {}),
          },
        });
      }
    });
  }

  /** Newest first, optionally for one company or one truck. */
  async list({ companyId, truckId, limit }: HistoryQuery): Promise<HistoryList> {
    const rows = await this.prisma.conversion.findMany({
      where: { ...(companyId ? { companyId } : {}), ...(truckId ? { unitId: truckId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return { entries: rows.slice(0, limit).map(toEntry), more: rows.length > limit };
  }

  /** A truck, its company and every conversion of it (newest first). */
  async truck(truckId: string): Promise<TruckDetail> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: truckId },
      include: {
        company: true,
        conversions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!unit) throw new NotFoundException('No such truck');
    return {
      company: { id: unit.company.id, name: unit.company.name, source: sourceOf(unit.company) },
      truck: toTruck(unit),
      history: unit.conversions.map(toEntry),
    };
  }
}
