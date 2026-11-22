import { Playbook } from './entities/playbook.entity';
import {
  StrategyRuleEntity,
  StrategyRuleGroup,
} from './entities/strategy-rule.entity';
import { StrategyTradeEntity } from './entities/strategy-trade.entity';

function rule(
  group: StrategyRuleGroup,
  position: number,
  text: string,
  verified = true,
): StrategyRuleEntity {
  return Object.assign(new StrategyRuleEntity(), { group, position, text, verified });
}

function trade(
  position: number,
  pair: string,
  lots: number,
  entry: number,
  exit: number,
  pnl: number,
  compliant: boolean,
): StrategyTradeEntity {
  return Object.assign(new StrategyTradeEntity(), {
    position,
    pair,
    lots,
    entry,
    exit,
    pnl,
    compliant,
  });
}

function playbook(input: {
  id: string;
  name: string;
  description: string;
  category: Playbook['category'];
  primary: boolean;
  adherence: number;
  reviewNeeded: boolean;
  favorite: boolean;
  executions: number;
  winRate: number;
  avgR: number;
  netPnl: number;
  badges: string[];
  statusLabel?: string;
  syncLabel?: string;
  grade?: number;
  macroWindow?: string;
  netReturnPercent?: number;
  profitFactor?: number;
  avgRMultiple?: number;
  maxDrawdown?: number;
  ruleAdherence?: number;
  rules: StrategyRuleEntity[];
  trades: StrategyTradeEntity[];
}): Playbook {
  const entity = Object.assign(new Playbook(), {
    ...input,
    netReturn: input.netPnl,
    statusLabel: input.statusLabel ?? 'Rulebook Ready',
    syncLabel: input.syncLabel ?? 'MT5 Synced · sample data',
    grade: input.grade ?? input.adherence,
    macroWindow: input.macroWindow ?? input.badges.at(-1) ?? 'Any Session',
    netReturnPercent: input.netReturnPercent ?? 0,
    profitFactor: input.profitFactor ?? 1.8,
    avgRMultiple: input.avgRMultiple ?? input.avgR,
    maxDrawdown: input.maxDrawdown ?? -2.4,
    ruleAdherence: input.ruleAdherence ?? input.adherence,
  });
  entity.rules.forEach((item) => {
    item.playbook = entity;
  });
  entity.trades.forEach((item) => {
    item.playbook = entity;
  });
  return entity;
}

/** Seed rows written to Postgres on first run. */
export function buildSeedPlaybooks(): Playbook[] {
  return [
    playbook({
      id: 'pb_silver_bullet',
      name: 'ICT Silver Bullet',
      description:
        'Time-based liquidity grab and displacement setup in London & NY AM macro windows.',
      category: 'ictSmc',
      primary: false,
      adherence: 92,
      reviewNeeded: false,
      favorite: false,
      executions: 14,
      winRate: 71.4,
      avgR: 2.4,
      netPnl: 2140,
      badges: ['15M / 5M / 1M', 'London & NY Overlap'],
      statusLabel: 'Live Rulebook Active',
      syncLabel: 'MT5 Synced · 2m ago',
      grade: 92,
      macroWindow: 'London & NY AM Macro',
      netReturnPercent: 7.2,
      profitFactor: 2.85,
      avgRMultiple: 2.41,
      maxDrawdown: -1.8,
      ruleAdherence: 92.8,
      rules: [
        rule(
          'entry',
          0,
          'Mark the London/NY AM macro window on the 15M chart.',
        ),
        rule(
          'entry',
          1,
          'Confirm a liquidity grab of the prior session high or low.',
        ),
        rule('entry', 2, 'Wait for displacement with a clear fair-value gap.'),
        rule(
          'entry',
          3,
          'Enter only on mitigate/retest into the discount or premium array.',
        ),
        rule(
          'risk',
          0,
          'Stop loss sits beyond the sweep extreme with a 5-pip buffer.',
        ),
        rule(
          'risk',
          1,
          'TP1 at 2R; TP2 at the opposite session range extension.',
        ),
        rule(
          'risk',
          2,
          'Invalidate if price reclaims the liquidity pool before displacement.',
        ),
      ],
      trades: [
        trade(0, 'XAUUSD', 0.1, 2341.2, 2362.8, 215, true),
        trade(1, 'EURUSD', 0.25, 1.0842, 1.0876, 85, true),
        trade(2, 'GBPUSD', 0.15, 1.2631, 1.2598, -49.5, false),
        trade(3, 'XAUUSD', 0.08, 2350.1, 2394.6, 356.4, true),
        trade(4, 'USDJPY', 0.2, 156.42, 155.91, -102, false),
        trade(5, 'EURUSD', 0.3, 1.0818, 1.0884, 198, true),
      ],
    }),
    playbook({
      id: 'pb_london_breakout',
      name: 'London Breakout',
      description:
        'Asian range high/low expansion during London open with aggressive volume displacement.',
      category: 'priceAction',
      primary: true,
      adherence: 94,
      reviewNeeded: false,
      favorite: true,
      executions: 18,
      winRate: 72.2,
      avgR: 2.8,
      netPnl: 2840,
      badges: ['15M', 'London Session'],
      macroWindow: 'London Session',
      rules: [
        rule('entry', 0, 'Mark the Asian session high and low.'),
        rule('entry', 1, 'Enter only on a confirmed range break with volume.'),
        rule('risk', 0, 'Stop sits back inside the Asian range.'),
        rule('risk', 1, 'Take profit at the measured range extension.'),
      ],
      trades: [
        trade(0, 'GBPUSD', 0.2, 1.265, 1.271, 120, true),
        trade(1, 'XAUUSD', 0.1, 2338, 2355, 170, true),
        trade(2, 'EURUSD', 0.25, 1.083, 1.0805, -62.5, false),
      ],
    }),
    playbook({
      id: 'pb_judas_swing',
      name: 'ICT Judas Swing',
      description:
        'False move liquidity sweep at session open followed by violent market structure shift.',
      category: 'ictSmc',
      primary: false,
      adherence: 83,
      reviewNeeded: false,
      favorite: false,
      executions: 6,
      winRate: 50.0,
      avgR: 1.6,
      netPnl: 380,
      badges: ['1H / 15M', 'NY Session'],
      macroWindow: 'NY Session',
      rules: [
        rule('entry', 0, 'Wait for the first 15-minute false move at NY open.'),
        rule('entry', 1, 'Confirm a market structure shift after the sweep.'),
        rule('risk', 0, 'Stop beyond the false-move extreme.'),
        rule('risk', 1, 'Target the opposing liquidity pool.'),
      ],
      trades: [
        trade(0, 'EURUSD', 0.2, 1.087, 1.091, 80, true),
        trade(1, 'USDJPY', 0.15, 155.8, 156.4, -90, false),
        trade(2, 'XAUUSD', 0.05, 2360, 2378, 90, true),
      ],
    }),
    playbook({
      id: 'pb_ote',
      name: 'ICT OTE',
      description:
        'Fibonacci 0.62–0.79 retracement into premium/discount order blocks with HTF confluence.',
      category: 'ictSmc',
      primary: false,
      adherence: 67,
      reviewNeeded: true,
      favorite: false,
      executions: 4,
      winRate: 50.0,
      avgR: 1.1,
      netPnl: -539.5,
      badges: ['4H / 15M', 'Any Session'],
      rules: [
        rule('entry', 0, 'Mark the higher-timeframe premium/discount array.'),
        rule('entry', 1, 'Enter only inside the 0.62–0.79 OTE zone.'),
        rule('risk', 0, 'Stop beyond the order block origin.'),
        rule('risk', 1, 'Invalidate on a strong close through the OTE zone.'),
      ],
      trades: [
        trade(0, 'GBPUSD', 0.1, 1.27, 1.276, 60, true),
        trade(1, 'XAUUSD', 0.08, 2380, 2360, -160, false),
        trade(2, 'EURUSD', 0.2, 1.09, 1.0947, 94, true),
      ],
    }),
  ];
}
