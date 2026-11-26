import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';

import { Playbook } from '../strategies/entities/playbook.entity';
import { StrategyDraft } from '../strategies/entities/strategy-draft.entity';
import { computeWorkbook, dateKey } from './workbook.compute';
import {
  WorkbookCashFlow,
  WorkbookCloseReason,
  WorkbookDirection,
  WorkbookJournal,
  WorkbookSettings,
  WorkbookTrade,
} from './workbook-report.models';

interface ExportRule {
  text?: string;
  enabled?: boolean;
  verified?: boolean;
}

interface ExportStrategy {
  name?: string;
  description?: string | null;
  category?: string | null;
  categories?: string[];
  narrative?: string | null;
  entryConditions?: ExportRule[];
  takeProfitRule?: string | null;
  stopLossRule?: string | null;
  invalidationRule?: string | null;
  disciplineRules?: ExportRule[];
  rules?: ExportRule[];
  sessions?: string[];
  intervals?: string[];
}

interface ExportTrade {
  ticket?: string;
  symbol?: string;
  type?: string;
  volume?: number | string;
  openPrice?: number | string;
  closePrice?: number | string;
  stoploss?: number | null;
  takeProfit?: number | null;
  openTime?: string;
  closeTime?: string;
  profit?: number | string;
  netProfit?: number | string;
  closeReason?: string;
  strategy?: string;
  strategyIds?: string[];
  notes?: unknown;
  session?: string;
  screenshot?: string;
  comment?: string;
}

interface WorkbookExportPayload {
  trades?: ExportTrade[];
  currency?: string;
  initialDeposit?: number | string;
  finalBalance?: number | string;
  accountName?: string;
  strategies?: Array<ExportStrategy | string>;
  sessions?: string[];
  dailyNotes?: Record<string, string>;
  monthlyTarget?: number | string;
  dailyLossLimit?: number | string;
  maxTradesPerDay?: number | string;
}

const NAVY = 'FF0B1F3A';
const TEAL = 'FF0E7C86';
const GREEN_FILL = 'FFD6F0DF';
const GREEN_TEXT = 'FF14532D';
const RED_FILL = 'FFF9D6D3';
const RED_TEXT = 'FF7F1D1D';
const AMBER_FILL = 'FFFFF0C7';
const AMBER_TEXT = 'FF92400E';
const GREY_FILL = 'FFF1F3F7';
const WHITE = 'FFFFFFFF';
const DARK_RED = 'FF7F1D1D';
const LIGHT = 'FFF7F8FB';
const LINE = 'FFD8DEE8';

@Injectable()
export class WorkbookExportService {
  constructor(
    @Optional()
    @InjectRepository(StrategyDraft)
    private readonly drafts?: Repository<StrategyDraft>,
    @Optional()
    @InjectRepository(Playbook)
    private readonly playbooks?: Repository<Playbook>,
  ) {}

  async export(payload: WorkbookExportPayload): Promise<Buffer> {
    try {
      const sourceTrades = Array.isArray(payload?.trades) ? payload.trades : [];
      if (!sourceTrades.length) {
        throw new Error('Import an MT5 HTML report first; there are no trades to export.');
      }

      const savedStrategies = await this.loadSavedStrategies();
      const strategies = mergeStrategies(payload.strategies ?? [], savedStrategies);
      const strategyByName = new Map(
        strategies.map((strategy) => [normalize(strategy.name ?? ''), strategy]),
      );
      const dict = strategyByName; // clearer name for note helper below

      const currencyRaw = String(payload.currency ?? 'USD').toUpperCase().trim();
      const isCent = ['USC', 'CNT', 'CENT'].includes(currencyRaw);
      const currency = isCent ? 'USC' : 'USD';
      const startCapital = toNumber(payload.initialDeposit, 1000);
      const finalBalance =
        payload.finalBalance == null ? null : toNumber(payload.finalBalance, startCapital);
      const accountName = String(payload.accountName ?? '').trim() || 'Trading Journal';

      const trades: WorkbookTrade[] = sourceTrades.map((trade) => {
        const strategyName =
          textValue(trade.strategy) ??
          inferStrategy(textValue(trade.notes), dict) ??
          '';
        const date = parseDate(trade.openTime ?? trade.closeTime) ?? new Date();
        const exit = trade.closePrice == null ? null : toNumber(trade.closePrice, 0);
        const sl = trade.stoploss == null ? null : toNumber(trade.stoploss, 0);
        const tp = trade.takeProfit == null ? null : toNumber(trade.takeProfit, 0);
        return {
          date,
          session: textValue(trade.session) ?? '',
          symbol: textValue(trade.symbol) ?? 'XAUUSDc',
          direction: normalize(trade.type) === 'sell' ? 'Sell' : ('Buy' as WorkbookDirection),
          strategy: strategyName || null,
          lots: toNumber(trade.volume, 0),
          entry: toNumber(trade.openPrice, 0),
          stopLoss: sl,
          takeProfit: tp,
          exit,
          screenshot: textValue(trade.screenshot),
          notes: buildTradeNote(trade, strategyName, dict),
          closeReason: resolveReason(trade),
        };
      });

      const dates = trades.map((trade) => trade.date.getTime());
      const firstDate = new Date(Math.min(...dates));
      const lastDate = new Date(Math.max(...dates));
      const netPnlFromPayload = sourceTrades.reduce(
        (sum, trade) => sum + toNumber(trade.netProfit ?? trade.profit, 0),
        0,
      );
      const adjustment =
        finalBalance == null ? 0 : finalBalance - (startCapital + netPnlFromPayload);

      const cashFlows: WorkbookCashFlow[] = [];
      if (Math.abs(adjustment) > 0.001) {
        const cashDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() - 1);
        cashFlows.push({
          date: cashDate,
          type: adjustment >= 0 ? 'Deposit' : 'Withdrawal',
          amount: Math.abs(adjustment),
          note: 'Balance adjustment from MT5 report',
          effect: adjustment,
        });
      }

      const sessions = uniqueStrings([
        ...(payload.sessions ?? []),
        ...trades.map((trade) => trade.session ?? ''),
        'London',
        'New York',
        'Asian',
      ]).slice(0, 5);

      const settings: WorkbookSettings = {
        startCapital,
        currency,
        contractSize: isCent ? 1 : 100,
        monthlyTarget: toNumber(payload.monthlyTarget, 1000),
        dailyLossLimit: toNumber(payload.dailyLossLimit, 300),
        maxTradesPerDay: Math.round(toNumber(payload.maxTradesPerDay, 5)),
        calendarYear: firstDate.getFullYear(),
        calendarMonth: firstDate.getMonth() + 1,
        dashboardYear: lastDate.getFullYear(),
        accountName,
        currencyMultiplier: isCent ? 100 : 1,
      };

      const journal: WorkbookJournal = {
        settings,
        strategies: strategies
          .map((strategy) => textValue(strategy.name) ?? '')
          .filter(Boolean),
        sessions,
        trades,
        cashFlows,
      };
      const result = computeWorkbook(journal);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'TraderLog';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.company = 'TraderLog Workbook Export';

      buildDashboard(workbook.addWorksheet('Dashboard'), result, accountName, strategies.length);
      buildTradeLog(workbook.addWorksheet('Trade Log'), result);
      buildCalendar(
        workbook.addWorksheet('Calendar'),
        result,
        payload.dailyNotes ?? {},
      );
      buildStrategyPlaybook(workbook.addWorksheet('Strategy Playbook'), result, strategies);
      buildMonthly(workbook.addWorksheet('Monthly'), result);
      buildSetup(workbook.addWorksheet('Setup'), result, strategies, sessions);
      buildCashFlow(workbook.addWorksheet('Cash Flow'), result);
      buildCalc(workbook.addWorksheet('Calc'), result);
      buildScreenshots(workbook.addWorksheet('Screenshots'), sourceTrades);

      workbook.worksheets.forEach((sheet) => {
        sheet.properties.defaultRowHeight = 18;
        sheet.pageSetup = {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        };
      });

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer as any);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Workbook export failed: ${message}`);
    }
  }

  private async loadSavedStrategies(): Promise<ExportStrategy[]> {
    const loaded: ExportStrategy[] = [];
    try {
      if (this.drafts) {
        const drafts = await this.drafts.find({ order: { createdAt: 'ASC' } });
        drafts.forEach((draft) => loaded.push({ ...draft, name: draft.name }));
      }
    } catch {
      // Database may be unavailable in some local setups; payload strategies still work.
    }
    try {
      if (this.playbooks) {
        const playbooks = await this.playbooks.find({ order: { name: 'ASC' } });
        playbooks.forEach((playbook) =>
          loaded.push({
            name: playbook.name,
            description: playbook.description,
            category: playbook.category,
            narrative: playbook.description,
            rules: (playbook.rules ?? []).map((rule) => ({ text: rule.text, enabled: true })),
            sessions: [],
            intervals: [],
          }),
        );
      }
    } catch {
      // Ignore; seeded playbooks are optional for the export.
    }
    return loaded;
  }
}

/* -------------------------------------------------------------------------- */
/* Sheet builders                                                             */
/* -------------------------------------------------------------------------- */

function buildDashboard(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
  accountName: string,
  strategyCount: number,
) {
  const c = result.settings.currency;
  sheet.columns = [
    { width: 22 }, { width: 20 }, { width: 3 },
    { width: 22 }, { width: 20 }, { width: 3 },
    { width: 22 }, { width: 20 },
  ];
  mergeTitle(sheet, 'A1:H1', `${accountName} · Trading Dashboard`);
  sheet.getCell('A2').value = `Generated ${new Date().toLocaleString()} · ${c}`;
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };

  const kpis: Array<[string, string, string]> = [
    ['ACCOUNT BALANCE', money(result.accountBalance, c), 'teal'],
    ['NET P/L', signed(result.netPnl, c), result.netPnl >= 0 ? GREEN_TEXT : RED_TEXT],
    ['WIN RATE', percent(result.winRate), 'teal'],
    ['PROFIT FACTOR', result.profitFactor == null ? 'n/a' : result.profitFactor.toFixed(2), 'teal'],
    ['EXPECTANCY', signed(result.expectancy, c), 'teal'],
    ['MAX DRAWDOWN', money(result.maxDrawdown, c), RED_TEXT],
    ['TRADING DAYS', String(result.tradingDays), 'teal'],
    ['CLOSED TRADES', String(result.closedTrades), 'teal'],
    ['BEST DAY', signed(result.bestDay, c), GREEN_TEXT],
    ['WORST DAY', signed(result.worstDay, c), RED_TEXT],
    ['AVG RESULT RR', `${result.avgResultRr.toFixed(2)}R`, 'teal'],
    ['MONTHLY GOAL', percent(result.monthlyGoal), 'amber'],
    ['DAYS OVER LOSS LIMIT', String(result.daysOverLossLimit), result.daysOverLossLimit ? RED_TEXT : 'teal'],
    ['DAYS OVER TRADE LIMIT', String(result.daysOverTradeLimit), result.daysOverTradeLimit ? RED_TEXT : 'teal'],
    ['STRATEGIES IN PLAYBOOK', String(strategyCount), 'teal'],
    ['CASH FLOW', signed(result.totalCashFlow, c), result.totalCashFlow >= 0 ? GREEN_TEXT : RED_TEXT],
  ];

  kpis.forEach(([label, value, color], index) => {
    const col = (index % 4) * 2 + 1;
    const row = 4 + Math.floor(index / 4) * 3;
    const labelCell = sheet.getCell(row, col);
    const valueCell = sheet.getCell(row + 1, col);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
    labelCell.alignment = { vertical: 'middle' };
    valueCell.value = value;
    valueCell.font = {
      bold: true,
      size: 15,
      color: { argb: color === 'teal' ? TEAL : color === 'amber' ? AMBER_TEXT : color },
    };
    valueCell.alignment = { vertical: 'middle', wrapText: true };
    sheet.mergeCells(row + 1, col, row + 1, col + 1);
    for (let r = row; r <= row + 1; r++) {
      for (let cc = col; cc <= col + 1; cc++) {
        const cell = sheet.getCell(r, cc);
        cell.fill = plainFill(LIGHT);
        cell.border = thinBorder(LINE);
      }
    }
  });

  const noteRow = 20;
  sheet.getCell(noteRow, 1).value = 'HOW TO READ THIS WORKBOOK';
  sheet.getCell(noteRow, 1).font = { bold: true, color: { argb: NAVY } };
  const lines = [
    'Trade Log: every derived cell contains a live formula plus the value calculated at export time.',
    'Notes column: strategy name, recorded rule, TP / SL / manual exit and ticket for each trade.',
    'Calendar: green = TP hit, red = SL hit, amber = manual exit, dark red = daily loss limit breached.',
    'Strategy Playbook: your saved strategies and rules, with live performance from this report.',
    'Setup: edit B4:B10 to change start capital, currency, target and limits; all formulas recalculate.',
  ];
  lines.forEach((line, index) => {
    const cell = sheet.getCell(noteRow + 1 + index, 1);
    cell.value = `• ${line}`;
    sheet.mergeCells(noteRow + 1 + index, 1, noteRow + 1 + index, 8);
    cell.alignment = { wrapText: true, vertical: 'middle' };
    cell.font = { size: 10, color: { argb: 'FF374151' } };
  });
}

function buildTradeLog(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
) {
  const c = result.settings.currency;
  const headers: Array<[string, string, number]> = [
    ['B', 'Date', 13],
    ['D', 'Session', 12],
    ['E', 'Symbol', 13],
    ['F', 'Direction', 10],
    ['G', 'Strategy', 20],
    ['H', 'Lots', 9],
    ['I', 'Entry', 11],
    ['J', 'SL', 11],
    ['K', 'TP', 11],
    ['L', 'Exit', 11],
    ['M', 'Risk', 10],
    ['N', 'Planned RR', 11],
    ['O', 'Move', 10],
    ['P', 'P/L', 12],
    ['Q', 'Result RR', 11],
    ['R', 'Outcome', 10],
    ['S', 'Balance Before', 15],
    ['T', 'Risk Amount', 13],
    ['U', 'Balance After', 14],
    ['V', 'Screenshot', 16],
    ['W', 'Notes / Strategy / Rule', 62],
    ['X', 'Close Reason', 14],
  ];

  sheet.getCell('A1').value = 'TRADE LOG · INPUTS + RECALCULATED FORMULAS';
  sheet.getCell('A1').font = { bold: true, size: 13, color: { argb: NAVY } };
  sheet.getCell('A2').value =
    'Yellow columns are inputs. Green/red cells are calculated from input cells only. ' +
    'Notes carry the strategy and rule recorded for that day.';
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

  headers.forEach(([column, label, width]) => {
    const cell = sheet.getCell(`${column}5`);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder(LINE);
    sheet.getColumn(column).width = width;
  });
  sheet.getRow(5).height = 30;
  sheet.getColumn('A').width = 5;
  sheet.getColumn('C').width = 3;
  sheet.getColumn('Y').width = 3;
  sheet.getColumn('Z').width = 3;

  const inputColumns = new Set(['B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'V', 'W']);
  result.rows.forEach((row, index) => {
    const r = 6 + index;
    const trade = row.trade;
    const reason = row.closeReason ?? detectReason(trade.exit, trade.stopLoss, trade.takeProfit);
    const exitLabel = reasonLabel(reason);
    const note = textValue(trade.notes) ?? '';

    const inputs: Record<string, unknown> = {
      B: trade.date,
      D: trade.session ?? '',
      E: trade.symbol,
      F: trade.direction,
      G: trade.strategy ?? '',
      H: trade.lots,
      I: trade.entry,
      J: trade.stopLoss ?? null,
      K: trade.takeProfit ?? null,
      L: trade.exit ?? null,
      V: trade.screenshot ?? '',
      W: note,
      X: exitLabel,
    };
    Object.entries(inputs).forEach(([column, value]) => {
      if (value != null && value !== '') sheet.getCell(`${column}${r}`).value = value as any;
    });

    const formulas: Array<[string, string, number | string | null]> = [
      ['M', `=IF(OR(I${r}="",J${r}=""),"",ABS(I${r}-J${r}))`, row.risk ?? null],
      ['N', `=IF(OR(M${r}="",K${r}=""),"",ABS(K${r}-I${r})/M${r})`, row.plannedRr ?? null],
      ['O', `=IF(L${r}="","",IF(F${r}="Buy",L${r}-I${r},I${r}-L${r}))`, row.move ?? null],
      ['P', `=IF(O${r}="","",O${r}*H${r}*$B$7*IF($B$5="USC",100,1))`, row.pnl ?? null],
      ['Q', `=IF(OR(M${r}="",O${r}="",M${r}=0),"",O${r}/M${r})`, row.resultRr ?? null],
      ['R', `=IF(P${r}="","OPEN",IF(P${r}>0,"WIN",IF(P${r}<0,"LOSS","BE")))`, row.outcome || null],
      [
        'S',
        `=IF(P${r}="","",$B$4+${r === 6 ? '0' : `SUM($P$6:P${r - 1})`}+` +
          `SUMIF('Cash Flow'!$A$6:$A$205,"<"&B${r},'Cash Flow'!$C$6:$C$205))`,
        row.balanceBefore ?? null,
      ],
      ['T', `=IF(OR(M${r}="",H${r}=""),"",M${r}*H${r}*$B$7*IF($B$5="USC",100,1))`, row.riskAmount ?? null],
      ['U', `=IF(OR(S${r}="",P${r}=""),"",S${r}+P${r})`, row.balanceAfter ?? null],
    ];
    formulas.forEach(([column, formula, cached]) => {
      sheet.getCell(`${column}${r}`).value =
        cached == null ? { formula } : ({ formula, result: cached } as any);
    });

    headers.forEach(([column]) => {
      const cell = sheet.getCell(`${column}${r}`);
      cell.border = thinBorder(LINE);
      cell.alignment = {
        vertical: 'top',
        horizontal: cell.alignment?.horizontal ?? 'center',
        wrapText: column === 'W' || column === 'G',
      };
      if (inputColumns.has(column)) {
        cell.fill = plainFill('FFFFF9E0');
      }
      if (index % 2 === 1 && !inputColumns.has(column)) {
        cell.fill = plainFill(LIGHT);
      }
    });

    sheet.getCell(`B${r}`).numFmt = 'yyyy-mm-dd';
    ['H', 'I', 'J', 'K', 'L', 'M', 'O'].forEach((column) => {
      sheet.getCell(`${column}${r}`).numFmt = '#,##0.000';
    });
    ['P', 'S', 'T', 'U'].forEach((column) => {
      sheet.getCell(`${column}${r}`).numFmt = '#,##0.00';
    });
    ['N', 'Q'].forEach((column) => {
      sheet.getCell(`${column}${r}`).numFmt = '0.00';
    });

    colorValueCell(sheet.getCell(`P${r}`), row.pnl);
    colorOutcomeCell(sheet.getCell(`R${r}`), row.outcome);
    colorReasonCell(sheet.getCell(`X${r}`), reason);
    sheet.getCell(`W${r}`).font = { size: 9, color: { argb: 'FF374151' } };
    sheet.getRow(r).height = note.length > 120 ? 46 : 30;
  });

  sheet.views = [{ state: 'frozen', ySplit: 5, xSplit: 4 }];
  sheet.autoFilter = { from: 'B5', to: `X${Math.max(5, 5 + result.rows.length)}` };
}

function buildCalendar(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
  dailyNotes: Record<string, string>,
) {
  const c = result.settings.currency;
  const year = result.settings.calendarYear;
  const month = result.settings.calendarMonth;
  sheet.getCell('B4').value = year;
  sheet.getCell('D4').value = month;
  sheet.getCell('A4').value = 'Calendar year';
  sheet.getCell('C4').value = 'Calendar month';
  [sheet.getCell('A4'), sheet.getCell('C4')].forEach((cell) => {
    cell.font = { bold: true, color: { argb: 'FF6B7280' }, size: 9 };
  });

  for (let col = 1; col <= 10; col++) sheet.getColumn(col).width = col === 5 ? 20 : 16;

  mergeTitle(sheet, 'A1:E1', `P/L CALENDAR · ${monthName(month)} ${year}`);
  sheet.getCell('A2').value =
    'Cell colour shows the exit type of the day: green TP, red SL, amber manual. ' +
    'Each cell shows daily P/L, trade count, exit counts and strategies used.';
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  sheet.mergeCells('A2:E2');

  const byDate = new Map<string, typeof result.rows>();
  result.rows.forEach((row) => {
    const key = dateKey(row.trade.date);
    const list = byDate.get(key) ?? [];
    list.push(row);
    byDate.set(key, list);
  });

  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const headerRow = 8;
  weekdays.forEach((label, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder(LINE);
  });
  const weekCell = sheet.getCell(headerRow, 8);
  weekCell.value = 'WEEK';
  weekCell.font = { bold: true, color: { argb: WHITE }, size: 10 };
  weekCell.fill = plainFill(TEAL);
  weekCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - offset);
  const lossLimit = result.settings.dailyLossLimit;

  for (let week = 0; week < 6; week++) {
    let weekPnl = 0;
    let weekTrades = 0;
    for (let day = 0; day < 7; day++) {
      const cellDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      const key = dateKey(cellDate);
      const rows = byDate.get(key) ?? [];
      const inMonth = cellDate.getMonth() === month - 1 && cellDate.getFullYear() === year;
      const cell = sheet.getCell(headerRow + 1 + week, day + 1);
      const dayPnl = rows.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
      weekPnl += dayPnl;
      weekTrades += rows.length;

      const reasons = countReasons(rows);
      const strategyNames = uniqueStrings(rows.map((row) => row.trade.strategy ?? ''))
        .slice(0, 2)
        .join(', ');
      const note = dailyNotes[key] ? `\n${dailyNotes[key]}` : '';
      cell.value =
        `${cellDate.getDate()}` +
        (rows.length
          ? `\n${signed(dayPnl, c)}\n${rows.length}T · TP${reasons.takeProfit} SL${reasons.stopLoss} M${reasons.manual}` +
            (strategyNames ? `\n${strategyNames}` : '') +
            note
          : '');

      const reason = dominantReason(rows);
      const breached = lossLimit > 0 && dayPnl < -lossLimit;
      const [fill, color] = breached
        ? [DARK_RED, WHITE]
        : reason === 'takeProfit'
          ? [GREEN_FILL, GREEN_TEXT]
          : reason === 'stopLoss'
            ? [RED_FILL, RED_TEXT]
            : reason === 'manual'
              ? [AMBER_FILL, AMBER_TEXT]
              : [GREY_FILL, 'FF6B7280'];
      cell.fill = plainFill(inMonth ? fill : 'FFE5E7EB');
      cell.font = {
        bold: rows.length > 0,
        size: rows.length ? 9 : 10,
        color: { argb: inMonth ? color : 'FF9CA3AF' },
      };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      cell.border = thinBorder(LINE);
    }
    const total = sheet.getCell(headerRow + 1 + week, 8);
    total.value = weekTrades
      ? `Week ${week + 1}\n${signed(weekPnl, c)}\n${weekTrades} trades`
      : `Week ${week + 1}`;
    total.fill = plainFill(LIGHT);
    total.font = { bold: true, size: 9, color: { argb: NAVY } };
    total.alignment = { vertical: 'top', wrapText: true };
    total.border = thinBorder(LINE);
    sheet.getRow(headerRow + 1 + week).height = 66;
  }

  const legendRow = headerRow + 8;
  const legend: Array<[string, string, string]> = [
    ['TP HIT', GREEN_FILL, GREEN_TEXT],
    ['SL HIT', RED_FILL, RED_TEXT],
    ['MANUAL', AMBER_FILL, AMBER_TEXT],
    ['LIMIT BREACH', DARK_RED, WHITE],
    ['NO TRADES', GREY_FILL, 'FF6B7280'],
  ];
  legend.forEach(([label, fill, color], index) => {
    const cell = sheet.getCell(legendRow, index + 1);
    cell.value = label;
    cell.fill = plainFill(fill);
    cell.font = { bold: true, size: 9, color: { argb: color } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder(LINE);
  });

  const noteHeader = legendRow + 2;
  const noteHeaders = ['DATE', 'P/L', 'TRADES', 'TP / SL / MANUAL', 'STRATEGY + RULE NOTE'];
  noteHeaders.forEach((label, index) => {
    const cell = sheet.getCell(noteHeader, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  result.days.forEach((day, index) => {
    const r = noteHeader + 1 + index;
    const key = dateKey(day.date);
    const rows = byDate.get(key) ?? [];
    const reasons = countReasons(rows);
    const strategies = uniqueStrings(rows.map((row) => row.trade.strategy ?? '')).join(', ');
    const values = [
      dateKey(day.date),
      signed(day.pnl, c),
      day.tradeCount,
      `TP ${reasons.takeProfit} / SL ${reasons.stopLoss} / M ${reasons.manual}`,
      [strategies, dailyNotes[key], ...uniqueStrings(rows.map((row) => textValue(row.trade.notes) ?? ''))]
        .filter(Boolean)
        .join(' · '),
    ];
    values.forEach((value, col) => {
      const cell = sheet.getCell(r, col + 1);
      cell.value = value;
      cell.border = thinBorder(LINE);
      cell.alignment = { vertical: 'top', wrapText: col === 4 };
      cell.font = { size: 9, color: { argb: 'FF374151' } };
      if (index % 2 === 1) cell.fill = plainFill(LIGHT);
    });
    colorValueCell(sheet.getCell(r, 2), day.pnl);
    sheet.getRow(r).height = 30;
  });
}

function buildStrategyPlaybook(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
  strategies: ExportStrategy[],
) {
  const c = result.settings.currency;
  mergeTitle(sheet, 'A1:N1', 'STRATEGY PLAYBOOK · SAVED STRATEGIES + LIVE RESULTS');
  sheet.getCell('A2').value =
    'Every strategy you created is listed with its rules. Win rate, P/L, RR and PF are recalculated from this report.';
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  sheet.mergeCells('A2:N2');

  const headers = [
    'Strategy', 'Category', 'Description / Narrative', 'Entry rules', 'TP rule', 'SL rule',
    'Invalidation', 'Discipline rules', 'Sessions', 'Trades', 'Win rate', 'Net P/L', 'Avg RR', 'PF',
  ];
  headers.forEach((label, index) => {
    const cell = sheet.getCell(5, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder(LINE);
  });
  sheet.getRow(5).height = 30;

  const widths = [22, 14, 34, 34, 24, 24, 24, 34, 18, 9, 10, 13, 10, 9];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const statByName = new Map(result.strategies.map((stat) => [stat.name, stat]));
  strategies.forEach((strategy, index) => {
    const name = textValue(strategy.name) ?? '';
    const stat = statByName.get(name);
    const r = 6 + index;
    const values: unknown[] = [
      name,
      textValue(strategy.category) ?? (strategy.categories ?? []).join(', '),
      textValue(strategy.narrative) ?? textValue(strategy.description) ?? '',
      enabledRules(strategy.entryConditions ?? strategy.rules),
      textValue(strategy.takeProfitRule) ?? '',
      textValue(strategy.stopLossRule) ?? '',
      textValue(strategy.invalidationRule) ?? '',
      enabledRules(strategy.disciplineRules),
      (strategy.sessions ?? []).join(', '),
      stat?.trades ?? 0,
      stat?.winRate == null ? '—' : percent(stat.winRate),
      stat ? signed(stat.netPnl, c) : '0.00',
      stat?.avgResultRr == null ? '—' : `${stat.avgResultRr.toFixed(2)}R`,
      stat?.profitFactor == null ? 'n/a' : stat.profitFactor.toFixed(2),
    ];
    values.forEach((value, col) => {
      const cell = sheet.getCell(r, col + 1);
      cell.value = value as any;
      cell.border = thinBorder(LINE);
      cell.alignment = { vertical: 'top', wrapText: col >= 2 && col <= 8 };
      cell.font = { size: 9, color: { argb: 'FF374151' } };
      if (index % 2 === 1) cell.fill = plainFill(LIGHT);
    });
    if (stat) colorValueCell(sheet.getCell(r, 12), stat.netPnl);
    sheet.getRow(r).height = 56;
  });
  sheet.views = [{ state: 'frozen', ySplit: 5, xSplit: 1 }];
}

function buildMonthly(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
) {
  const c = result.settings.currency;
  mergeTitle(sheet, 'A1:F1', `MONTHLY PERFORMANCE · ${result.settings.dashboardYear}`);
  sheet.getCell('A2').value = `Target ${money(result.settings.monthlyTarget, c)} per month`;
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  const headers = ['Month', 'Trades', 'Win rate', 'Net P/L', 'Return', 'Target'];
  headers.forEach((label, index) => {
    const cell = sheet.getCell(4, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  [20, 10, 12, 14, 12, 12].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  result.months.forEach((month, index) => {
    const r = 5 + index;
    const values = [
      month.label,
      month.trades,
      month.winRate == null ? '—' : percent(month.winRate),
      signed(month.netPnl, c),
      percent(month.returnRatio),
      month.target ?? '—',
    ];
    values.forEach((value, col) => {
      const cell = sheet.getCell(r, col + 1);
      cell.value = value as any;
      cell.border = thinBorder(LINE);
      cell.alignment = { horizontal: col === 0 ? 'left' : 'center', vertical: 'middle' };
      if (index % 2 === 1) cell.fill = plainFill(LIGHT);
    });
    colorValueCell(sheet.getCell(r, 4), month.netPnl);
    if (month.target === 'Hit') sheet.getCell(r, 6).fill = plainFill(GREEN_FILL);
    if (month.target === 'Miss') sheet.getCell(r, 6).fill = plainFill(RED_FILL);
  });
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}

function buildSetup(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
  strategies: ExportStrategy[],
  sessions: string[],
) {
  const pairs: Array<[string, string, unknown, string]> = [
    ['A1', 'B1', 'Trading Journal Settings', 'title'],
    ['A2', 'B2', result.settings.accountName, 'text'],
    ['A4', 'B4', result.settings.startCapital, 'number'],
    ['A5', 'B5', result.settings.currency, 'text'],
    ['A7', 'B7', result.settings.contractSize, 'number'],
    ['A8', 'B8', result.settings.monthlyTarget, 'number'],
    ['A9', 'B9', result.settings.dailyLossLimit, 'number'],
    ['A10', 'B10', result.settings.maxTradesPerDay, 'number'],
    ['A11', 'B11', 'Strategies', 'header'],
  ];
  const labels: Record<string, string> = {
    B1: 'Account',
    B2: 'Account name',
    B4: 'Start capital',
    B5: 'Currency (USC or USD)',
    B7: 'Contract size',
    B8: 'Monthly target',
    B9: 'Daily loss limit',
    B10: 'Max trades per day',
  };
  pairs.forEach(([labelRef, valueRef, value, kind]) => {
    sheet.getCell(labelRef).value = (kind === 'title' ? value : labels[valueRef] ?? value) as any;
    sheet.getCell(valueRef).value = value as any;
    if (kind === 'title') {
      sheet.getCell(labelRef).font = { bold: true, size: 13, color: { argb: NAVY } };
    } else {
      sheet.getCell(labelRef).font = { bold: true, size: 10, color: { argb: 'FF374151' } };
      sheet.getCell(valueRef).fill = plainFill('FFFFF9E0');
    }
  });
  sheet.getCell('B11').value = 'Sessions';
  sheet.getCell('B11').font = { bold: true, color: { argb: WHITE }, size: 10 };
  sheet.getCell('A11').font = { bold: true, color: { argb: WHITE }, size: 10 };
  sheet.getCell('A11').fill = plainFill(NAVY);
  sheet.getCell('B11').fill = plainFill(NAVY);

  strategies.slice(0, 30).forEach((strategy, index) => {
    sheet.getCell(`A${12 + index}`).value = textValue(strategy.name) ?? '';
  });
  sessions.slice(0, 5).forEach((session, index) => {
    sheet.getCell(`B${12 + index}`).value = session;
  });

  sheet.getCell('D1').value = 'STRATEGY RULE REFERENCE';
  sheet.getCell('D1').font = { bold: true, size: 12, color: { argb: NAVY } };
  const ruleHeaders = ['Strategy', 'Rule type', 'Rule'];
  ruleHeaders.forEach((label, index) => {
    const cell = sheet.getCell(3, index + 4);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
  });
  let ruleRow = 4;
  strategies.forEach((strategy) => {
    const name = textValue(strategy.name) ?? '';
    const rules: Array<[string, string]> = [
      ...enabledRules(strategy.entryConditions ?? strategy.rules).map((text) => ['Entry', text] as [string, string]),
      ...(textValue(strategy.takeProfitRule) ? [['Take profit', textValue(strategy.takeProfitRule)!] as [string, string]] : []),
      ...(textValue(strategy.stopLossRule) ? [['Stop loss', textValue(strategy.stopLossRule)!] as [string, string]] : []),
      ...(textValue(strategy.invalidationRule) ? [['Invalidation', textValue(strategy.invalidationRule)!] as [string, string]] : []),
      ...enabledRules(strategy.disciplineRules).map((text) => ['Discipline', text] as [string, string]),
    ];
    rules.forEach(([type, text]) => {
      sheet.getCell(ruleRow, 4).value = name;
      sheet.getCell(ruleRow, 5).value = type;
      sheet.getCell(ruleRow, 6).value = text;
      for (let col = 4; col <= 6; col++) {
        const cell = sheet.getCell(ruleRow, col);
        cell.border = thinBorder(LINE);
        cell.alignment = { vertical: 'top', wrapText: col === 6 };
        cell.font = { size: 9, color: { argb: 'FF374151' } };
      }
      ruleRow++;
    });
  });
  [24, 18, 18, 24, 16, 70].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function buildCashFlow(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
) {
  ['Date', 'Type', 'Amount', '', 'Note'].forEach((label, index) => {
    const cell = sheet.getCell(5, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
  });
  result.cashFlows.forEach((flow, index) => {
    const r = 6 + index;
    sheet.getCell(r, 1).value = flow.date;
    sheet.getCell(r, 1).numFmt = 'yyyy-mm-dd';
    sheet.getCell(r, 2).value = flow.type;
    sheet.getCell(r, 3).value = flow.amount;
    sheet.getCell(r, 5).value = flow.note ?? '';
    for (let col = 1; col <= 5; col++) {
      sheet.getCell(r, col).border = thinBorder(LINE);
    }
    sheet.getCell(r, 2).fill = plainFill(flow.effect >= 0 ? GREEN_FILL : RED_FILL);
  });
  [14, 14, 14, 3, 40].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getCell('A1').value = 'CASH FLOW · DEPOSITS & WITHDRAWALS';
  sheet.getCell('A1').font = { bold: true, size: 12, color: { argb: NAVY } };
  sheet.getCell('A2').value =
    'Only cash flows dated strictly before a trade affect its Balance Before (same-day flows are excluded).';
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
}

function buildCalc(
  sheet: ExcelJS.Worksheet,
  result: ReturnType<typeof computeWorkbook>,
) {
  const c = result.settings.currency;
  const pnlRange = `'Trade Log'!$P$6:$P$305`;
  sheet.getCell('A1').value = 'CALCULATED SUMMARY · READY AT EXPORT';
  sheet.getCell('A1').font = { bold: true, size: 12, color: { argb: NAVY } };
  sheet.getCell('A2').value =
    'Formula cells include the value calculated at export time. Complex metrics are precomputed.';
  sheet.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

  // [label, formula ('' = static value), calculated value, format]
  const rows: Array<[string, string, number | string, string]> = [
    ['Start capital', '', result.settings.startCapital, '#,##0.00'],
    ['Cash flow', `=SUM('Cash Flow'!$C$6:$C$205)`, result.totalCashFlow, '#,##0.00'],
    ['Closed trades', `=COUNT(${pnlRange})`, result.closedTrades, '0'],
    ['Wins', `=COUNTIF(${pnlRange},">0")`, result.wins, '0'],
    ['Losses', `=COUNTIF(${pnlRange},"<0")`, result.losses, '0'],
    ['Break-even', `=COUNTIF(${pnlRange},"=0")`, result.breakEvens, '0'],
    ['Net P/L', `=SUM(${pnlRange})`, result.netPnl, '#,##0.00'],
    ['Gross profit', '', result.grossProfit, '#,##0.00'],
    ['Gross loss', '', result.grossLoss, '#,##0.00'],
    [
      'Win rate',
      `=IFERROR(COUNTIF(${pnlRange},">0")/COUNTIF(${pnlRange},"<>"),0)`,
      result.winRate,
      '0.0%',
    ],
    ['Profit factor', '', result.profitFactor ?? 'n/a', '0.00'],
    ['Expectancy / trade', '', result.expectancy, '#,##0.00'],
    ['Average win', '', result.avgWin, '#,##0.00'],
    ['Average loss', '', result.avgLoss, '#,##0.00'],
    ['Average result RR', '', result.avgResultRr, '0.00'],
    ['Max drawdown', '', result.maxDrawdown, '#,##0.00'],
    ['Peak equity', '', result.peakEquity, '#,##0.00'],
    ['Trading days', '', result.tradingDays, '0'],
    ['Avg trades / day', '', result.avgTradesPerDay, '0.0'],
    ['Best day', '', result.bestDay, '#,##0.00'],
    ['Worst day', '', result.worstDay, '#,##0.00'],
    ['Longest win streak', '', result.longestWinStreak, '0'],
    ['Longest loss streak', '', result.longestLossStreak, '0'],
    ['Current streak', '', result.currentStreak, '@'],
    ['Month P/L', '', result.monthPnl, '#,##0.00'],
    ['Monthly goal', '', result.monthlyGoal, '0.0%'],
    ['Days over loss limit', '', result.daysOverLossLimit, '0'],
    ['Days over trade limit', '', result.daysOverTradeLimit, '0'],
    ['Account balance', `=SUM(${pnlRange})+B3+B4`, result.accountBalance, '#,##0.00'],
  ];
  rows.forEach(([label, formula, cached, format], index) => {
    const r = 3 + index;
    sheet.getCell(r, 1).value = label;
    sheet.getCell(r, 1).font = { bold: true, color: { argb: 'FF374151' } };
    sheet.getCell(r, 2).value = formula
      ? ({ formula, result: cached } as any)
      : (cached as any);
    sheet.getCell(r, 2).numFmt = format;
    sheet.getCell(r, 1).border = thinBorder(LINE);
    sheet.getCell(r, 2).border = thinBorder(LINE);
    if (index % 2 === 1) {
      sheet.getCell(r, 1).fill = plainFill(LIGHT);
      sheet.getCell(r, 2).fill = plainFill(LIGHT);
    }
    if (typeof cached === 'number' && (label.includes('P/L') || label.includes('profit') || label.includes('loss'))) {
      colorValueCell(sheet.getCell(r, 2), cached);
    }
  });
  [26, 22, 3, 16].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getCell('D1').value = `Currency: ${c}`;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

function buildScreenshots(
  sheet: ExcelJS.Worksheet,
  trades: ExportTrade[],
) {
  ['#', 'Ticket', 'Symbol', 'Direction', 'Close reason', 'Notes'].forEach((label, index) => {
    const cell = sheet.getCell(5, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = plainFill(NAVY);
  });
  trades.slice(0, 300).forEach((trade, index) => {
    const r = 6 + index;
    const reason = resolveReason(trade);
    const values = [
      index + 1,
      trade.ticket ?? '',
      trade.symbol ?? '',
      normalize(trade.type) === 'sell' ? 'Sell' : 'Buy',
      reasonLabel(reason),
      textValue(trade.notes) ?? '',
    ];
    values.forEach((value, col) => {
      const cell = sheet.getCell(r, col + 1);
      cell.value = value as any;
      cell.border = thinBorder(LINE);
      cell.font = { size: 9, color: { argb: 'FF374151' } };
      cell.alignment = { vertical: 'top', wrapText: col === 6 };
    });
    colorReasonCell(sheet.getCell(r, 5), reason);
  });
  [6, 16, 14, 11, 15, 60].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function mergeTitle(sheet: ExcelJS.Worksheet, range: string, text: string) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0]);
  cell.value = text;
  cell.font = { bold: true, size: 14, color: { argb: WHITE } };
  cell.fill = plainFill(NAVY);
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(Number(cell.row)).height = 28;
}

function plainFill(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function thinBorder(color: string): ExcelJS.Borders {
  const side = { style: 'thin' as const, color: { argb: color } };
  return { left: side, right: side, top: side, bottom: side, diagonal: {} };
}

function colorValueCell(cell: ExcelJS.Cell, value: number | null | undefined) {
  if (value == null) return;
  if (value > 0) {
    cell.fill = plainFill(GREEN_FILL);
    cell.font = { bold: true, color: { argb: GREEN_TEXT } };
  } else if (value < 0) {
    cell.fill = plainFill(RED_FILL);
    cell.font = { bold: true, color: { argb: RED_TEXT } };
  }
}

function colorOutcomeCell(cell: ExcelJS.Cell, outcome: string) {
  if (outcome === 'Win') {
    cell.fill = plainFill(GREEN_FILL);
    cell.font = { bold: true, color: { argb: GREEN_TEXT } };
  } else if (outcome === 'Loss') {
    cell.fill = plainFill(RED_FILL);
    cell.font = { bold: true, color: { argb: RED_TEXT } };
  } else if (outcome === 'BE') {
    cell.fill = plainFill(AMBER_FILL);
    cell.font = { bold: true, color: { argb: AMBER_TEXT } };
  }
}

function colorReasonCell(cell: ExcelJS.Cell, reason: WorkbookCloseReason) {
  if (reason === 'takeProfit') {
    cell.fill = plainFill(GREEN_FILL);
    cell.font = { bold: true, size: 9, color: { argb: GREEN_TEXT } };
  } else if (reason === 'stopLoss') {
    cell.fill = plainFill(RED_FILL);
    cell.font = { bold: true, size: 9, color: { argb: RED_TEXT } };
  } else if (reason === 'manual') {
    cell.fill = plainFill(AMBER_FILL);
    cell.font = { bold: true, size: 9, color: { argb: AMBER_TEXT } };
  }
}

/** Honours the close reason detected by the MT5 importer before falling back to price matching. */
function resolveReason(trade: ExportTrade): WorkbookCloseReason {
  const raw = normalize(trade.closeReason);
  if (raw === 'takeprofit' || raw === 'tp') return 'takeProfit';
  if (raw === 'stoploss' || raw === 'sl') return 'stopLoss';
  if (raw === 'manual') return 'manual';
  if (raw === 'stopout' || raw === 'so') return 'stopOut';
  if (raw === 'other') return 'other';
  if (raw === 'unknown') return 'unknown';
  return detectReason(
    trade.closePrice == null ? null : toNumber(trade.closePrice, 0),
    trade.stoploss == null ? null : toNumber(trade.stoploss, 0),
    trade.takeProfit == null ? null : toNumber(trade.takeProfit, 0),
  );
}

function detectReason(
  exit: number | null,
  sl: number | null,
  tp: number | null,
): WorkbookCloseReason {
  if (exit == null) return 'manual';
  const matches = (target: number | null) =>
    target != null && Math.abs(exit - target) <= Math.max(0.00001, Math.abs(target) * 1e-6);
  if (matches(tp)) return 'takeProfit';
  if (matches(sl)) return 'stopLoss';
  return 'manual';
}

function reasonLabel(reason: WorkbookCloseReason): string {
  switch (reason) {
    case 'takeProfit':
      return 'TP HIT';
    case 'stopLoss':
      return 'SL HIT';
    case 'manual':
      return 'MANUAL';
    case 'stopOut':
      return 'STOP OUT';
    case 'other':
      return 'OTHER';
    default:
      return 'OPEN';
  }
}

function countReasons(rows: ReturnType<typeof computeWorkbook>['rows']) {
  const counts = { takeProfit: 0, stopLoss: 0, manual: 0 };
  rows.forEach((row) => {
    const reason = row.closeReason ?? 'manual';
    if (reason === 'takeProfit') counts.takeProfit++;
    else if (reason === 'stopLoss') counts.stopLoss++;
    else counts.manual++;
  });
  return counts;
}

function dominantReason(
  rows: ReturnType<typeof computeWorkbook>['rows'],
): WorkbookCloseReason {
  const counts = countReasons(rows);
  if (!rows.length) return 'unknown';
  if (counts.stopLoss > 0 && counts.stopLoss >= counts.takeProfit && counts.stopLoss >= counts.manual) {
    return 'stopLoss';
  }
  if (counts.takeProfit > 0 && counts.takeProfit >= counts.manual) return 'takeProfit';
  if (counts.manual > 0) return 'manual';
  return 'unknown';
}

function buildTradeNote(
  trade: ExportTrade,
  strategyName: string,
  strategies: Map<string, ExportStrategy>,
): string {
  const parts: string[] = [];
  if (strategyName) parts.push(`Strategy: ${strategyName}`);
  const strategy = strategies.get(normalize(strategyName));
  if (strategy) {
    const entry = enabledRules(strategy.entryConditions ?? strategy.rules);
    if (entry.length) parts.push(`Entry rules: ${entry.join('; ')}`);
    if (textValue(strategy.takeProfitRule)) parts.push(`TP rule: ${textValue(strategy.takeProfitRule)}`);
    if (textValue(strategy.stopLossRule)) parts.push(`SL rule: ${textValue(strategy.stopLossRule)}`);
    if (textValue(strategy.invalidationRule)) parts.push(`Invalidation: ${textValue(strategy.invalidationRule)}`);
    const discipline = enabledRules(strategy.disciplineRules);
    if (discipline.length) parts.push(`Discipline: ${discipline.join('; ')}`);
  }
  const reason = resolveReason(trade);
  parts.push(`Exit: ${reasonLabel(reason)}`);
  if (textValue(trade.ticket)) parts.push(`Ticket ${textValue(trade.ticket)}`);
  const existing = textValue(trade.notes) ?? textValue(trade.comment);
  if (existing && !existing.includes(strategyName)) parts.push(existing);
  return parts.join(' · ').slice(0, 1200);
}

function inferStrategy(note: string | null, strategies: Map<string, ExportStrategy>): string | null {
  if (!note) return null;
  const lower = note.toLowerCase();
  for (const name of strategies.keys()) {
    if (name && lower.includes(name)) return name;
  }
  return null;
}

function mergeStrategies(
  fromPayload: Array<ExportStrategy | string>,
  saved: ExportStrategy[],
): ExportStrategy[] {
  const map = new Map<string, ExportStrategy>();
  saved.forEach((strategy) => {
    const name = textValue(strategy.name);
    if (name) map.set(normalize(name), strategy);
  });
  fromPayload.forEach((item) => {
    const strategy: ExportStrategy = typeof item === 'string' ? { name: item } : item;
    const name = textValue(strategy.name);
    if (!name) return;
    const key = normalize(name);
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, ...strategy } : strategy);
  });
  return Array.from(map.values()).filter((strategy) => textValue(strategy.name));
}

function enabledRules(rules: ExportRule[] | undefined): string[] {
  return (rules ?? [])
    .filter((rule) => rule.enabled !== false && textValue(rule.text))
    .map((rule) => textValue(rule.text)!);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function textValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'object') {
    const asAny = value as any;
    if (Array.isArray(asAny)) {
      const joined = asAny.map((item) => textValue(item)).filter(Boolean).join(' ');
      return joined || null;
    }
    if (asAny.text != null) return textValue(asAny.text);
    if (asAny.value != null) return textValue(asAny.value);
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function toNumber(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function signed(value: number, currency: string): string {
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(2)} ${currency}`;
}

function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function monthName(month: number): string {
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return names[month - 1] ?? 'Month';
}
