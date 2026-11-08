import { Controller, Get, Param, Query } from '@nestjs/common';
import { HistoryQuerySchema, type HistoryList, type TruckDetail } from '@haulbook/shared';
import { parseBody } from '../common/parse-body';
import { HistoryService } from './history.service';

/** `GET /api/v1/history` — every converted report, newest first (contracts in history.ts). */
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

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
