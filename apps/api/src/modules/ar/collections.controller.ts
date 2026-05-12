import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber,
  IsOptional, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CollectionsService } from './collections.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class PaymentAppDto {
  @IsUUID() invoice_id!: string;
  @IsNumber() @Min(0.01) @Type(() => Number) amount_applied!: number;
}

class CreatePaymentDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsUUID() customer_id!: string;
  @IsDateString() payment_date!: string;
  @IsIn(['cash','check','bank_transfer','credit_card','online']) payment_method!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() bank_ref?: string;
  @IsOptional() @IsDateString() check_date?: string;
  @IsNumber() @Min(0.01) @Type(() => Number) amount!: number;
  @IsOptional() @IsUUID() bank_account_id?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() is_advance?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentAppDto)
  applications?: PaymentAppDto[];
}

class VoidDto {
  @IsString() reason!: string;
}

@ApiTags('ar-collections')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('ar/collections')
export class CollectionsController {
  constructor(private readonly svc: CollectionsService) {}

  @Get()
  @RequirePermissions('ar.payment.view')
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
  @RequirePermissions('ar.payment.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  @RequirePermissions('ar.payment.receive')
  create(@Body() dto: CreatePaymentDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.payment.receive')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.post(id, user.id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.payment.void')
  void(@Param('id') id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthUser) {
    return this.svc.void(id, user.id, dto.reason);
  }
}
