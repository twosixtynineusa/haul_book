import { Controller, Get, Param, Query, Header, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { HistoryQuerySchema, type HistoryList, type TruckDetail } from '@haulbook/shared';
import { parseBody } from '../common/parse-body';
import { HistoryService } from './history.service';

/** `GET /api/v1/history` — every converted report, newest first (contracts in history.ts). */
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('companies/:id/report.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="company-mileage-report.pdf"')
  @Header('Cache-Control', 'no-store')
  async report(@Param('id') id: string, @Query() query: unknown): Promise<StreamableFile> {
    const date = z.iso.date();
    const period = parseBody(
      z
        .object({ from: date.optional(), to: date.optional() })
        .refine(
          (p) => !p.from || !p.to || p.from <= p.to,
          'The end date must be on or after the start date',
        ),
      query,
    );
    return new StreamableFile(await this.history.companyPdf(id, period));
  }

  @Get()
  list(@Query() query: unknown): Promise<HistoryList> {
    return this.history.list(parseBody(HistoryQuerySchema, query));
  }
}

/** `GET /api/v1/trucks/:id` — one truck with its company and conversion history. */
@Controller('trucks')
export class TrucksController {
  constructor(private readonly history: HistoryService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<TruckDetail> {
    return this.history.truck(id);
  }
}
