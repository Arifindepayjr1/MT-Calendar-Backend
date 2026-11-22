import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { STRATEGY_CATEGORIES, StrategyCategory } from '../strategy-category.enum';
import { StrategyRuleEntity } from './strategy-rule.entity';
import { StrategyTradeEntity } from './strategy-trade.entity';

/** A playbook card plus the detail metrics shown on its rulebook screen. */
@Entity('playbooks')
export class Playbook {
  /** Stable slug used by the Flutter client, e.g. pb_silver_bullet. */
  @PrimaryColumn({ type: 'varchar', length: 80 })
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: STRATEGY_CATEGORIES, default: 'other' })
  category: StrategyCategory;

  @Column({ type: 'boolean', default: false })
  primary: boolean;

  @Column({ type: 'int', default: 0 })
  adherence: number;

  @Column({ type: 'boolean', default: false })
  reviewNeeded: boolean;

  @Column({ type: 'boolean', default: false })
  favorite: boolean;

  @Column({ type: 'int', default: 0 })
  executions: number;

  @Column({ type: 'float', default: 0 })
  winRate: number;

  @Column({ type: 'float', default: 0 })
  avgR: number;

  @Column({ type: 'float', default: 0 })
  netPnl: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  badges: string[];

  @Column({ type: 'varchar', length: 120, default: 'Rulebook Ready' })
  statusLabel: string;

  @Column({ type: 'varchar', length: 120, default: 'MT5 Synced · sample data' })
  syncLabel: string;

  @Column({ type: 'int', default: 0 })
  grade: number;

  @Column({ type: 'varchar', length: 120, default: 'Any Session' })
  macroWindow: string;

  @Column({ type: 'float', default: 0 })
  netReturn: number;

  @Column({ type: 'float', default: 0 })
  netReturnPercent: number;

  @Column({ type: 'float', default: 0 })
  profitFactor: number;

  @Column({ type: 'float', default: 0 })
  avgRMultiple: number;

  @Column({ type: 'float', default: 0 })
  maxDrawdown: number;

  @Column({ type: 'float', default: 0 })
  ruleAdherence: number;

  @OneToMany(() => StrategyRuleEntity, (rule) => rule.playbook, {
    cascade: true,
    eager: true,
  })
  rules: StrategyRuleEntity[];

  @OneToMany(() => StrategyTradeEntity, (trade) => trade.playbook, {
    cascade: true,
    eager: true,
  })
  trades: StrategyTradeEntity[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
