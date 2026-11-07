import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { ConversionController, OutputsController } from './conversion.controller';
import { ConversionService } from './conversion.service';

@Module({
  imports: [CompaniesModule],
  controllers: [ConversionController, OutputsController],
  providers: [ConversionService],
  exports: [ConversionService],
})
export class ConversionModule {}
