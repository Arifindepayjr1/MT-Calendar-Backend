import ExcelJS from 'exceljs';

import {
  WorkbookCashFlow,
  WorkbookCashFlowType,
  WorkbookDirection,
  WorkbookJournal,
  WorkbookSettings,
  WorkbookTrade,
} from './workbook-report.models';

export const NOT_IN_SETUP_LIST = '(Not in Setup list)';

/**
 * Reads a Trading Journal Workbook (.xlsx) and returns ONLY its input cells.
 * Cached formula results are deliberately ignored; computeWorkbook() rebuilds
 * every derived value.
 */
export async function readWorkbook(buffer: Buffer): Promise<WorkbookJournal> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const setup = requireSheet(workbook, 'Setup');
  const tradeLog = requireSheet(workbook, 'Trade Log');
  const cashFlowSheet = requireSheet(workbook, 'Cash Flow');
  const calendar = optionalSheet(workbook, 'Calendar');
  const dashboard = optionalSheet(workbook, 'Dashboard');

  const numAt = (sheet: ExcelJS.Worksheet, ref: string, fallback: number) =>
    cellNumber(inputValue(sheet, ref)) ?? fallback;
  const intAt = (sheet: ExcelJS.Worksheet, ref: string, fallback: number) =>
    Math.round(numAt(sheet, ref, fallback));
  const textAt = (sheet: ExcelJS.Worksheet, ref: string) =>
    cellText(inputValue(sheet, ref));

  const currencyRaw = (textAt(setup, 'B5') ?? 'USD')
    .toUpperCase()
    .trim();
  const isCent =
    currencyRaw === 'USC' ||
    currencyRaw === 'CNT' ||
    currencyRaw === 'CENT';
  const currency = isCent ? 'USC' : 'USD';

  const now = new Date();
  const settings: WorkbookSettings = {
    startCapital: numAt(setup, 'B4', 1000),
    currency,
    contractSize: numAt(setup, 'B7', isCent ? 1 : 100),
    monthlyTarget: numAt(setup, 'B8', 1000),
    dailyLossLimit: numAt(setup, 'B9', 300),
    maxTradesPerDay: intAt(setup, 'B10', 5),
    calendarYear: calendar ? intAt(calendar, 'B4', now.getFullYear()) : now.getFullYear(),
    calendarMonth: calendar
      ? Math.min(12, Math.max(1, intAt(calendar, 'D4', now.getMonth() + 1)))
      : now.getMonth() + 1,
    dashboardYear: dashboard
      ? intAt(dashboard, 'L49', now.getFullYear())
      : now.getFullYear(),
    accountName: 'Trading Journal',
    currencyMultiplier: isCent ? 100 : 1,
  };

  const strategies: string[] = [];
  for (let row = 12; row <= 41; row++) {
    const value = textAt(setup, `A${row}`);
    if (!value) break;
    strategies.push(value);
  }
  const sessions: string[] = [];
  for (let row = 12; row <= 16; row++) {
    const value = textAt(setup, `B${row}`);
    if (!value) break;
    sessions.push(value);
  }

  const trades: WorkbookTrade[] = [];
  for (let row = 6; row <= 305; row++) {
    const date = asDate(inputValue(tradeLog, `B${row}`));
    if (!date) continue;
    const directionText = (textAt(tradeLog, `F${row}`) ?? 'Buy').toLowerCase();
    trades.push({
      date,
      session: textAt(tradeLog, `D${row}`) ?? null,
      symbol: textAt(tradeLog, `E${row}`) ?? 'XAUUSDc',
      direction: directionText === 'sell' ? 'Sell' : 'Buy',
      strategy: textAt(tradeLog, `G${row}`) ?? null,
      lots: numAt(tradeLog, `H${row}`, 0),
      entry: numAt(tradeLog, `I${row}`, 0),
      stopLoss: cellNumber(inputValue(tradeLog, `J${row}`)),
      takeProfit: cellNumber(inputValue(tradeLog, `K${row}`)),
      exit: cellNumber(inputValue(tradeLog, `L${row}`)),
      screenshot: textAt(tradeLog, `V${row}`) ?? null,
      notes: textAt(tradeLog, `W${row}`) ?? null,
    });
  }

  const cashFlows: WorkbookCashFlow[] = [];
  for (let row = 6; row <= 205; row++) {
    const date = asDate(inputValue(cashFlowSheet, `A${row}`));
    const typeText = textAt(cashFlowSheet, `B${row}`);
    const amount = cellNumber(inputValue(cashFlowSheet, `C${row}`));
    if (!date || !typeText || amount == null) continue;
    const normalized = typeText.toLowerCase().trim();
    const isWithdrawal = normalized === 'withdrawal';
    if (!isWithdrawal && normalized !== 'deposit') {
      throw new Error(
        `Cash Flow row ${row} has an unknown type: "${typeText}". Use Deposit or Withdrawal.`,
      );
    }
    const type: WorkbookCashFlowType = isWithdrawal ? 'Withdrawal' : 'Deposit';
    cashFlows.push({
      date,
      type,
      amount: Math.abs(amount),
      note: textAt(cashFlowSheet, `E${row}`) ?? null,
      effect: isWithdrawal ? -Math.abs(amount) : Math.abs(amount),
    });
  }

  return { settings, strategies, sessions, trades, cashFlows };
}

function requireSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = optionalSheet(workbook, name);
  if (!sheet) {
    throw new Error(
      `The workbook is missing the "${name}" sheet. Use the Trading Journal Workbook template.`,
    );
  }
  return sheet;
}

function optionalSheet(
  workbook: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet | undefined {
  const wanted = name.toLowerCase().trim();
  return workbook.worksheets.find(
    (sheet) => sheet.name.toLowerCase().trim() === wanted,
  );
}

/** Returns an input cell value, never a cached formula result. */
function inputValue(sheet: ExcelJS.Worksheet, ref: string): unknown {
  const value = sheet.getCell(ref).value as any;
  if (value == null) return null;
  if (typeof value === 'object' && 'formula' in value) return null;
  if (typeof value === 'object' && 'richText' in value) {
    return (value.richText as Array<{ text?: string }>)
      .map((part) => part.text ?? '')
      .join('');
  }
  if (typeof value === 'object' && 'text' in value) {
    return String((value as { text: unknown }).text);
  }
  if (typeof value === 'object' && 'error' in value) return null;
  return value;
}

function cellText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function cellNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/[A-Za-z$£€]/g, '')
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000) {
      const millis = Math.round((value - 25569) * 86400000);
      const utc = new Date(millis);
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    return null;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dotted = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(raw);
  if (dotted) {
    return new Date(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]));
  }
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(raw);
  if (slash) {
    return new Date(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2]));
  }
  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/.exec(raw);
  if (named) {
    const month = monthNumber(named[2]);
    if (month) return new Date(Number(named[3]), month - 1, Number(named[1]));
  }
  const namedFirst = /^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/.exec(raw);
  if (namedFirst) {
    const month = monthNumber(namedFirst[1]);
    if (month) {
      return new Date(Number(namedFirst[3]), month - 1, Number(namedFirst[2]));
    }
  }
  return null;
}

function monthNumber(raw: string): number | null {
  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];
  const index = months.indexOf(raw.toLowerCase().substring(0, 3));
  return index < 0 ? null : index + 1;
}
