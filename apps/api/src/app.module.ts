import { Module } from '@nestjs/common';
import { CompaniesModule } from './companies/companies.module';
import { ConversionModule } from './conversion/conversion.module';
import { HealthModule } from './health/health.module';
import { InboxHttpModule } from './inbox/inbox.controller';
import { PrismaModule } from './prisma/prisma.module';

/**
 * HTTP API module graph: public health endpoint, the saved company/unit list
 * (Postgres via Prisma), source report → ProMiles conversion, and the inbox of
 * files found in the watched input folder (scanned by the worker, see worker.ts).
 */
@Module({
  imports: [PrismaModule, HealthModule, CompaniesModule, ConversionModule, InboxHttpModule],
})
export class AppModule {}
