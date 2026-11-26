import { NOT_IN_SETUP_LIST } from './workbook-journal.parser';
import {
  ComputedTrade,
  DayStat,
  EquityPoint,
  MonthStat,
  StrategyStat,
  WeekdayStat,
  WorkbookCloseReason,
  WorkbookComputeResult,
  WorkbookJournal,
  WorkbookOutcome,
} from './workbook-report.models';

/** Recomputes every workbook formula from input cells only. */
export function computeWorkbook(journal: WorkbookJournal): WorkbookComputeResult {
  const settings = journal.settings;
  const multiplier = settings.currencyMultiplier;
  const contractSize = settings.contractSize;
  const start = settings.startCapital;

  const cashByDate = new Map<string, number>();
  for (const flow of journal.cashFlows) {
    const key = dateKey(flow.date);
    cashByDate.set(key, (cashByDate.get(key) ?? 0) + flow.effect);
  }
  const totalCashFlow = Array.from(cashByDate.values()).reduce((a, b) => a + b, 0);

  const cashBefore = (date: Date): number => {
    const key = dateKey(date);
    let total = 0;
    for (const [cashDate, effect] of cashByDate.entries()) {
      if (cashDate < key) total += effect;
    }
    return total;
  };

  const rows: ComputedTrade[] = [];
  let runningPl = 0;
  journal.trades.forEach((trade, index) => {
    const risk =
      trade.stopLoss == null ? null : Math.abs(trade.entry - trade.stopLoss);
    const plannedRr =
      risk == null || risk <= 0 || trade.takeProfit == null
        ? null
        : Math.abs(trade.takeProfit - trade.entry) / risk;
    const move =
      trade.exit == null
        ? null
        : trade.direction === 'Buy'
          ? trade.exit - trade.entry
          : trade.entry - trade.exit;
    const pnl =
      move == null ? null : move * trade.lots * contractSize * multiplier;
    const resultRr =
      pnl == null || risk == null || risk <= 0 || move == null
        ? null
        : move / risk;
    const outcome: WorkbookOutcome =
      pnl == null
        ? ''
        : pnl > 0
          ? 'Win'
          : pnl < 0
            ? 'Loss'
            : 'BE';
    const balanceBefore =
      pnl == null ? null : start + runningPl + cashBefore(trade.date);
    const riskAmount =
      risk == null || trade.lots === 0
        ? null
        : risk * trade.lots * contractSize * multiplier;
    const balanceAfter = pnl == null || balanceBefore == null ? null : balanceBefore + pnl;

    rows.push({
      ...trade,
      trade,
      number: index + 1,
      day: weekdayShort(trade.date.getDay()),
      risk,
      plannedRr,
      move,
      pnl,
      resultRr,
      outcome,
      balanceBefore,
      riskAmount,
      balanceAfter,
      closeReason: trade.closeReason ?? detectCloseReason(trade),
    });
    if (pnl != null) runningPl += pnl;
  });

  const closed = rows.filter((row): row is ComputedTrade & { pnl: number } =>
    row.pnl != null,
  );
  const netPnl = closed.reduce((sum, row) => sum + row.pnl, 0);
  const wins = closed.filter((row) => row.outcome === 'Win').length;
  const losses = closed.filter((row) => row.outcome === 'Loss').length;
  const breakEvens = closed.filter((row) => row.outcome === 'BE').length;
  const grossProfit = closed
    .filter((row) => row.pnl > 0)
    .reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = closed
    .filter((row) => row.pnl < 0)
    .reduce((sum, row) => sum - row.pnl, 0);
  const winRate = wins + losses === 0 ? 0 : wins / (wins + losses);
  const profitFactor = grossLoss <= 0 ? null : grossProfit / grossLoss;
  const expectancy = closed.length === 0 ? 0 : netPnl / closed.length;
  const avgWin = wins === 0 ? 0 : grossProfit / wins;
  const avgLoss = losses === 0 ? 0 : -grossLoss / losses;

  // Equity intentionally excludes cash flow: a withdrawal must never look like
  // a trading loss. Workbook row order is authoritative.
  let equity = start;
  let peakEquity = start;
  let maxDrawdown = 0;
  const equityCurve: EquityPoint[] = [{ tradeNumber: 0, equity: start }];
  for (const row of closed) {
    equity += row.pnl;
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = peakEquity - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    equityCurve.push({ tradeNumber: row.number, equity });
  }

  const resultRrs = closed
    .map((row) => row.resultRr)
    .filter((value): value is number => value != null);
  const plannedRrs = rows
    .map((row) => row.plannedRr)
    .filter((value): value is number => value != null);
  const avgResultRr = average(resultRrs);
  const medianPlannedRr = median(plannedRrs);

  const dayMap = new Map<string, DayStat & { dateKey: string }>();
  for (const row of rows) {
    const key = dateKey(row.trade.date);
    const acc =
      dayMap.get(key) ??
      {
        date: stripTime(row.trade.date),
        dateKey: key,
        pnl: 0,
        tradeCount: 0,
        wins: 0,
        losses: 0,
      };
    acc.tradeCount++;
    if (row.pnl != null) {
      acc.pnl += row.pnl;
      if (row.outcome === 'Win') acc.wins++;
      if (row.outcome === 'Loss') acc.losses++;
    }
    dayMap.set(key, acc);
  }
  const days = Array.from(dayMap.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ dateKey: _key, ...day }) => day);

  const monthPnl = days
    .filter(
      (day) =>
        day.date.getFullYear() === settings.calendarYear &&
        day.date.getMonth() + 1 === settings.calendarMonth,
    )
    .reduce((sum, day) => sum + day.pnl, 0);
  const monthlyGoal = settings.monthlyTarget > 0 ? monthPnl / settings.monthlyTarget : 0;

  const tradingDays = days.length;
  const avgTradesPerDay = tradingDays === 0 ? 0 : closed.length / tradingDays;
  const daysOverLossLimit =
    settings.dailyLossLimit > 0
      ? days.filter((day) => day.pnl < -settings.dailyLossLimit).length
      : 0;
  const daysOverTradeLimit =
    settings.maxTradesPerDay > 0
      ? days.filter((day) => day.tradeCount > settings.maxTradesPerDay).length
      : 0;
  const bestDay = days.length
    ? days.reduce((best, day) => Math.max(best, day.pnl), -Infinity)
    : 0;
  const worstDay = days.length
    ? days.reduce((worst, day) => Math.min(worst, day.pnl), Infinity)
    : 0;

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;
  for (const row of closed) {
    if (row.outcome === 'Win') {
      currentWin++;
      currentLoss = 0;
      longestWinStreak = Math.max(longestWinStreak, currentWin);
    } else if (row.outcome === 'Loss') {
      currentLoss++;
      currentWin = 0;
      longestLossStreak = Math.max(longestLossStreak, currentLoss);
    } else {
      currentWin = 0;
      currentLoss = 0;
    }
  }
  let currentStreak = '—';
  if (closed.length) {
    const last = closed[closed.length - 1].outcome;
    if (last === 'Win') currentStreak = `${currentWin} W`;
    else if (last === 'Loss') currentStreak = `${currentLoss} L`;
    else currentStreak = 'BE';
  }

  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weekdays: WeekdayStat[] = [];
  for (let weekday = 1; weekday <= 5; weekday++) {
    const matching = closed.filter((row) => row.trade.date.getDay() === weekday);
    weekdays.push({
      label: weekdayNames[weekday - 1],
      weekday,
      netPnl: matching.reduce((sum, row) => sum + row.pnl, 0),
      trades: matching.length,
    });
  }

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const months: MonthStat[] = [];
  for (let month = 1; month <= 12; month++) {
    const matching = closed.filter(
      (row) =>
        row.trade.date.getFullYear() === settings.dashboardYear &&
        row.trade.date.getMonth() + 1 === month,
    );
    const monthWins = matching.filter((row) => row.outcome === 'Win').length;
    const monthLosses = matching.filter((row) => row.outcome === 'Loss').length;
    const monthNet = matching.reduce((sum, row) => sum + row.pnl, 0);
    months.push({
      year: settings.dashboardYear,
      month,
      label: monthNames[month - 1],
      trades: matching.length,
      wins: monthWins,
      losses: monthLosses,
      netPnl: monthNet,
      winRate:
        monthWins + monthLosses === 0 ? null : monthWins / (monthWins + monthLosses),
      returnRatio: start === 0 ? 0 : monthNet / start,
      target:
        matching.length === 0 || settings.monthlyTarget <= 0
          ? null
          : monthNet >= settings.monthlyTarget
            ? 'Hit'
            : 'Miss',
    });
  }

  const setupNames = new Set(journal.strategies);
  const strategyMap = new Map<string, StrategyStat>();
  for (const row of closed) {
    const raw = (row.trade.strategy ?? '').trim();
    const name = raw && setupNames.has(raw) ? raw : NOT_IN_SETUP_LIST;
    const acc =
      strategyMap.get(name) ??
      {
        name,
        trades: 0,
        wins: 0,
        losses: 0,
        netPnl: 0,
        avgResultRr: null,
        profitFactor: null,
        winRate: null,
      };
    acc.trades++;
    if (row.outcome === 'Win') acc.wins++;
    if (row.outcome === 'Loss') acc.losses++;
    acc.netPnl += row.pnl;
    strategyMap.set(name, acc);
  }
  const strategies = Array.from(strategyMap.values());
  for (const stat of strategies) {
    const matching = closed.filter((row) => {
      const raw = (row.trade.strategy ?? '').trim();
      const name = raw && setupNames.has(raw) ? raw : NOT_IN_SETUP_LIST;
      return name === stat.name;
    });
    const resultRrValues = matching
      .map((row) => row.resultRr)
      .filter((value): value is number => value != null);
    const grossProfit = matching
      .filter((row) => row.pnl > 0)
      .reduce((sum, row) => sum + row.pnl, 0);
    const grossLoss = matching
      .filter((row) => row.pnl < 0)
      .reduce((sum, row) => sum - row.pnl, 0);
    stat.avgResultRr = resultRrValues.length
      ? resultRrValues.reduce((a, b) => a + b, 0) / resultRrValues.length
      : null;
    stat.profitFactor = grossLoss <= 0 ? null : grossProfit / grossLoss;
    stat.winRate = stat.wins + stat.losses === 0 ? null : stat.wins / (stat.wins + stat.losses);
  }
  strategies.sort((a, b) => {
    if (a.name === NOT_IN_SETUP_LIST) return -1;
    if (b.name === NOT_IN_SETUP_LIST) return 1;
    return journal.strategies.indexOf(a.name) - journal.strategies.indexOf(b.name);
  });

  return {
    settings,
    rows,
    cashFlows: journal.cashFlows,
    accountBalance: start + netPnl + totalCashFlow,
    totalCashFlow,
    netPnl,
    netPnlUsd: multiplier === 0 ? netPnl : netPnl / multiplier,
    closedTrades: closed.length,
    wins,
    losses,
    breakEvens,
    winRate,
    profitFactor,
    grossProfit,
    grossLoss,
    expectancy,
    avgWin,
    avgLoss,
    maxDrawdown,
    peakEquity,
    avgResultRr,
    medianPlannedRr,
    monthPnl,
    monthlyGoal,
    tradingDays,
    avgTradesPerDay,
    daysOverLossLimit,
    daysOverTradeLimit,
    bestDay,
    worstDay,
    longestWinStreak,
    longestLossStreak,
    currentStreak,
    days,
    weekdays,
    months,
    strategies,
    last20Pnl: closed.slice(-20).map((row) => row.pnl),
    equityCurve,
    firstTradeDate: journal.trades.length ? journal.trades[0].date : null,
    lastTradeDate: journal.trades.length
      ? journal.trades[journal.trades.length - 1].date
      : null,
  };
}

/** Plain JSON shape used by both the HTML report and the Flutter client. */
export function serializeResult(result: WorkbookComputeResult) {
  return {
    settings: result.settings,
    rows: result.rows.map((row) => ({
      ...row,
      date: dateKey(row.date),
    })),
    cashFlows: result.cashFlows.map((flow) => ({
      ...flow,
      date: dateKey(flow.date),
    })),
    kpis: {
      accountBalance: result.accountBalance,
      totalCashFlow: result.totalCashFlow,
      netPnl: result.netPnl,
      netPnlUsd: result.netPnlUsd,
      closedTrades: result.closedTrades,
      wins: result.wins,
      losses: result.losses,
      breakEvens: result.breakEvens,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      grossProfit: result.grossProfit,
      grossLoss: result.grossLoss,
      expectancy: result.expectancy,
      avgWin: result.avgWin,
      avgLoss: result.avgLoss,
      maxDrawdown: result.maxDrawdown,
      peakEquity: result.peakEquity,
      avgResultRr: result.avgResultRr,
      medianPlannedRr: result.medianPlannedRr,
      monthPnl: result.monthPnl,
      monthlyGoal: result.monthlyGoal,
      tradingDays: result.tradingDays,
      avgTradesPerDay: result.avgTradesPerDay,
      daysOverLossLimit: result.daysOverLossLimit,
      daysOverTradeLimit: result.daysOverTradeLimit,
      bestDay: result.bestDay,
      worstDay: result.worstDay,
      longestWinStreak: result.longestWinStreak,
      longestLossStreak: result.longestLossStreak,
      currentStreak: result.currentStreak,
    },
    days: result.days.map((day) => ({ ...day, date: dateKey(day.date) })),
    weekdays: result.weekdays,
    months: result.months,
    strategies: result.strategies,
    last20Pnl: result.last20Pnl,
    equityCurve: result.equityCurve,
    firstTradeDate: result.firstTradeDate ? dateKey(result.firstTradeDate) : null,
    lastTradeDate: result.lastTradeDate ? dateKey(result.lastTradeDate) : null,
  };
}

function detectCloseReason(trade: {
  exit?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): WorkbookCloseReason {
  const exit = trade.exit;
  if (exit == null) return 'manual';
  const matches = (target?: number | null) =>
    target != null && Math.abs(exit - target) <= Math.max(0.00001, Math.abs(target) * 1e-6);
  if (matches(trade.takeProfit)) return 'takeProfit';
  if (matches(trade.stopLoss)) return 'stopLoss';
  return 'manual';
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function dateKey(value: Date): string {
  return (
    `${value.getFullYear().toString().padStart(4, '0')}-` +
    `${(value.getMonth() + 1).toString().padStart(2, '0')}-` +
    `${value.getDate().toString().padStart(2, '0')}`
  );
}

function stripTime(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function weekdayShort(weekday: number): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[Math.min(6, Math.max(0, weekday))];
}
