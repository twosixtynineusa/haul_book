import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.port);
  const logger = new Logger('Bootstrap');
  logger.log(`Haul Book API listening on http://localhost:${env.port}/api`);
  logger.log(`Converted files are saved to ${env.outputDirLabel} (${env.outputPath} in-container)`);
}

void bootstrap();
