import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Playbook } from './entities/playbook.entity';
import { StrategyDraft } from './entities/strategy-draft.entity';
import { Repository } from 'typeorm';
import { buildSeedPlaybooks } from './strategies.seed';
import {
  CreateStrategyDto,
  CreatedStrategyDto,
  StrategyDetailDto,
  StrategyDraftDto,
  StrategyOverviewDto,
  StrategyPlaybookDto,
} from './strategy.models';

/**
 * Postgres-backed owner of playbooks, rulebooks and user drafts.
 * Seed rows are inserted on first run; all later reads come from the database.
 */
@Injectable()
export class StrategiesService implements OnModuleInit {
  constructor(
    @InjectRepository(Playbook)
    private readonly playbooks: Repository<Playbook>,
    @InjectRepository(StrategyDraft)
    private readonly drafts: Repository<StrategyDraft>,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.playbooks.count();
    if (count > 0) return;
    await this.playbooks.save(buildSeedPlaybooks());
  }

  async overview(): Promise<StrategyOverviewDto> {
    const playbooks = await this.playbooks.find({ order: { name: 'ASC' } });
    const trades = playbooks.flatMap((playbook) => playbook.trades ?? []);
    const wins = trades.filter((trade) => trade.pnl > 0).length;

    return {
      playbooks: playbooks.map((playbook) => this.toPlaybookDto(playbook)),
      summary: {
        playbooks: playbooks.length,
        executions: playbooks.reduce((sum, item) => sum + item.executions, 0),
        netReturn: Math.round(playbooks.reduce((sum, item) => sum + item.netPnl, 0) * 100) / 100,
        winRate: trades.length
          ? Math.round((wins / trades.length) * 1000) / 10
          : 0,
      },
    };
  }

  async detail(id: string): Promise<StrategyDetailDto> {
    const playbook = await this.playbooks.findOne({ where: { id } });
    if (!playbook) {
      throw new NotFoundException({ error: 'Strategy not found.' });
    }
    return this.toDetailDto(playbook);
  }

  async createDraft(
    userId: string,
    dto: CreateStrategyDto,
  ): Promise<CreatedStrategyDto> {
    const draft = this.drafts.create({
      user: { id: userId } as User,
      name: dto.name.trim(),
      description: dto.description ?? null,
      category: dto.category ?? null,
      categories: dto.categories ?? [],
      narrative: dto.narrative ?? null,
      entryConditions: dto.entryConditions ?? [],
      takeProfitRule: dto.takeProfitRule ?? null,
      stopLossRule: dto.stopLossRule ?? null,
      invalidationRule: dto.invalidationRule ?? null,
      disciplineRules: dto.disciplineRules ?? [],
      sessions: dto.sessions ?? [],
      intervals: dto.intervals ?? [],
    });
    await this.drafts.save(draft);
    const draftCount = await this.drafts.count({ where: { user: { id: userId } } });
    return {
      id: draft.id,
      name: draft.name,
      savedAt: draft.createdAt.toISOString(),
      draftCount,
    };
  }

  async draftsForUser(userId: string): Promise<StrategyDraftDto[]> {
    const drafts = await this.drafts.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
    return drafts.map((draft, index) => ({
      id: draft.id,
      name: draft.name,
      savedAt: draft.createdAt.toISOString(),
      draftCount: drafts.length - index,
      description: draft.description,
      category: draft.category,
      categories: draft.categories,
      narrative: draft.narrative,
      entryConditions: draft.entryConditions,
      takeProfitRule: draft.takeProfitRule,
      stopLossRule: draft.stopLossRule,
      invalidationRule: draft.invalidationRule,
      disciplineRules: draft.disciplineRules,
      sessions: draft.sessions,
      intervals: draft.intervals,
    }));
  }

  private toPlaybookDto(playbook: Playbook): StrategyPlaybookDto {
    return {
      id: playbook.id,
      name: playbook.name,
      description: playbook.description,
      category: playbook.category,
      primary: playbook.primary,
      adherence: playbook.adherence,
      reviewNeeded: playbook.reviewNeeded,
      favorite: playbook.favorite,
      executions: playbook.executions,
      winRate: playbook.winRate,
      avgR: playbook.avgR,
      netPnl: playbook.netPnl,
      badges: playbook.badges,
    };
  }

  private toDetailDto(playbook: Playbook): StrategyDetailDto {
    const rules = playbook.rules ?? [];
    const trades = playbook.trades ?? [];
    return {
      playbook: this.toPlaybookDto(playbook),
      statusLabel: playbook.statusLabel,
      syncLabel: playbook.syncLabel,
      grade: playbook.grade,
      macroWindow: playbook.macroWindow,
      netReturn: playbook.netReturn,
      netReturnPercent: playbook.netReturnPercent,
      winRate: playbook.winRate,
      profitFactor: playbook.profitFactor,
      avgRMultiple: playbook.avgRMultiple,
      maxDrawdown: playbook.maxDrawdown,
      adherence: playbook.ruleAdherence,
      entryRules: rules
        .filter((rule) => rule.group === 'entry')
        .sort((a, b) => a.position - b.position)
        .map((rule) => ({ text: rule.text, verified: rule.verified })),
      riskRules: rules
        .filter((rule) => rule.group === 'risk')
        .sort((a, b) => a.position - b.position)
        .map((rule) => ({ text: rule.text, verified: rule.verified })),
      trades: [...trades]
        .sort((a, b) => a.position - b.position)
        .map((trade) => ({
          pair: trade.pair,
          lots: trade.lots,
          entry: trade.entry,
          exit: trade.exit,
          pnl: trade.pnl,
          compliant: trade.compliant,
        })),
    };
  }
}
