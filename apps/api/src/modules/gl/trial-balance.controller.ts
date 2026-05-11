import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { TrialBalanceService } from './trial-balance.service';
import { PermissionsGuard, RequirePermissions } from '../common/permissions.guard';

@ApiTags('gl-reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('gl/reports')
export class TrialBalanceController {
  constructor(private readonly tb: TrialBalanceService) {}

  @Get('trial-balance')
  @RequirePermissions('reports.view')
  async trialBalance(@Query('company_id') companyId: string, @Query('as_of') asOf: string) {
    const rows = await this.tb.asOf(companyId, asOf);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    return {
      as_of: asOf,
      company_id: companyId,
      rows,
      total_debit: totalDebit,
      total_credit: totalCredit,
      is_balanced: Math.abs(totalDebit - totalCredit) < 0.0001,
    };
  }
}
