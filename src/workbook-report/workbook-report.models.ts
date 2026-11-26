export type WorkbookDirection = 'Buy' | 'Sell';
export type WorkbookCashFlowType = 'Deposit' | 'Withdrawal';
export type WorkbookOutcome = 'Win' | 'Loss' | 'BE' | '';
export type WorkbookCloseReason =
  | 'takeProfit'
  | 'stopLoss'
  | 'manual'
  | 'stopOut'
  | 'other'
  | 'unknown';

export interface WorkbookSettings {
  startCapital: number;
  currency: string;
  contractSize: number;
  monthlyTarget: number;
  dailyLossLimit: number;
  maxTradesPerDay: number;
  calendarYear: number;
  calendarMonth: number;
  dashboardYear: number;
  accountName: string;
  currencyMultiplier: number;
}

export interface WorkbookTrade {
  date: Date;
  session?: string | null;
  symbol: string;
  direction: WorkbookDirection;
  strategy?: string | null;
  lots: number;
  entry: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  exit?: number | null;
  screenshot?: string | null;
  notes?: string | null;
  closeReason?: WorkbookCloseReason;
}

export interface WorkbookCashFlow {
  date: Date;
  type: WorkbookCashFlowType;
  amount: number;
  note?: string | null;
  effect: number;
}

export interface WorkbookJournal {
  settings: WorkbookSettings;
  strategies: string[];
  sessions: string[];
  trades: WorkbookTrade[];
  cashFlows: WorkbookCashFlow[];
}

export interface ComputedTrade extends WorkbookTrade {
  trade: WorkbookTrade;
  number: number;
  day: string;
  risk?: number | null;
  plannedRr?: number | null;
  move?: number | null;
  pnl?: number | null;
  resultRr?: number | null;
  outcome: WorkbookOutcome;
  balanceBefore?: number | null;
  riskAmount?: number | null;
  balanceAfter?: number | null;
  closeReason: WorkbookCloseReason;
}

export interface DayStat {
  date: Date;
  pnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
}

export interface WeekdayStat {
  label: string;
  weekday: number;
  netPnl: number;
  trades: number;
}

export interface MonthStat {
  year: number;
  month: number;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  winRate: number | null;
  returnRatio: number;
  target: 'Hit' | 'Miss' | null;
}

export interface StrategyStat {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  avgResultRr: number | null;
  profitFactor: number | null;
  winRate: number | null;
}

export interface EquityPoint {
  tradeNumber: number;
  equity: number;
}

export interface WorkbookComputeResult {
  settings: WorkbookSettings;
  rows: ComputedTrade[];
  cashFlows: WorkbookCashFlow[];
  accountBalance: number;
  totalCashFlow: number;
  netPnl: number;
  netPnlUsd: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: number;
  profitFactor: number | null;
  grossProfit: number;
  grossLoss: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  peakEquity: number;
  avgResultRr: number;
  medianPlannedRr: number;
  monthPnl: number;
  monthlyGoal: number;
  tradingDays: number;
  avgTradesPerDay: number;
  daysOverLossLimit: number;
  daysOverTradeLimit: number;
  bestDay: number;
  worstDay: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: string;
  days: DayStat[];
  weekdays: WeekdayStat[];
  months: MonthStat[];
  strategies: StrategyStat[];
  last20Pnl: number[];
  equityCurve: EquityPoint[];
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
}
