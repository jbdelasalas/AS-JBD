import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { DeliveryReceiptsController } from './delivery-receipts.controller';
import { DeliveryReceiptsService } from './delivery-receipts.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [SalesOrdersController, DeliveryReceiptsController],
  providers: [SalesOrdersService, DeliveryReceiptsService],
  exports: [SalesOrdersService],
})
export class SalesModule {}
