import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { ConversionModule } from '../conversion/conversion.module';
import { InboxService } from './inbox.service';

/** The watched-folder logic, shared by the api (portal actions) and the worker (scans). */
@Module({
  imports: [CompaniesModule, ConversionModule],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
