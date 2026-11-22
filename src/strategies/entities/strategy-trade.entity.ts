import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Playbook } from './playbook.entity';

/** An MT5 execution assigned to a playbook by the backend. */
@Entity('strategy_trades')
export class StrategyTradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'varchar', length: 30 })
  pair: string;

  @Column({ type: 'float', default: 0 })
  lots: number;

  @Column({ type: 'float', default: 0 })
  entry: number;

  @Column({ type: 'float', default: 0 })
  exit: number;

  @Column({ type: 'float', default: 0 })
  pnl: number;

  @Column({ type: 'boolean', default: true })
  compliant: boolean;

  @ManyToOne(() => Playbook, (playbook) => playbook.trades, {
    onDelete: 'CASCADE',
  })
  playbook: Playbook;
}
