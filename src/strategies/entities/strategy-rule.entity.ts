import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Playbook } from './playbook.entity';

export type StrategyRuleGroup = 'entry' | 'risk';

@Entity('strategy_rules')
export class StrategyRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['entry', 'risk'] })
  group: StrategyRuleGroup;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'boolean', default: true })
  verified: boolean;

  @ManyToOne(() => Playbook, (playbook) => playbook.rules, {
    onDelete: 'CASCADE',
  })
  playbook: Playbook;
}
