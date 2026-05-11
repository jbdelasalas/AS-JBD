import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { AccountsService } from './accounts.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';
import type { AccountTypeCode } from '@perpet/shared';

class CreateAccountDto {
  @IsUUID() company_id!: string;
  @IsString() @MaxLength(20) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) account_type!: AccountTypeCode;
  @IsOptional() @IsUUID() parent_id?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() is_control?: boolean;
  @IsOptional() @IsString() description?: string;
}

@ApiTags('gl-accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('gl/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('gl.account.view')
  async list(
    @Query('company_id') companyId: string,
    @Query('active_only') activeOnly?: string,
    @Query('type') type?: AccountTypeCode,
  ) {
    return this.accounts.list(companyId, {
      activeOnly: activeOnly === 'true',
      type,
    });
  }

  @Get(':id')
  @RequirePermissions('gl.account.view')
  async get(@Param('id') id: string) {
    return this.accounts.findById(id);
  }

  @Post()
  @RequirePermissions('gl.account.manage')
  async create(@Body() dto: CreateAccountDto, @CurrentUser() user: AuthUser) {
    return this.accounts.create(dto, user.id);
  }
}
