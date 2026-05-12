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
import { CreditMemosService } from './credit-memos.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class CMLineDto {
  @IsOptional() @IsUUID() item_id?: string;
  @IsString() description!: string;
  @IsNumber() @Min(0.0001) @Type(() => Number) quantity!: number;
  @IsNumber() @Min(0) @Type(() => Number) unit_price!: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) vat_rate?: number;
  @IsOptional() @IsUUID() revenue_account_id?: string;
}

class CreateCMDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsUUID() customer_id!: string;
  @IsOptional() @IsUUID() original_invoice_id?: string;
  @IsDateString() cm_date!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CMLineDto)
  lines!: CMLineDto[];
}

class ApplicationItemDto {
  @IsUUID() invoice_id!: string;
  @IsNumber() @Min(0.01) @Type(() => Number) amount_applied!: number;
}

class ApplyDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ApplicationItemDto)
  applications!: ApplicationItemDto[];
}

class CancelDto {
  @IsString() reason!: string;
}

@ApiTags('ar-credit-memos')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('ar/credit-memos')
export class CreditMemosController {
  constructor(private readonly svc: CreditMemosService) {}

  @Get()
  @RequirePermissions('ar.credit_memo.view')
  list(
    @Query('company_id') companyId: string,
    @Query('status') status?: string,
    @Query('customer_id') customerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(companyId, {
      status, customer_id: customerId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('ar.credit_memo.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  @RequirePermissions('ar.credit_memo.create')
  create(@Body() dto: CreateCMDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.credit_memo.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.submitForApproval(id, user.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.credit_memo.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.approve(id, user.id);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.credit_memo.create')
  apply(@Param('id') id: string, @Body() dto: ApplyDto, @CurrentUser() user: AuthUser) {
    return this.svc.apply(id, dto as any, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ar.credit_memo.create')
  cancel(@Param('id') id: string, @Body() dto: CancelDto, @CurrentUser() user: AuthUser) {
    return this.svc.cancel(id, user.id, dto.reason);
  }
}
