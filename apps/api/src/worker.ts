import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { env } from './config/env';
import { WorkerModule } from './worker.module';

/**
 * BullMQ worker entrypoint — the API's second process (same image; dev:
 * `npm run start:worker:dev`, prod: `node dist/worker.js`). A NestJS
 * application context with no HTTP server: it scans the watched input folder.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('WorkerBootstrap').log(
    `Haul Book worker started — input ${env.inputDirLabel}, output ${env.outputDirLabel}`,
  );
}

void bootstrap();
