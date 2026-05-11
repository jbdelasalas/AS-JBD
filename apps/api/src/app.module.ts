import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { GlModule } from './modules/gl/gl.module';
import { ArModule } from './modules/ar/ar.module';
import { ApModule } from './modules/ap/ap.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FuelModule } from './modules/fuel/fuel.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BirModule } from './modules/bir/bir.module';
import { CommonModule } from './modules/common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        // Supabase / Railway / Render typically provide DATABASE_URL.
        // Local dev uses individual DB_* vars from .env.
        const url = cfg.get<string>('DATABASE_URL');
        const isProd = cfg.get('NODE_ENV') === 'production';

        if (url) {
          return {
            type: 'postgres' as const,
            url,
            ssl: isProd ? { rejectUnauthorized: false } : false,
            autoLoadEntities: true,
            synchronize: false,
            logging: isProd ? ['error'] : ['error', 'warn'],
          };
        }

        return {
          type: 'postgres' as const,
          host: cfg.get('DB_HOST', 'localhost'),
          port: parseInt(cfg.get('DB_PORT', '5432'), 10),
          username: cfg.get('DB_USER', 'postgres'),
          password: cfg.get('DB_PASSWORD', 'postgres'),
          database: cfg.get('DB_NAME', 'perpet_erp'),
          autoLoadEntities: true,
          synchronize: false,
          logging: cfg.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        };
      },
    }),
    CommonModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    GlModule,
    ArModule,
    ApModule,
    SalesModule,
    PurchasingModule,
    InventoryModule,
    FuelModule,
    ReportsModule,
    BirModule,
  ],
})
export class AppModule {}
