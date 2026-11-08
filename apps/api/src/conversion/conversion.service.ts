import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  companyKey,
  sourceFormat,
  truckKey,
  type ConversionPreview,
  type ConversionResult,
  type OdometerMap,
  type OutputFile,
  type OutputList,
  type SavedOutput,
  type SourceChoice,
  type SourceFile,
  type SourceFormatId,
  type SourceNeed,
  type TripSummary,
} from '@haulbook/shared';
import { CompaniesService, type RecordEntry } from '../companies/companies.service';
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

/** `unit-22`, `units-22-25-30`, or `12-units` once there are too many to list. */
function unitsLabel(units: string[]): string {
  const ids = units.map((u) => slug(u, 20)).filter(Boolean);
  if (ids.length === 1) return `unit-${ids[0]}`;
  if (ids.length > 1 && ids.length <= 3) return `units-${ids.join('-')}`;
  return `${units.length}-units`;
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
 * Company name + unit # + period, e.g. `ACME-TRUCKING-LLC_unit-22_2026-10`.
 * One file per company: ProMiles imports a file under one customer.
 */
export function outputBaseName(output: Pick<CompanyOutput, 'company' | 'units' | 'trips'>): string {
  const company = slug(output.company, 60) || 'company';
  return `${company}_${unitsLabel(output.units)}_${periodLabel(output.trips)}`;
}

/** A file ready to convert, with the source format it was read as. */
type ReadyReport = TruckReport & { format: SourceFormatId };

interface Analysis {
  files: SourceFile[];
  ready: ReadyReport[];
  warnings: string[];
}

@Injectable()
export class ConversionService implements OnModuleInit {
  private readonly logger = new Logger(ConversionService.name);

  constructor(private readonly companies: CompaniesService) {}

  async onModuleInit(): Promise<void> {
    await fsp.mkdir(env.outputPath, { recursive: true });
  }

  async preview(
    files: UploadedFile[],
    choices: SourceChoice[],
    odometers: OdometerMap,
  ): Promise<ConversionPreview> {
    const { preview } = await this.plan(files, choices, odometers);
    return preview;
  }

  async convertAndSave(
    files: UploadedFile[],
    choices: SourceChoice[],
    odometers: OdometerMap,
  ): Promise<ConversionResult> {
    const { preview, outputs, ready } = await this.plan(files, choices, odometers);
    if (!preview.ready) throw new BadRequestException(describeProblems(preview));

    const saved: SavedOutput[] = [];
    for (const output of outputs) {
      const name = await this.writeUnique(outputBaseName(output), output.csv);
      saved.push({ ...(await this.describe(name)), company: output.company, units: output.units });
      this.logger.log(`Saved ${name} (${output.trips.length} trip(s)) to ${env.outputDirLabel}`);
    }
    await this.companies.record(outputs.map((o) => recordEntry(o, ready)));
    return { ...preview, outputs: saved, outputDir: env.outputDirLabel };
  }

  async listOutputs(): Promise<OutputList> {
    let names: string[] = [];
    try {
      names = (await fsp.readdir(env.outputPath)).filter((n) => OUTPUT_NAME_RE.test(n));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const files = await Promise.all(names.map((n) => this.describe(n)));
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
    return { outputDir: env.outputDirLabel, files: files.slice(0, MAX_LISTED) };
  }

  /** Opens a converted file for download. Only plain `*.csv` names inside the output folder. */
  async openOutput(name: string): Promise<{ name: string; stream: fs.ReadStream }> {
    const filePath = this.resolveOutput(name);
    try {
      await fsp.access(filePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(`No converted file named ${name}`);
    }
    return { name, stream: fs.createReadStream(filePath) };
  }

  /** Analyse every file, then build the ProMiles output from the ones that are ready. */
  private async plan(files: UploadedFile[], choices: SourceChoice[], odometers: OdometerMap) {
    const analysis = await this.analyze(files, choices);
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
   * Per file: format = the user's pick, else auto-detected; then the importer
   * reads it; company and unit = the user's entry, else what the file carries. A file
   * holding several trucks (Motive) gives one ready report per truck, unit #s from the file.
   * A saved company's file in a format it hasn't been converted from before waits
   * until the user confirms the switch (`confirmSource`).
   */
  private async analyze(files: UploadedFile[], choices: SourceChoice[]): Promise<Analysis> {
    const warnings: string[] = [];
    const sources: SourceFile[] = [];
    /** Aligned with `sources`: what was read, for the files that could be read. */
    const reports: ({ report: SourceReport; warnings: string[] } | null)[] = [];

    const typedCompanies = choices.map((c) => c.company).filter((c): c is string => !!c);
    const known = await this.companies.canonicalNames(typedCompanies);
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
        companyDetected: false,
        unit: choice.unit?.trim() ?? null,
        unitDetected: false,
        units: [],
        needs: [],
        knownSources: [],
        error: null,
      };
      sources.push(source);
      reports.push(null);

      if (!format && candidates.length <= 1) {
        source.needs.push('format');
        continue;
      }
      // Several sources share this layout: read it to learn the company; which source it
      // is gets settled below.
      const reader = format ?? candidates[0];
      if (!sourceFormat(reader).available) {
        source.error = `${sourceFormat(reader).label} files can't be converted yet — that importer is still to be built.`;
        continue;
      }

      const fileWarnings: string[] = [];
      let report;
      try {
        report = IMPORTERS[reader].read(file, fileWarnings);
      } catch (e) {
        if (!(e instanceof ConversionError)) throw e;
        source.error = e.message;
        continue;
      }
      reports[i] = { report, warnings: fileWarnings };

      if (!source.company && report.detectedCompany) {
        source.company = report.detectedCompany;
        source.companyDetected = true;
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
      if (!source.company) source.needs.push('company');
      if (!source.unit && source.units.length === 0) source.needs.push('unit');
    }

    // Detected company names also snap to the saved spelling.
    const detectedNames = sources.filter((s) => s.companyDetected).map((s) => s.company!);
    if (detectedNames.length > 0) {
      const more = await this.companies.canonicalNames(detectedNames);
      for (const s of sources.filter((x) => x.companyDetected)) {
        s.company = more.get(companyKey(s.company!)) ?? s.company;
      }
    }

    // Owners switch ELD providers: a known company's first file from a new source waits.
    const approved = await this.companies.approvedSources(
      sources.filter((s, i) => s.company && reports[i]).map((s) => s.company!),
    );
    // A layout several sources share: the one this company was converted from decides, when
    // it's exactly one of them; otherwise the user picks.
    for (const [i, s] of sources.entries()) {
      if (!reports[i] || s.format || s.formatOptions.length === 0) continue;
      const known = s.company ? (approved.get(companyKey(s.company)) ?? []) : [];
      const used = s.formatOptions.filter((f) => known.includes(f));
      if (used.length === 1) {
        s.format = used[0];
        s.formatDetected = true;
        s.formatOptions = [];
      } else {
        s.formatDetected = false;
        s.needs.unshift('format');
      }
    }
    for (const [i, s] of sources.entries()) {
      const known = s.company ? approved.get(companyKey(s.company)) : undefined;
      if (!reports[i] || !s.format || !known?.length || known.includes(s.format)) continue;
      if (choices[i]?.confirmSource) continue;
      s.needs.push('source');
      s.knownSources = known;
    }

    const ready: ReadyReport[] = [];
    for (const [i, s] of sources.entries()) {
      const read = reports[i];
      if (!read || s.needs.length > 0) continue;
      warnings.push(...read.warnings);
      const trucks = read.report.trucks ?? [{ unit: s.unit!, trips: read.report.trips }];
      for (const truck of trucks) {
        ready.push({
          company: s.company!,
          unit: truck.unit,
          sourceFile: s.name,
          format: s.format!,
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
  unit: 'enter the unit #',
  source: 'confirm converting it from a source new for this company',
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
 * odometers, the formats converted (now approved), and each truck's source and
 * latest trip end.
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
  return {
    company: output.company,
    units: output.units,
    odometers: output.odometers,
    sources: [...new Set(mine.map((r) => r.format))],
    activity: [...latest.values()],
  };
}
