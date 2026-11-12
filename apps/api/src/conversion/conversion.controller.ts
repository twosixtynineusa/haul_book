import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Query,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { parseBody } from '../common/parse-body';
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  OdometerMapSchema,
  SourceChoicesSchema,
  HistoryQuerySchema,
  type ConversionPreview,
  type ConversionResult,
  type OdometerMap,
  type OutputList,
  type SourceChoice,
} from '@haulbook/shared';
import type { ZodType } from 'zod';
import type { UploadedFile } from './common';
import { ConversionService } from './conversion.service';

const uploads = FilesInterceptor('files', MAX_UPLOAD_FILES, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
});

interface ConversionBody {
  /** JSON array aligned with files[]: `[{ format?, company?, unit? }]` (SourceChoice). */
  sources?: string;
  /** JSON object: `{ [truckKey(company, unit)]: "<odometer>" }`. */
  odometers?: string;
}

function toUploads(files: Express.Multer.File[] | undefined): UploadedFile[] {
  if (!files?.length) throw new BadRequestException('Attach at least one source report');
  return files.map((f) => {
    const ext = f.originalname.slice(f.originalname.lastIndexOf('.')).toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(
        `${f.originalname}: only ${ACCEPTED_EXTENSIONS.join(', ')} files are accepted`,
      );
    }
    return { name: f.originalname, bytes: f.buffer };
  });
}

/** Parses a JSON form field against a schema, naming the first problem. */
function jsonField<T>(raw: string | undefined, schema: ZodType<T>, field: string, empty: T): T {
  if (!raw) return empty;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BadRequestException(`${field} must be valid JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Odometer keys are truckKey(company, unit): show them as "COMPANY unit 22".
    const at = issue.path.map((p) => String(p).replace('\u001f', ' unit ')).join('.');
    const where = at ? `${field}[${at}]: ` : '';
    throw new BadRequestException(`${where}${issue.message}`);
  }
  return parsed.data;
}

function toChoices(body: ConversionBody, fileCount: number): SourceChoice[] {
  const choices = jsonField(body.sources, SourceChoicesSchema, 'sources', []);
  if (choices.length > fileCount) {
    throw new BadRequestException('sources has more entries than there are files');
  }
  return choices;
}

function toOdometers(body: ConversionBody): OdometerMap {
  return jsonField(body.odometers, OdometerMapSchema, 'odometers', {});
}

/**
 * `POST /api/v1/conversions/preview` — detect, parse + validate only (nothing written).
 * `POST /api/v1/conversions` — convert and save one file per company into the output folder.
 */
@Controller('conversions')
export class ConversionController {
  constructor(private readonly conversions: ConversionService) {}

  @Post('preview')
  @HttpCode(200)
  @UseInterceptors(uploads)
  preview(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: ConversionBody,
  ): Promise<ConversionPreview> {
    const uploaded = toUploads(files);
    return this.conversions.preview(uploaded, toChoices(body, uploaded.length), toOdometers(body));
  }

  @Post()
  @UseInterceptors(uploads)
  convert(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: ConversionBody,
  ): Promise<ConversionResult> {
    const uploaded = toUploads(files);
    return this.conversions.convertAndSave(
      uploaded,
      toChoices(body, uploaded.length),
      toOdometers(body),
    );
  }
}

/**
 * `GET /api/v1/outputs` — the converted files in the output folder, newest first.
 * `GET /api/v1/outputs/:name` — download one.
 */
@Controller('outputs')
export class OutputsController {
  constructor(private readonly conversions: ConversionService) {}

  @Get()
  list(@Query() query: unknown): Promise<OutputList> {
    const parsed = parseBody(HistoryQuerySchema, query);
    return this.conversions.listOutputs(parsed.companyId, parsed.truckId);
  }

  @Get(':name')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.conversions.openOutput(name);
    // `name` passed OUTPUT_NAME_RE ([A-Za-z0-9._-]), so it is safe in the header.
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    return new StreamableFile(file.stream);
  }
}
