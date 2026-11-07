import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { env } from '../config/env';

/** The BullMQ queue the worker drains: input-folder scans (repeatable + on demand). */
export const INBOX_QUEUE = 'inbox';
export const SCAN_JOB = 'scan';

/** BullMQ Redis connection derived from REDIS_URL (redis://[user:pass@]host:port[/db]). */
function redisConnection() {
  const url = new URL(env.redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    // Required by BullMQ for blocking worker connections.
    maxRetriesPerRequest: null,
  };
}

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: INBOX_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
