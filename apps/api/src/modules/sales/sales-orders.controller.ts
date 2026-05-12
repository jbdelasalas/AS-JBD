import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional,
  IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesOrdersService } from './sales-orders.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class SalesOrderLineDto {
  @IsUUID() item_id!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0.0001) @Type(() => Number) quantity!: number;
  @IsNumber() @Min(0) @Type(() => Number) unit_price!: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) discount_pct?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) vat_rate?: number;
}

class CreateSalesOrderDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsUUID() customer_id!: string;
  @IsDateString() order_date!: string;
  @IsOptional() @IsDateString() delivery_date?: string;
  @IsOptional() @IsUUID() warehouse_id?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) payment_terms_days?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) discount_pct?: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SalesOrderLineDto)
  lines!: SalesOrderLineDto[];
}

class ApproveDto {
  @IsOptional() @IsString() notes?: string;
}

class CancelDto {
  @IsString() reason!: string;
}

@ApiTags('sales-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('sales/orders')
export class SalesOrdersController {
  constructor(private readonly svc: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales.order.view')
  list(
    @Query('company_id') companyId: string,
    @Query('status') status?: string,
    @Query('customer_id') customerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(companyId, {
      status,
      customer_id: customerId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('sales.order.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  @RequirePermissions('sales.order.create')
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.order.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.submitForApproval(id, user.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.order.approve')
  approve(@Param('id') id: string, @Body() dto: ApproveDto, @CurrentUser() user: AuthUser) {
    return this.svc.approve(id, user.id, dto.notes);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.order.cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelDto, @CurrentUser() user: AuthUser) {
    return this.svc.cancel(id, user.id, dto.reason);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.order.approve')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.close(id, user.id);
  }
}
