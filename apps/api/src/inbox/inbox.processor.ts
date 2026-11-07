import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { env } from '../config/env';
import { INBOX_QUEUE, SCAN_JOB } from '../queue/queue.module';
import { InboxService, type ScanSummary } from './inbox.service';

/**
 * Worker side: registers the repeatable scan (every INPUT_SCAN_SECONDS) on boot
 * and runs scans one at a time — concurrency 1, so two scans never overlap.
 */
@Processor(INBOX_QUEUE, { concurrency: 1 })
export class InboxProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(InboxProcessor.name);

  constructor(
    private readonly inbox: InboxService,
    @InjectQueue(INBOX_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'scan-input-folder',
      { every: env.inputScanSeconds * 1000 },
      { name: SCAN_JOB, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
    this.logger.log(`Watching ${env.inputDirLabel} every ${env.inputScanSeconds}s`);
  }

  async process(job: Job): Promise<ScanSummary | undefined> {
    if (job.name !== SCAN_JOB) return undefined;
    return this.inbox.scan();
  }
}
