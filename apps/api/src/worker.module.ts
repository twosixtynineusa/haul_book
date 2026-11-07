import { Module } from '@nestjs/common';
import { InboxModule } from './inbox/inbox.module';
import { InboxProcessor } from './inbox/inbox.processor';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';

/**
 * Module graph for the worker process (no HTTP server): the BullMQ processor
 * that scans the watched input folder and auto-converts what it finds. The active
 * BullMQ worker connection keeps the process alive.
 */
@Module({
  imports: [PrismaModule, QueueModule, InboxModule],
  providers: [InboxProcessor],
})
export class WorkerModule {}
