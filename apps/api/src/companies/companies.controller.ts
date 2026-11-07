import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CompanyInputSchema,
  CompanyMergeSchema,
  CompanyUpdateSchema,
  TruckInputSchema,
  TruckUpdateSchema,
  type Company,
  type CompanyList,
} from '@haulbook/shared';
import { parseBody } from '../common/parse-body';
import { CompaniesService } from './companies.service';

/**
 * `/api/v1/companies` — the saved companies and their trucks: the pickers read
 * the list, the Companies tab edits it (contracts in @haulbook/shared companies.ts).
 */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(): Promise<CompanyList> {
    return this.companies.list();
  }

  @Post()
  create(@Body() body: unknown): Promise<Company> {
    return this.companies.create(parseBody(CompanyInputSchema, body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<Company> {
    return this.companies.update(id, parseBody(CompanyUpdateSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.companies.remove(id);
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @Body() body: unknown): Promise<Company> {
    return this.companies.merge(id, parseBody(CompanyMergeSchema, body).into);
  }

  @Post(':id/trucks')
  addTruck(@Param('id') id: string, @Body() body: unknown): Promise<Company> {
    return this.companies.addTruck(id, parseBody(TruckInputSchema, body));
  }

  @Patch(':id/trucks/:truckId')
  updateTruck(
    @Param('id') id: string,
    @Param('truckId') truckId: string,
    @Body() body: unknown,
  ): Promise<Company> {
    return this.companies.updateTruck(id, truckId, parseBody(TruckUpdateSchema, body));
  }

  @Delete(':id/trucks/:truckId')
  removeTruck(@Param('id') id: string, @Param('truckId') truckId: string): Promise<Company> {
    return this.companies.removeTruck(id, truckId);
  }
}
