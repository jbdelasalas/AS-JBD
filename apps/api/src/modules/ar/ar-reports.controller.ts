import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ARReportsService } from './ar-reports.service';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

@ApiTags('ar-reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('ar/reports')
export class ARReportsController {
  constructor(private readonly svc: ARReportsService) {}

  @Get('summary')
  @RequirePermissions('reports.view')
  summary(@Query('company_id') companyId: string) {
    return this.svc.getSummary(companyId);
  }

  @Get('aging')
  @RequirePermissions('reports.view')
  aging(
    @Query('company_id') companyId: string,
    @Query('as_of_date') asOfDate?: string,
  ) {
    return this.svc.getAgingReport(companyId, asOfDate);
  }

  @Get('sales-register')
  @RequirePermissions('reports.view')
  salesRegister(
    @Query('company_id') companyId: string,
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
  ) {
    return this.svc.getSalesRegister(companyId, fromDate, toDate);
  }

  @Get('vat')
  @RequirePermissions('reports.view')
  vat(
    @Query('company_id') companyId: string,
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
  ) {
    return this.svc.getVATReport(companyId, fromDate, toDate);
  }

  @Get('collections')
  @RequirePermissions('reports.view')
  collections(
    @Query('company_id') companyId: string,
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
  ) {
    return this.svc.getCollectionReport(companyId, fromDate, toDate);
  }

  @Get('customer-ledger')
  @RequirePermissions('reports.view')
  customerLedger(
    @Query('company_id') companyId: string,
    @Query('customer_id') customerId: string,
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
  ) {
    return this.svc.getCustomerLedger(companyId, customerId, fromDate, toDate);
  }
}
