import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  STRATEGY_CATEGORIES,
  StrategyCategory,
} from './strategy-category.enum';

export type { StrategyCategory } from './strategy-category.enum';

export interface StrategyPlaybookDto {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  primary: boolean;
  adherence: number;
  reviewNeeded: boolean;
  favorite: boolean;
  executions: number;
  winRate: number;
  avgR: number;
  netPnl: number;
  badges: string[];
}

export interface StrategySummaryDto {
  playbooks: number;
  executions: number;
  netReturn: number;
  winRate: number;
}

export interface StrategyOverviewDto {
  playbooks: StrategyPlaybookDto[];
  summary: StrategySummaryDto;
}

export interface StrategyRuleDto {
  text: string;
  verified: boolean;
}

export interface StrategyTradeDto {
  pair: string;
  lots: number;
  entry: number;
  exit: number;
  pnl: number;
  compliant: boolean;
}

export interface StrategyDetailDto {
  playbook: StrategyPlaybookDto;
  statusLabel: string;
  syncLabel: string;
  grade: number;
  macroWindow: string;
  netReturn: number;
  netReturnPercent: number;
  winRate: number;
  profitFactor: number;
  avgRMultiple: number;
  maxDrawdown: number;
  adherence: number;
  entryRules: StrategyRuleDto[];
  riskRules: StrategyRuleDto[];
  trades: StrategyTradeDto[];
}

export class StrategyEntryConditionDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsBoolean()
  enabled: boolean;
}

export class StrategyDisciplineRuleDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsBoolean()
  enabled: boolean;
}

/** Payload accepted by POST /api/strategies. */
export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(STRATEGY_CATEGORIES)
  category?: StrategyCategory;

  @IsOptional()
  @IsArray()
  @IsIn(STRATEGY_CATEGORIES, { each: true })
  categories?: StrategyCategory[];

  @IsOptional()
  @IsString()
  narrative?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyEntryConditionDto)
  entryConditions?: StrategyEntryConditionDto[];

  @IsOptional()
  @IsString()
  takeProfitRule?: string;

  @IsOptional()
  @IsString()
  stopLossRule?: string;

  @IsOptional()
  @IsString()
  invalidationRule?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyDisciplineRuleDto)
  disciplineRules?: StrategyDisciplineRuleDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sessions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  intervals?: string[];
}

export interface CreatedStrategyDto {
  id: string;
  name: string;
  savedAt: string;
  draftCount: number;
}

export interface StrategyDraftDto extends CreatedStrategyDto {
  description: string | null;
  category: StrategyCategory | null;
  categories: StrategyCategory[];
  narrative: string | null;
  entryConditions: StrategyEntryConditionDto[];
  takeProfitRule: string | null;
  stopLossRule: string | null;
  invalidationRule: string | null;
  disciplineRules: StrategyDisciplineRuleDto[];
  sessions: string[];
  intervals: string[];
}
