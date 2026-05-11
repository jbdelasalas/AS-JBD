import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { JournalEntriesService } from './journal-entries.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

class JournalLineDto {
  @IsUUID() account_id!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) debit?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) credit?: number;
}

class CreateJournalEntryDto {
  @IsUUID() company_id!: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsDateString() entry_date!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() memo?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

class VoidEntryDto {
  @IsString() reason!: string;
}

@ApiTags('gl-journal-entries')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('gl/journal-entries')
export class JournalEntriesController {
  constructor(private readonly entries: JournalEntriesService) {}

  @Get()
  @RequirePermissions('gl.journal.view')
  async list(
    @Query('company_id') companyId: string,
    @Query('status') status?: 'draft' | 'pending' | 'posted' | 'voided',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.entries.list(companyId, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('gl.journal.view')
  async get(@Param('id') id: string) {
    return this.entries.findById(id);
  }

  @Post()
  @RequirePermissions('gl.journal.create')
  async create(@Body() dto: CreateJournalEntryDto, @CurrentUser() user: AuthUser) {
    return this.entries.create(dto.company_id, dto, user.id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('gl.journal.post')
  async post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.entries.post(id, user.id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('gl.journal.void')
  async void(@Param('id') id: string, @Body() dto: VoidEntryDto, @CurrentUser() user: AuthUser) {
    return this.entries.void(id, user.id, dto.reason);
  }
}
