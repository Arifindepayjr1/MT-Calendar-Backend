import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Playbook } from './entities/playbook.entity';
import { StrategyDraft } from './entities/strategy-draft.entity';
import { StrategyRuleEntity } from './entities/strategy-rule.entity';
import { StrategyTradeEntity } from './entities/strategy-trade.entity';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Playbook,
      StrategyRuleEntity,
      StrategyTradeEntity,
      StrategyDraft,
    ]),
  ],
  controllers: [StrategiesController],
  providers: [StrategiesService, JwtAuthGuard],
})
export class StrategiesModule {}
