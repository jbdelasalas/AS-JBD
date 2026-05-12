import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional,
  IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryReceiptsService } from './delivery-receipts.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class DRLineDto {
  @IsOptional() @IsUUID() so_line_id?: string;
  @IsUUID() item_id!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0.0001) @Type(() => Number) qty_delivered!: number;
}

class CreateDRDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsUUID() so_id!: string;
  @IsUUID() warehouse_id!: string;
  @IsDateString() delivery_date!: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DRLineDto)
  lines!: DRLineDto[];
}

@ApiTags('sales-delivery-receipts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('sales/delivery-receipts')
export class DeliveryReceiptsController {
  constructor(private readonly svc: DeliveryReceiptsService) {}

  @Get()
  @RequirePermissions('sales.delivery.view')
  list(
    @Query('company_id') companyId: string,
    @Query('so_id') soId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list(companyId, {
      so_id: soId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('sales.delivery.view')
  get(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  @RequirePermissions('sales.delivery.create')
  create(@Body() dto: CreateDRDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto as any, user.id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.delivery.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.post(id, user.id);
  }
}
