import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString,
  IsUUID, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesInvoicesService } from './sales-invoices.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class InvoiceLineDto {
  @IsOptional() @IsUUID() item_id?: string;
  @IsString() description!: string;
  @IsNumber() @Min(0.0001) @Type(() => Number) quantity!: number;
  @IsNumber() @Min(0) @Type(() => Number) unit_price!: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) discount_pct?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) vat_rate?: number;
  @IsOptional() @IsUUID() revenue_account_id?: string;
}

class CreateInvoiceDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsUUID() customer_id!: string;
  @IsOptional() @IsUUID() so_id?: string;
  @IsOptional() @IsUUID() dr_id?: string;
  @IsDateString() invoice_date!: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) payment_terms_days?: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

class VoidDto {
  @IsString() reason!: string;
}

@ApiTags('ar-invoices')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('ar/invoices')
export class SalesInvoicesController {
  constructor(private readonly svc: SalesInvoicesService) {}

  @Get()
  @RequirePermissions('ar.invoice.view')
  list(
    @Query('company_id') companyId: string,
    @Query('status') status?: string,
    @Query('customer_id') customerId?: string,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(companyId, {
      status, customer_id: customerId, from_date: fromDate, to_date: toDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('ar.invoice.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  @RequirePermissions('ar.invoice.create')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.invoice.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.post(id, user.id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.invoice.void')
  void(@Param('id') id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthUser) {
    return this.svc.void(id, user.id, dto.reason);
  }

  @Post('update-overdue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.invoice.view')
  updateOverdue(@Query('company_id') companyId: string) {
    return this.svc.updateOverdueStatuses(companyId).then((n) => ({ updated: n }));
  }
}
