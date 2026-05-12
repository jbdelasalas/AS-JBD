import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreditMemosController } from './credit-memos.controller';
import { CreditMemosService } from './credit-memos.service';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { ARReportsController } from './ar-reports.controller';
import { ARReportsService } from './ar-reports.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [
    CustomersController,
    SalesInvoicesController,
    CreditMemosController,
    CollectionsController,
    ARReportsController,
  ],
  providers: [
    CustomersService,
    SalesInvoicesService,
    CreditMemosService,
    CollectionsService,
    ARReportsService,
  ],
  exports: [CustomersService, SalesInvoicesService],
})
export class ArModule {}
