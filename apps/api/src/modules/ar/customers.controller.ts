import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomersService } from './customers.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class CreateCustomerDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['wholesale','retail','fleet','gov']) customer_type?: string;
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contact_person?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) payment_terms_days?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) credit_limit?: number;
  @IsOptional() @IsBoolean() is_vat_exempt?: boolean;
  @IsOptional() @IsUUID() ar_account_id?: string;
}

class UpdateCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(['wholesale','retail','fleet','gov']) customer_type?: string;
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contact_person?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) payment_terms_days?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) credit_limit?: number;
  @IsOptional() @IsBoolean() is_vat_exempt?: boolean;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsUUID() ar_account_id?: string;
}

@ApiTags('ar-customers')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('ar/customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  @RequirePermissions('ar.customer.view')
  list(
    @Query('company_id') companyId: string,
    @Query('search') search?: string,
    @Query('is_active') isActive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(companyId, {
      search,
      is_active: isActive !== undefined ? isActive === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('ar.customer.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Get(':id/outstanding')
  @RequirePermissions('ar.customer.view')
  outstanding(@Param('id') id: string) {
    return this.svc.getOutstandingInvoices(id);
  }

  @Get(':id/credit-check')
  @RequirePermissions('ar.customer.view')
  creditCheck(
    @Param('id') id: string,
    @Query('amount') amount: string,
  ) {
    return this.svc.checkCreditLimit(id, parseFloat(amount ?? '0'));
  }

  @Post()
  @RequirePermissions('ar.customer.create')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Patch(':id')
  @RequirePermissions('ar.customer.update')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.svc.update(id, dto as any, user.id);
  }
}
