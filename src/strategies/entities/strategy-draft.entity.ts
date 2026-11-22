import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/user.entity';
import { STRATEGY_CATEGORIES, StrategyCategory } from '../strategy-category.enum';

/** Full form payload saved for a signed-in user. */
@Entity('strategy_drafts')
export class StrategyDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: STRATEGY_CATEGORIES, nullable: true })
  category: StrategyCategory | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  categories: StrategyCategory[];

  @Column({ type: 'text', nullable: true })
  narrative: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  entryConditions: { text: string; enabled: boolean }[];

  @Column({ type: 'text', nullable: true })
  takeProfitRule: string | null;

  @Column({ type: 'text', nullable: true })
  stopLossRule: string | null;

  @Column({ type: 'text', nullable: true })
  invalidationRule: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  disciplineRules: { text: string; enabled: boolean }[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sessions: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  intervals: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
