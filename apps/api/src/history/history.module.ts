import { Module } from '@nestjs/common';
import { HistoryController, TrucksController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  controllers: [HistoryController, TrucksController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
