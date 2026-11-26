import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { Mt5Module } from './mt5/mt5.module';
import { StrategiesModule } from './strategies/strategies.module';
import { WorkbookReportModule } from './workbook-report/workbook-report.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST') ?? '127.0.0.1',
        port: Number(config.get<string>('DB_PORT') ?? 5433),
        username: config.get<string>('DB_USER') ?? 'traderlog',
        password: config.get<string>('DB_PASSWORD') ?? 'traderlog',
        database: config.get<string>('DB_NAME') ?? 'traderlog',
        autoLoadEntities: true,
        synchronize: config.get<string>('DB_SYNCHRONIZE') !== 'false',
      }),
    }),
    Mt5Module,
    AuthModule,
    StrategiesModule,
    WorkbookReportModule,
  ],
})
export class AppModule {}
