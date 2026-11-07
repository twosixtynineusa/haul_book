import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SourceChoiceSchema, type InboxEntry, type InboxList } from '@haulbook/shared';
import { parseBody } from '../common/parse-body';
import { INBOX_QUEUE, QueueModule, SCAN_JOB } from '../queue/queue.module';
import { InboxModule } from './inbox.module';
import { InboxService } from './inbox.service';

/**
 * `GET /api/v1/inbox` — files in the watched input folder that need attention,
 * plus the latest ones processed. The other routes act on one waiting file.
 */
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    @InjectQueue(INBOX_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  list(): Promise<InboxList> {
    return this.inbox.list();
  }

  /** Fill in format / company / unit # and convert now. */
  @Patch(':id')
  resolve(@Param('id') id: string, @Body() body: unknown): Promise<InboxEntry> {
    return this.inbox.resolve(id, parseBody(SourceChoiceSchema, body));
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string): Promise<InboxEntry> {
    return this.inbox.retry(id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id') id: string): Promise<InboxEntry> {
    return this.inbox.dismiss(id);
  }

  /** Ask the worker to scan now instead of waiting for the next tick. */
  @Post('scan')
  @HttpCode(202)
  async scan(): Promise<{ queued: true }> {
    await this.queue.add(SCAN_JOB, {}, { removeOnComplete: true, removeOnFail: 50 });
    return { queued: true };
  }
}

/** HTTP side of the inbox (api process only; the worker imports InboxModule directly). */
@Module({
  imports: [InboxModule, QueueModule],
  controllers: [InboxController],
})
export class InboxHttpModule {}
