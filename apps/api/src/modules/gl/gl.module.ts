import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { JournalEntriesController } from './journal-entries.controller';
import { TrialBalanceController } from './trial-balance.controller';
import { AccountsService } from './accounts.service';
import { JournalEntriesService } from './journal-entries.service';
import { TrialBalanceService } from './trial-balance.service';

@Module({
  controllers: [AccountsController, JournalEntriesController, TrialBalanceController],
  providers: [AccountsService, JournalEntriesService, TrialBalanceService],
  exports: [JournalEntriesService],
})
export class GlModule {}
