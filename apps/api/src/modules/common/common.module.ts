import { Module, Global } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { HealthController } from './health.controller';

@Global()
@Module({
  controllers: [HealthController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class CommonModule {}
