import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CandlesModule } from './candles/candles.module';
import { StrategiesModule } from './strategies/strategies.module';

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
    CandlesModule,
    AuthModule,
    StrategiesModule,
  ],
})
export class AppModule {}
