import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { InboxFile, InboxStatus } from '@prisma/client';
import {
  ACCEPTED_EXTENSIONS,
  SourceFormatIdSchema,
  SourceNeedSchema,
  type InboxEntry,
  type InboxList,
  type SourceChoice,
  type SourceFormatId,
} from '@haulbook/shared';
import { handToHostUser } from '../common/host-files';
import { env } from '../config/env';
import { ConversionService, type ConvertOptions } from '../conversion/conversion.service';
import { suggestedPeriod } from '../conversion/importers';
import { PrismaService } from '../prisma/prisma.service';

/** Sub-folders of INPUT_DIR the scanner never reads: where processed files go. */
export const ARCHIVE_DIR = 'archive';
export const FAILED_DIR = 'failed';

/** File still in the input folder. */
const ACTIVE: InboxStatus[] = ['waiting', 'processing', 'needs_input', 'failed'];
/** States a conversion attempt may start from (claimed atomically → processing). */
const CLAIMABLE: InboxStatus[] = ['waiting', 'needs_input', 'failed'];
/** A crash mid-conversion leaves `processing`; retry it after this long. */
const STUCK_AFTER_MS = 10 * 60_000;
const RECENT_LIMIT = 25;
/** A Postgres `date` ↔ `YYYY-MM-DD`. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Browser downloads / editors still writing, lock files. */
const PARTIAL_RE = /\.(part|crdownload|download|tmp)$/i;

interface Found {
  /** Relative to INPUT_DIR, `/`-separated. */
  rel: string;
  name: string;
  size: number;
  mtimeMs: number;
  /** The company sub-folder it sits in, if any. */
  folderCompany: string | null;
}

/** A file converted before whose trucks were deleted since (InboxService.deletedSince). */
interface Reconvert {
  /** Only these trucks of a file with several; null = the whole file. */
  units: string[] | null;
  /** The company still running the file's other trucks. */
  company: string | null;
}

export interface ScanSummary {
  found: number;
  converted: number;
  needsInput: number;
  failed: number;
  duplicates: number;
}

function wanted(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~$') || PARTIAL_RE.test(name)) return false;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

function withSuffix(rel: string, n: number): string {
  if (n === 1) return rel;
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)}_${n}${ext}`;
}

/**
 * The watched input folder (INPUT_DIR). The worker calls `scan()` every
 * INPUT_SCAN_SECONDS; the portal calls `resolve`/`retry`/`dismiss`.
 *
 * Per file: wait until its size + mtime are unchanged across two scans, then run
 * it through the same pipeline as a portal upload (ConversionService). Company =
 * what the user entered, else what the file carries, else the company sub-folder
 * it was dropped in, else the one saved company that has its unit # (several:
 * the user picks). Converted (or duplicate) sources move to
 * `archive/<YYYY-MM-DD>/`; anything missing a format / company / unit / period
 * waits as `needs_input` until the user fills it in, and so does a saved company's
 * file in a format other than its approved source, until the user confirms the
 * switch (that format then replaces the company's approved source).
 */
@Injectable()
export class InboxService implements OnModuleInit {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversion: ConversionService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const dir of [ARCHIVE_DIR, FAILED_DIR]) await this.ensureDir(dir);
  }

  async scan(): Promise<ScanSummary> {
    await this.prisma.inboxFile.updateMany({
      where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
      data: { status: 'waiting' },
    });

    const found = await this.listInputFolder();
    const active = await this.prisma.inboxFile.findMany({ where: { status: { in: ACTIVE } } });
    const byPath = new Map(active.map((r) => [r.path, r]));

    // Files the user took back out of the folder are forgotten.
    const present = new Set(found.map((f) => f.rel));
    const vanished = active.filter((r) => !present.has(r.path) && r.status !== 'processing');
    if (vanished.length > 0) {
      await this.prisma.inboxFile.deleteMany({ where: { id: { in: vanished.map((r) => r.id) } } });
    }

    const summary: ScanSummary = {
      found: found.length,
      converted: 0,
      needsInput: 0,
      failed: 0,
      duplicates: 0,
    };
    for (const f of found) {
      const record = byPath.get(f.rel);
      if (!record) {
        // First sighting: note size + mtime; it's picked up once they stop changing.
        await this.prisma.inboxFile.create({
          data: {
            path: f.rel,
            name: f.name,
            folderCompany: f.folderCompany,
            size: f.size,
            mtimeMs: f.mtimeMs,
          },
        });
        continue;
      }
      if (record.status === 'processing') continue;
      if (record.size !== f.size || record.mtimeMs !== f.mtimeMs) {
        // Still being written, or replaced by a new version: settle again.
        await this.prisma.inboxFile.update({
          where: { id: record.id },
          data: { size: f.size, mtimeMs: f.mtimeMs, status: 'waiting', needs: [], error: null },
        });
        continue;
      }
      if (record.status !== 'waiting') continue; // waits for the user in the portal

      const done = await this.process(record.id);
      if (done?.status === 'converted') summary.converted++;
      else if (done?.status === 'needs_input') summary.needsInput++;
      else if (done?.status === 'failed') summary.failed++;
      else if (done?.status === 'duplicate') summary.duplicates++;
    }

    if (summary.converted + summary.needsInput + summary.failed + summary.duplicates > 0) {
      this.logger.log(
        `Scan: ${summary.converted} converted, ${summary.needsInput} need input, ` +
          `${summary.failed} failed, ${summary.duplicates} duplicate(s)`,
      );
    }
    return summary;
  }

  async list(): Promise<InboxList> {
    const [pending, recent] = await Promise.all([
      this.prisma.inboxFile.findMany({
        where: { status: { in: ACTIVE } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.inboxFile.findMany({
        where: { status: { notIn: ACTIVE } },
        orderBy: { updatedAt: 'desc' },
        take: RECENT_LIMIT,
      }),
    ]);
    return {
      inputDir: env.inputDirLabel,
      scanSeconds: env.inputScanSeconds,
      pending: pending.map(toEntry),
      recent: recent.map(toEntry),
    };
  }

  /** The user filled in what was missing: save it and convert right away. */
  async resolve(id: string, choice: SourceChoice): Promise<InboxEntry> {
    const record = await this.find(id);
    if (!CLAIMABLE.includes(record.status)) {
      throw new BadRequestException(`${record.name} is ${record.status.replace('_', ' ')}`);
    }
    await this.prisma.inboxFile.update({
      where: { id },
      data: {
        format: choice.format ?? record.format,
        company: choice.company ?? record.company,
        unit: choice.unit ?? record.unit,
        ...(choice.period
          ? { periodBegin: dateOf(choice.period.begin), periodEnd: dateOf(choice.period.end) }
          : {}),
        confirmSource: choice.confirmSource ?? record.confirmSource,
      },
    });
    return toEntry((await this.process(id)) ?? record);
  }

  async retry(id: string): Promise<InboxEntry> {
    const record = await this.find(id);
    if (record.status !== 'failed' && record.status !== 'needs_input') {
      throw new BadRequestException(`${record.name} is ${record.status.replace('_', ' ')}`);
    }
    return toEntry((await this.process(id)) ?? record);
  }

  /** Give up on a file: move it to `failed/` so it stops showing in the inbox. */
  async dismiss(id: string): Promise<InboxEntry> {
    const record = await this.find(id);
    if (!CLAIMABLE.includes(record.status)) {
      throw new BadRequestException(`${record.name} is ${record.status.replace('_', ' ')}`);
    }
    const archivedPath = await this.moveSource(record.path, FAILED_DIR, false);
    return toEntry(
      await this.prisma.inboxFile.update({
        where: { id },
        data: { status: 'dismissed', archivedPath, processedAt: new Date() },
      }),
    );
  }

  /** Claims a file (so a scan and a portal click never convert it twice) and converts it. */
  async process(id: string): Promise<InboxFile | null> {
    const claimed = await this.prisma.inboxFile.updateMany({
      where: { id, status: { in: CLAIMABLE } },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) return this.prisma.inboxFile.findUnique({ where: { id } });
    const record = (await this.prisma.inboxFile.findUnique({ where: { id } }))!;
    try {
      return await this.convert(record);
    } catch (e) {
      this.logger.error(`${record.path}: ${(e as Error).message}`);
      return this.prisma.inboxFile.update({
        where: { id },
        data: { status: 'failed', error: (e as Error).message },
      });
    }
  }

  private async convert(record: InboxFile): Promise<InboxFile | null> {
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(this.abs(record.path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await this.prisma.inboxFile.delete({ where: { id: record.id } });
      return null;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const earlier = await this.prisma.inboxFile.findMany({
      where: { sha256, status: 'converted', id: { not: record.id } },
      orderBy: { processedAt: 'desc' },
    });
    const again = earlier.length > 0 ? await this.deletedSince(earlier) : null;
    if (earlier.length > 0 && !again) {
      const archivedPath = await this.moveSource(record.path, ARCHIVE_DIR, true);
      return this.prisma.inboxFile.update({
        where: { id: record.id },
        data: {
          status: 'duplicate',
          sha256,
          archivedPath,
          needs: [],
          error: `Same content as ${earlier[0].name}, already converted to ${earlier[0].outputs.join(', ')}`,
          processedAt: new Date(),
        },
      });
    }

    const file = { name: record.name, bytes };
    const choice: SourceChoice = {
      ...(record.format ? { format: record.format as SourceFormatId } : {}),
      ...(record.company ? { company: record.company } : {}),
      ...(record.unit ? { unit: record.unit } : {}),
      ...(record.periodBegin && record.periodEnd
        ? { period: { begin: isoDay(record.periodBegin), end: isoDay(record.periodEnd) } }
        : {}),
      ...(record.confirmSource ? { confirmSource: true } : {}),
    };
    // The company sub-folder counts after the file's own company, and before the unit #'s.
    // Converting again for some of its trucks: the company running the others stands in.
    const options: ConvertOptions = {
      hints: [{ folderCompany: record.folderCompany ?? again?.company }],
      ...(again?.units ? { onlyUnits: again.units } : {}),
    };
    const preview = await this.conversion.preview([file], [choice], {}, options);
    const source = preview.files[0];

    const resolved = {
      format: source.format,
      formatOptions: source.formatOptions,
      company: source.company,
      companyOptions: source.companyOptions,
      unit: source.unit,
      units: source.units,
      sha256,
    };
    if (!preview.ready) {
      const needsInput = source.needs.length > 0 && !source.error;
      return this.prisma.inboxFile.update({
        where: { id: record.id },
        data: {
          ...resolved,
          status: needsInput ? 'needs_input' : 'failed',
          needs: source.needs,
          knownSource: source.knownSource,
          error: source.error ?? (preview.errors.join(' · ') || null),
        },
      });
    }

    const result = await this.conversion.convertAndSave(
      [file],
      [choice],
      {},
      {
        ...options,
        origin: 'inbox',
      },
    );
    const archivedPath = await this.moveSource(record.path, ARCHIVE_DIR, true);
    this.logger.log(`${record.path} → ${result.outputs.map((o) => o.name).join(', ')}`);
    return this.prisma.inboxFile.update({
      where: { id: record.id },
      data: {
        ...resolved,
        status: 'converted',
        needs: [],
        error: null,
        outputs: result.outputs.map((o) => o.name),
        archivedPath,
        processedAt: new Date(),
      },
    });
  }

  /**
   * Whether a file converted before (same SHA-256) converts again: only once its trucks
   * were deleted (one by one, or with their company). The history rows those conversions
   * wrote say so: their truck link goes null on delete and follows merges. Null = still
   * converted, a duplicate (also when there's no history, i.e. converted before it existed).
   * `units` null = the whole file again; else just those trucks of a file with several,
   * with `company` the one running the others. Never the trucks still converted: their
   * miles would reach ProMiles twice.
   */
  private async deletedSince(earlier: InboxFile[]): Promise<Reconvert | null> {
    const rows = await this.prisma.conversion.findMany({
      where: {
        origin: 'inbox',
        OR: earlier.map((e) => ({ sourceFile: e.name, outputFile: { in: e.outputs } })),
      },
      include: { company: true },
    });
    const kept = rows.filter((r) => r.unitId);
    const keptUnits = new Set(kept.map((r) => r.unitNumber));
    const gone = [
      ...new Set(rows.filter((r) => !keptUnits.has(r.unitNumber)).map((r) => r.unitNumber)),
    ];
    if (gone.length === 0) return null;
    if (kept.length === 0) return { units: null, company: null };
    // One truck, converted again since under another unit #.
    if (earlier[0].units.length === 0) return null;
    return { units: gone, company: kept[0].company?.name ?? null };
  }

  /** Files in INPUT_DIR and one level of company sub-folders (never archive/ or failed/). */
  private async listInputFolder(): Promise<Found[]> {
    const found: Found[] = [];
    const add = async (rel: string, name: string, folderCompany: string | null) => {
      try {
        const stat = await fsp.stat(this.abs(rel));
        // Whole ms: a nanosecond mtime as a float doesn't survive the Postgres round trip
        // exactly, and the file would then look "changed" on every scan.
        const mtimeMs = Math.trunc(stat.mtimeMs);
        found.push({ rel, name, size: stat.size, mtimeMs, folderCompany });
      } catch {
        // Removed between readdir and stat.
      }
    };

    let entries;
    try {
      entries = await fsp.readdir(env.inputPath, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return found;
    }
    for (const entry of entries) {
      if (entry.isFile() && wanted(entry.name)) {
        await add(entry.name, entry.name, null);
      } else if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== ARCHIVE_DIR &&
        entry.name !== FAILED_DIR
      ) {
        const inner = await fsp.readdir(this.abs(entry.name), { withFileTypes: true });
        for (const file of inner) {
          if (file.isFile() && wanted(file.name)) {
            await add(`${entry.name}/${file.name}`, file.name, entry.name.trim());
          }
        }
      }
    }
    return found;
  }

  /**
   * Moves a source out of the way: `archive/<YYYY-MM-DD>/<rel>` or `failed/<rel>`,
   * keeping its company sub-folder and never overwriting (`_2`, `_3`, …).
   */
  private async moveSource(rel: string, into: string, dated: boolean): Promise<string> {
    const base = dated
      ? path.posix.join(into, new Date().toISOString().slice(0, 10), rel)
      : path.posix.join(into, rel);
    await this.ensureDir(path.posix.dirname(base));
    for (let n = 1; n < 1000; n++) {
      const target = withSuffix(base, n);
      try {
        await fsp.access(this.abs(target));
        continue; // taken
      } catch {
        await fsp.rename(this.abs(rel), this.abs(target));
        return target;
      }
    }
    throw new Error(`Too many files named ${base}`);
  }

  /** mkdir -p inside INPUT_DIR, handing every folder it creates to the host user. */
  private async ensureDir(rel: string): Promise<void> {
    let current = '';
    for (const part of rel.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      try {
        await fsp.mkdir(this.abs(current));
        await handToHostUser(this.abs(current));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }

  /** Absolute path inside INPUT_DIR; refuses anything that would escape it. */
  private abs(rel: string): string {
    const root = path.resolve(env.inputPath);
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new BadRequestException(`Path outside the input folder: ${rel}`);
    }
    return full;
  }

  private async find(id: string): Promise<InboxFile> {
    const record = await this.prisma.inboxFile.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('No such inbox file');
    return record;
  }
}

export function toEntry(r: InboxFile): InboxEntry {
  const format = SourceFormatIdSchema.safeParse(r.format);
  const known = SourceFormatIdSchema.safeParse(r.knownSource);
  const needs = r.needs.filter((n) => SourceNeedSchema.safeParse(n).success) as InboxEntry['needs'];
  const period =
    r.periodBegin && r.periodEnd
      ? { begin: isoDay(r.periodBegin), end: isoDay(r.periodEnd) }
      : null;
  return {
    id: r.id,
    path: r.path,
    name: r.name,
    status: r.status,
    format: format.success ? format.data : null,
    formatOptions: r.formatOptions.filter(
      (s) => SourceFormatIdSchema.safeParse(s).success,
    ) as InboxEntry['formatOptions'],
    company: r.company ?? r.folderCompany,
    companyOptions: r.companyOptions,
    unit: r.unit,
    units: r.units,
    period,
    suggestedPeriod:
      format.success && (period || needs.includes('period'))
        ? suggestedPeriod(format.data, r.name)
        : null,
    needs,
    knownSource: known.success ? known.data : null,
    error: r.error,
    outputs: r.outputs,
    archivedPath: r.archivedPath,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  };
}
