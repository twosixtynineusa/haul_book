import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  companyKey,
  promilesUnitOf,
  sourceFormat,
  truckKey,
  type ConversionPreview,
  type ConversionResult,
  type HistoryOrigin,
  type OdometerMap,
  type OutputFile,
  type OutputList,
  type Period,
  type SavedOutput,
  type SourceChoice,
  type SourceFile,
  type SourceFormatId,
  type SourceNeed,
  type TripSummary,
} from '@haulbook/shared';
import { CompaniesService, type RecordEntry } from '../companies/companies.service';
import { HistoryService, type HistoryRecord } from '../history/history.service';
import { handToHostUser } from '../common/host-files';
import { env } from '../config/env';
import { ConversionError, type SourceReport, type UploadedFile } from './common';
import { IMPORTERS, detectFormats } from './importers';
import { writeProMiles, type CompanyOutput, type TruckReport } from './promiles';

/** Names this service writes and is willing to serve back: no paths, no dotfiles. */
const OUTPUT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/;
const MAX_LISTED = 100;

function slug(value: string, max: number): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/**
 * `unit-22`, `units-22-25-30`, or `12-units` once there are too many to list: the unit #s
 * ProMiles got. When any differs from the truck # in the source, those follow:
 * `unit-2011_from-Volvo-01`, `units-2011-22_from-Volvo-01-Volvo-22`.
 */
function unitsLabel(units: string[], promilesUnits: string[] = units): string {
  const label = (list: string[]) => list.map((u) => slug(u, 20)).filter(Boolean);
  const ids = label(promilesUnits);
  if (ids.length === 0 || ids.length > 3) return `${units.length}-units`;
  const shown = `${ids.length === 1 ? 'unit' : 'units'}-${ids.join('-')}`;
  const mapped = promilesUnits.some((p, i) => p !== units[i]);
  return mapped ? `${shown}_from-${label(units).join('-')}` : shown;
}

/** `2026-10`, or `2026-10_to_2026-12` when the trips span several months. */
function periodLabel(trips: TripSummary[]): string {
  const months = trips.map((t) => {
    const [m, , y] = t.beginDate.split('/').map(Number);
    return `${y}-${String(m).padStart(2, '0')}`;
  });
  const first = months.reduce((a, b) => (b < a ? b : a));
  const last = months.reduce((a, b) => (b > a ? b : a));
  return first === last ? first : `${first}_to_${last}`;
}

/**
 * Company name + unit # + period, e.g. `ACME-TRUCKING-LLC_unit-22_2026-10`, or
 * `ACME-TRUCKING-LLC_unit-2011_from-Volvo-01_2026-10` for a truck ProMiles knows by another #.
 * One file per company: ProMiles imports a file under one customer.
 */
export function outputBaseName(
  output: Pick<CompanyOutput, 'company' | 'units' | 'trips'> &
    Partial<Pick<CompanyOutput, 'promilesUnits'>>,
): string {
  const company = slug(output.company, 60) || 'company';
  const units = unitsLabel(output.units, output.promilesUnits);
  return `${company}_${units}_${periodLabel(output.trips)}`;
}

/** A file ready to convert, with the source format it was read as. */
type ReadyReport = TruckReport & {
  format: SourceFormatId;
  /** The user confirmed this format as the company's new source. */
  confirmed: boolean;
};

interface Analysis {
  files: SourceFile[];
  ready: ReadyReport[];
  warnings: string[];
}

/** What a file was read as, kept until it's known whether it can convert. */
interface Read {
  report: SourceReport;
  warnings: string[];
}

/** Hints a caller has besides the user's choices: the input sub-folder's company. */
export interface FileHint {
  folderCompany?: string | null;
}

export interface ConvertOptions {
  hints?: FileHint[];
  /** Recorded in the conversion history. */
  origin?: HistoryOrigin;
  /**
   * A file with several trucks: convert only these unit #s (the input folder converting
   * a file again for the trucks deleted since; the others are still converted).
   */
  onlyUnits?: string[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const toPeriod = ([begin, end]: [Date, Date]): Period => ({
  begin: isoDay(begin),
  end: isoDay(end),
});
const fromPeriod = (p: Period): [Date, Date] => [
  new Date(`${p.begin}T00:00:00Z`),
  new Date(`${p.end}T00:00:00Z`),
];

@Injectable()
export class ConversionService implements OnModuleInit {
  private readonly logger = new Logger(ConversionService.name);

  constructor(
    private readonly companies: CompaniesService,
    private readonly history: HistoryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await fsp.mkdir(env.outputPath, { recursive: true });
  }

  async preview(
    files: UploadedFile[],
    choices: SourceChoice[],
    odometers: OdometerMap,
    options: ConvertOptions = {},
  ): Promise<ConversionPreview> {
    const { preview } = await this.plan(files, choices, odometers, options);
    return preview;
  }

  async convertAndSave(
    files: UploadedFile[],
    choices: SourceChoice[],
    odometers: OdometerMap,
    options: ConvertOptions = {},
  ): Promise<ConversionResult> {
    const { preview, outputs, ready } = await this.plan(files, choices, odometers, options);
    if (!preview.ready) throw new BadRequestException(describeProblems(preview));

    const saved: SavedOutput[] = [];
    const snapshots: { name: string; csv: string }[] = [];
    const history: HistoryRecord[] = [];
    for (const output of outputs) {
      const name = await this.writeUnique(outputBaseName(output), output.csv);
      snapshots.push({ name, csv: output.csv });
      saved.push({ ...(await this.describe(name)), company: output.company, units: output.units });
      history.push(...historyRecords(output, name, ready, options.origin ?? 'portal'));
      this.logger.log(`Saved ${name} (${output.trips.length} trip(s)) to ${env.outputDirLabel}`);
    }
    await this.companies.record(outputs.map((o) => recordEntry(o, ready)));
    await this.history.record(history, snapshots);
    return { ...preview, outputs: saved, outputDir: env.outputDirLabel };
  }

  /**
   * Undoes saved conversions (an input-folder row deleted or converted again): the history
   * rows these ProMiles files wrote go (HistoryService.forget), then the files themselves.
   * The only place an output file is ever deleted.
   */
  async forget(sourceFile: string, outputs: string[]): Promise<void> {
    await this.history.forget(sourceFile, outputs);
    for (const name of outputs) {
      try {
        await fsp.unlink(this.resolveOutput(name));
        this.logger.log(`Deleted ${name} from ${env.outputDirLabel}`);
      } catch (e) {
        // Already gone, or not a name this service writes.
        if (!(e instanceof NotFoundException) && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw e;
        }
      }
    }
  }

  async listOutputs(companyId?: string, truckId?: string): Promise<OutputList> {
    const stored = await this.history.storedOutputs(companyId, truckId);
    if (companyId || truckId)
      return {
        outputDir: env.outputDirLabel,
        files: stored.map((o) => ({
          name: o.name,
          size: Buffer.byteLength(o.csv),
          createdAt: o.createdAt.toISOString(),
        })),
      };
    let names: string[] = [];
    try {
      names = (await fsp.readdir(env.outputPath)).filter((n) => OUTPUT_NAME_RE.test(n));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const files = await Promise.all(
      names.filter((n) => !stored.some((o) => o.name === n)).map((n) => this.describe(n)),
    );
    files.push(
      ...stored.map((o) => ({
        name: o.name,
        size: Buffer.byteLength(o.csv),
        createdAt: o.createdAt.toISOString(),
      })),
    );
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
    return { outputDir: env.outputDirLabel, files: files.slice(0, MAX_LISTED) };
  }

  /** Opens a converted file for download. Only plain `*.csv` names inside the output folder. */
  async openOutput(name: string): Promise<{ name: string; stream: Readable }> {
    const filePath = this.resolveOutput(name);
    const stored = await this.history.storedOutput(name);
    if (stored) return { name, stream: Readable.from([stored.csv]) };
    try {
      await fsp.access(filePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(`No converted file named ${name}`);
    }
    return { name, stream: fs.createReadStream(filePath) };
  }

  /** Analyse every file, then build the ProMiles output from the ones that are ready. */
  private async plan(
    files: UploadedFile[],
    choices: SourceChoice[],
    odometers: OdometerMap,
    options: ConvertOptions,
  ) {
    const analysis = await this.analyze(files, choices, options.hints ?? [], options.onlyUnits);
    const errors: string[] = [];
    let outputs: CompanyOutput[] = [];
    let trips: TripSummary[] = [];
    let savedOdometers: ConversionPreview['savedOdometers'] = {};
    const warnings = [...analysis.warnings];

    if (analysis.ready.length > 0) {
      const saved = await this.companies.savedOdometers(analysis.ready);
      try {
        const written = writeProMiles(analysis.ready, odometers, saved);
        outputs = written.outputs;
        trips = written.trips;
        savedOdometers = written.savedUsed;
        warnings.push(...written.warnings);
      } catch (e) {
        if (!(e instanceof ConversionError)) throw e;
        errors.push(e.message);
      }
    }

    const allFilesReady = analysis.files.every((f) => f.needs.length === 0 && !f.error);
    const preview: ConversionPreview = {
      files: analysis.files,
      trips,
      warnings,
      errors,
      ready: allFilesReady && errors.length === 0 && outputs.length > 0,
      savedOdometers,
    };
    return { preview, outputs, ready: analysis.ready };
  }

  /**
   * Per file:
   * - format = the user's pick, else auto-detected, else (nothing recognises it) the
   *   approved source of the company it belongs to, when that source can read it;
   * - the importer reads it; company = the user's entry, else the file's, else the input
   *   sub-folder's, else the one saved company running its unit #(s) — several such
   *   companies, and the user picks; unit # = the user's entry, else the file's;
   * - a layout several sources share takes the company's approved source when that's one
   *   of them, else the user picks;
   * - a file with no dates of its own waits for the user's period;
   * - a company's file in a format other than its approved source waits until the user
   *   confirms the switch (`confirmSource`). A company with none yet takes the format of
   *   its first file in the upload.
   * A file holding several trucks (Motive) gives one ready report per truck, unit #s from
   * the file (only those in `onlyUnits`, when given).
   */
  private async analyze(
    files: UploadedFile[],
    choices: SourceChoice[],
    hints: FileHint[],
    onlyUnits?: string[],
  ): Promise<Analysis> {
    const sources: SourceFile[] = [];
    /** Aligned with `sources`: what was read, for the files that could be read. */
    const reads: (Read | null)[] = [];

    const named = [...choices.map((c) => c.company), ...hints.map((h) => h.folderCompany)].filter(
      (c): c is string => !!c?.trim(),
    );
    const known = await this.companies.canonicalNames(named);
    // Reuse the saved spelling so "acme trucking" doesn't become a second company.
    const canonical = (name: string) => known.get(companyKey(name)) ?? name.trim();

    for (const [i, file] of files.entries()) {
      const choice = choices[i] ?? {};
      const candidates = choice.format ? [] : detectFormats(file);
      const format = choice.format ?? (candidates.length === 1 ? candidates[0] : null);
      const source: SourceFile = {
        name: file.name,
        format,
        formatDetected: !choice.format && format !== null,
        formatOptions: candidates.length > 1 ? candidates : [],
        company: choice.company ? canonical(choice.company) : null,
        companyOrigin: choice.company ? 'user' : null,
        companyOptions: [],
        unit: choice.unit?.trim() ?? null,
        unitDetected: false,
        units: [],
        period: null,
        suggestedPeriod: null,
        promilesUnits: {},
        newTrucks: [],
        needs: [],
        knownSource: null,
        error: null,
      };
      sources.push(source);
      reads.push(null);

      // Nothing recognises it: the company's approved source may still read it (below).
      if (!format && candidates.length === 0) continue;
      // Several sources share this layout: read it to learn the company; which source it
      // is gets settled below.
      const reader = format ?? candidates[0];
      if (!sourceFormat(reader).available) {
        source.error = `${sourceFormat(reader).label} files can't be converted yet — that importer is still to be built.`;
        continue;
      }
      reads[i] = this.read(file, reader, choice, source);
    }

    this.fromFolders(sources, hints, canonical);
    // Detected company names also snap to the saved spelling.
    const detected = sources.filter((s) => s.companyOrigin === 'file').map((s) => s.company!);
    if (detected.length > 0) {
      const more = await this.companies.canonicalNames(detected);
      for (const s of sources.filter((x) => x.companyOrigin === 'file')) {
        s.company = more.get(companyKey(s.company!)) ?? s.company;
      }
    }
    await this.fromUnits(sources);

    const approved = await this.companies.approvedSources(
      sources.filter((s) => s.company).map((s) => s.company!),
    );
    const approvedOf = (s: SourceFile) =>
      s.company ? (approved.get(companyKey(s.company)) ?? null) : null;

    // Not recognised: try the company's approved source, when it's a different importer.
    for (const [i, s] of sources.entries()) {
      const source = approvedOf(s);
      if (reads[i] || s.error || s.format || s.formatOptions.length > 0) continue;
      if (!source || !sourceFormat(source).available) continue;
      const attempt = { ...s };
      const read = this.read(files[i], source, choices[i] ?? {}, attempt);
      if (!read) continue; // It isn't that format either: the user picks.
      Object.assign(s, attempt, { format: source, formatDetected: true });
      reads[i] = read;
    }

    for (const [i, s] of sources.entries()) {
      if (!reads[i] && !s.error && !s.format && s.formatOptions.length === 0) {
        s.needs.push('format');
      }
      if (!reads[i]) continue;
      // A layout several sources share: the company's approved source decides, when it's
      // one of them; otherwise the user picks.
      if (!s.format && s.formatOptions.length > 0) {
        const source = approvedOf(s);
        if (source && s.formatOptions.includes(source)) {
          s.format = source;
          s.formatDetected = true;
          s.formatOptions = [];
        } else {
          s.formatDetected = false;
          s.needs.push('format');
        }
      }
      if (!s.company) s.needs.push('company');
      if (!s.unit && s.units.length === 0) s.needs.push('unit');
      if (reads[i]!.report.needsPeriod) s.needs.push('period');
    }

    // Owners switch ELD providers: a file in a format other than the company's approved
    // source waits. A company with none yet: its first file in this upload sets it.
    const firstFormat = new Map<string, SourceFormatId>();
    for (const [i, s] of sources.entries()) {
      if (!reads[i] || !s.format || !s.company) continue;
      const key = companyKey(s.company);
      const source = approved.get(key) ?? firstFormat.get(key);
      if (!source) {
        firstFormat.set(key, s.format);
        continue;
      }
      if (source === s.format || choices[i]?.confirmSource) continue;
      s.needs.push('source');
      s.knownSource = source;
    }

    await this.toProMilesUnits(sources, reads, choices, onlyUnits);

    const warnings: string[] = [];
    const ready: ReadyReport[] = [];
    for (const [i, s] of sources.entries()) {
      const read = reads[i];
      if (!read || s.needs.length > 0) continue;
      warnings.push(...read.warnings);
      const trucks = read.report.trucks
        ? read.report.trucks.filter((t) => !onlyUnits || onlyUnits.includes(t.unit))
        : [{ unit: s.unit!, trips: read.report.trips }];
      for (const truck of trucks) {
        ready.push({
          company: s.company!,
          unit: truck.unit,
          promilesUnit: s.promilesUnits[truck.unit] ?? truck.unit,
          sourceFile: s.name,
          format: s.format!,
          confirmed: !!choices[i]?.confirmSource,
          report: {
            ...read.report,
            trips: truck.trips,
            detectedUnit: truck.unit,
            trucks: undefined,
          },
        });
      }
    }
    return { files: sources, ready, warnings };
  }

  /**
   * Reads one file as `format` into `source` (its company, unit #s, period); null with
   * `source.error` set when the importer refuses it.
   */
  private read(
    file: UploadedFile,
    format: SourceFormatId,
    choice: SourceChoice,
    source: SourceFile,
  ): Read | null {
    const warnings: string[] = [];
    let report: SourceReport;
    try {
      report = IMPORTERS[format].read(file, warnings, {
        ...(choice.period ? { period: fromPeriod(choice.period) } : {}),
      });
    } catch (e) {
      if (!(e instanceof ConversionError)) throw e;
      source.error = e.message;
      return null;
    }

    if (!source.company && report.detectedCompany) {
      source.company = report.detectedCompany;
      source.companyOrigin = 'file';
    }
    if (report.trucks) {
      // Several trucks: each unit # comes from the file; one typed for the file can't apply.
      source.units = report.trucks.map((t) => t.unit);
      source.unit = null;
      source.unitDetected = true;
    } else if (!source.unit && report.detectedUnit) {
      source.unit = report.detectedUnit;
      source.unitDetected = true;
    }
    if (report.suggestedPeriod !== undefined) {
      source.suggestedPeriod = report.suggestedPeriod && toPeriod(report.suggestedPeriod);
      source.period = choice.period && !report.needsPeriod ? choice.period : null;
    }
    return { report, warnings };
  }

  /**
   * Once a file's company is known: the unit # ProMiles gets for each of its trucks. The
   * user's entry (`promilesUnits`) wins, else the saved truck's own; a truck not saved yet
   * waits for the user to confirm one (`needs: promilesUnit`, `newTrucks`), and so does one
   * whose ProMiles unit # another truck of the company already has (in the saved list or
   * this upload): two vehicles' miles must never land on one ProMiles unit.
   */
  private async toProMilesUnits(
    sources: SourceFile[],
    reads: (Read | null)[],
    choices: SourceChoice[],
    onlyUnits?: string[],
  ): Promise<void> {
    const open = sources.filter((s, i) => reads[i] && s.company && !s.error);
    const saved = await this.companies.trucksOf(open.map((s) => s.company!));
    /** Per company: ProMiles unit # → the truck # it belongs to, saved trucks first. */
    const taken = new Map<string, Map<string, string>>();
    const takenBy = (company: string) => {
      const key = companyKey(company);
      if (!taken.has(key)) {
        const own = saved.get(key) ?? [];
        taken.set(key, new Map(own.map((t) => [promilesUnitOf(t), t.unit])));
      }
      return taken.get(key)!;
    };

    for (const [i, s] of sources.entries()) {
      if (!open.includes(s)) continue;
      const units = (s.units.length > 0 ? s.units : s.unit ? [s.unit] : []).filter(
        (u) => !onlyUnits || onlyUnits.includes(u),
      );
      const own = new Map((saved.get(companyKey(s.company!)) ?? []).map((t) => [t.unit, t]));
      const entered = choices[i]?.promilesUnits ?? {};
      const used = takenBy(s.company!);
      const clashes: string[] = [];
      for (const unit of units) {
        const truck = own.get(unit);
        const promiles = entered[unit]?.trim() || (truck ? promilesUnitOf(truck) : unit);
        s.promilesUnits[unit] = promiles;
        if (!entered[unit] && !truck) s.newTrucks.push(unit);
        const holder = used.get(promiles);
        if (holder !== undefined && holder !== unit) {
          clashes.push(`${promiles} is already truck ${holder}'s`);
          if (!s.newTrucks.includes(unit)) s.newTrucks.push(unit);
        } else {
          // This truck's old ProMiles unit # is free again.
          for (const [p, u] of used) if (u === unit) used.delete(p);
          used.set(promiles, unit);
        }
      }
      if (s.newTrucks.length > 0) s.needs.push('promilesUnit');
      if (clashes.length > 0) {
        s.error =
          `${s.company} can't send two trucks to ProMiles as one unit #: ${clashes.join(', ')}. ` +
          `Give ${clashes.length === 1 ? 'this truck' : 'these trucks'} another ProMiles unit #.`;
      }
    }
  }

  /**
   * No company typed or in the file: the input sub-folder it was dropped in. A file nothing
   * recognises gets it too, so the company's approved source can be tried on it.
   */
  private fromFolders(
    sources: SourceFile[],
    hints: FileHint[],
    canonical: (name: string) => string,
  ): void {
    for (const [i, s] of sources.entries()) {
      const folder = hints[i]?.folderCompany?.trim();
      if (s.company || !folder || s.error) continue;
      s.company = canonical(folder);
      s.companyOrigin = 'folder';
    }
  }

  /**
   * Still no company: the saved company running the file's unit # (each of them, for a
   * file with several trucks; a typed one for a file nothing recognises). One → it;
   * several → the user picks among them.
   */
  private async fromUnits(sources: SourceFile[]): Promise<void> {
    const unitsOf = (s: SourceFile) => (s.units.length > 0 ? s.units : s.unit ? [s.unit] : []);
    const open = sources.filter((s) => !s.company && !s.error && unitsOf(s).length > 0);
    if (open.length === 0) return;
    const owners = await this.companies.ownersOfUnits(open.flatMap(unitsOf));
    for (const s of open) {
      const [first, ...rest] = unitsOf(s).map((u) => owners.get(u) ?? []);
      const common = first.filter((name) => rest.every((names) => names.includes(name)));
      if (common.length === 1) {
        s.company = common[0];
        s.companyOrigin = 'unit';
      } else if (common.length > 1) {
        s.companyOptions = common;
      }
    }
  }

  private resolveOutput(name: string): string {
    if (!OUTPUT_NAME_RE.test(name)) throw new NotFoundException(`No converted file named ${name}`);
    // The regex already forbids separators; the containment check is belt-and-braces.
    const root = path.resolve(env.outputPath);
    const filePath = path.resolve(root, name);
    if (path.dirname(filePath) !== root) {
      throw new NotFoundException(`No converted file named ${name}`);
    }
    return filePath;
  }

  /** Never overwrites: a re-run of the same company/unit/month gets `_2`, `_3`, … */
  private async writeUnique(base: string, csv: string): Promise<string> {
    await fsp.mkdir(env.outputPath, { recursive: true });
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? `${base}.csv` : `${base}_${n}.csv`;
      if (await this.history.storedOutput(name)) continue;
      const filePath = this.resolveOutput(name);
      try {
        await fsp.writeFile(filePath, csv, { encoding: 'utf8', flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw e;
      }
      await handToHostUser(filePath);
      return name;
    }
    throw new BadRequestException(
      `Too many files named ${base}_N.csv; clear out the output folder`,
    );
  }

  private async describe(name: string): Promise<OutputFile> {
    const stat = await fsp.stat(this.resolveOutput(name));
    return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
  }
}

const NEED_TEXT: Record<SourceNeed, string> = {
  format: 'pick its source format',
  company: 'enter the company name',
  unit: 'enter the truck #',
  period: 'enter the dates it covers',
  source: "confirm converting it from a source other than the company's approved one",
  promilesUnit: 'confirm the unit # ProMiles gets for each new truck',
};

/** One readable 400 message for everything blocking a conversion. */
function describeProblems(preview: ConversionPreview): string {
  const problems = [
    ...preview.files.flatMap((f) => [
      ...(f.error ? [f.error] : []),
      ...(f.needs.length ? [`${f.name}: ${f.needs.map((n) => NEED_TEXT[n]).join(', ')}`] : []),
    ]),
    ...preview.errors,
  ];
  return problems.length > 0 ? problems.join(' · ') : 'Nothing to convert';
}

/** M/D/YYYY (as written to ProMiles) → a UTC date. */
function usDate(value: string): Date {
  const [m, d, y] = value.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * What a saved company file teaches the company list: its trucks and their end
 * odometers, the format converted (now its approved source: a confirmed switch wins),
 * and each truck's source and latest trip end.
 */
function recordEntry(output: CompanyOutput, ready: ReadyReport[]): RecordEntry {
  const mine = ready.filter((r) => companyKey(r.company) === companyKey(output.company));
  const formatOf = new Map(mine.map((r) => [truckKey(r.company, r.unit), r.format]));
  const latest = new Map<string, { unit: string; source: SourceFormatId; periodEnd: Date }>();
  for (const trip of output.trips) {
    const key = truckKey(trip.company, trip.unit);
    const end = usDate(trip.endDate);
    const seen = latest.get(key);
    if (!seen || end > seen.periodEnd) {
      latest.set(key, { unit: trip.unit, source: formatOf.get(key)!, periodEnd: end });
    }
  }
  const confirmed = mine.filter((r) => r.confirmed);
  return {
    company: output.company,
    units: output.units,
    promilesUnits: Object.fromEntries(output.units.map((u, i) => [u, output.promilesUnits[i]])),
    odometers: output.odometers,
    source: (confirmed[confirmed.length - 1] ?? mine[0])?.format,
    activity: [...latest.values()],
  };
}

/** M/D/YYYY → YYYY-MM-DD. */
function isoOf(value: string): string {
  return isoDay(usDate(value));
}

/**
 * The history rows for one saved company file: one per truck per source file, each with
 * its trips. A trip's end odometer is the file's own, else Begin Odo + its miles; neither
 * is known when Begin Odo was the placeholder.
 */
function historyRecords(
  output: CompanyOutput,
  outputFile: string,
  ready: ReadyReport[],
  origin: HistoryOrigin,
): HistoryRecord[] {
  const groups = new Map<string, TripSummary[]>();
  for (const trip of output.trips) {
    const key = `${truckKey(trip.company, trip.unit)}\u001f${trip.sourceFile}`;
    groups.set(key, [...(groups.get(key) ?? []), trip]);
  }
  return [...groups.values()].map((trips) => {
    const { company, unit, promilesUnit, sourceFile, distanceUnit } = trips[0];
    const report = ready.find(
      (r) =>
        companyKey(r.company) === companyKey(company) &&
        r.unit === unit &&
        r.sourceFile === sourceFile,
    )!;
    return {
      company,
      unit,
      promilesUnit,
      origin,
      source: report.format,
      sourceFile,
      outputFile,
      distanceUnit,
      trips: trips.map((t) => {
        const begin = t.beginOdoIsPlaceholder ? null : t.beginOdo;
        const end =
          t.fileOdometer && t.fileOdometer.begin === begin
            ? t.fileOdometer.end
            : begin === null
              ? null
              : String(Math.round((Number(begin) + t.totalDistance) * 10) / 10);
        return {
          beginDate: isoOf(t.beginDate),
          endDate: isoOf(t.endDate),
          beginOdo: begin,
          endOdo: end,
          distance: t.totalDistance,
          states: t.states,
        };
      }),
    };
  });
}
