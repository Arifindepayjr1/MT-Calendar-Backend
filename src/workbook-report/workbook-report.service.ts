import { BadRequestException, Injectable } from '@nestjs/common';

import { computeWorkbook, dateKey } from './workbook.compute';
import { renderWorkbookHtml } from './workbook-html';
import { readWorkbook } from './workbook-journal.parser';

@Injectable()
export class WorkbookReportService {
  async render(file: Express.Multer.File) {
    try {
      const journal = await readWorkbook(file.buffer);
      if (!journal.trades.length) {
        throw new Error('No trades found in the Trade Log sheet (rows 6 to 305).');
      }
      const result = computeWorkbook(journal);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Trading_Journal_Report_${stamp}.html`;
      const html = renderWorkbookHtml(result);

      const createdAt = new Date().toISOString();
      const trades = result.rows.map((row) => {
        const ticket = `XLSX-${String(row.number).padStart(3, '0')}`;
        const pnl = row.pnl ?? 0;
        return {
          id: `trd_xlsx_${row.number}`,
          accountId: 'acc_001',
          ticket,
          positionId: ticket,
          symbol: row.trade.symbol,
          type: row.trade.direction === 'Buy' ? 'buy' : 'sell',
          volume: row.trade.lots,
          openPrice: row.trade.entry,
          closePrice: row.trade.exit ?? row.trade.entry,
          stoploss: row.trade.stopLoss ?? null,
          takeProfit: row.trade.takeProfit ?? null,
          openTime: row.trade.date.toISOString(),
          closeTime: row.trade.date.toISOString(),
          profit: pnl,
          commission: 0,
          swap: 0,
          fee: 0,
          netProfit: pnl,
          closeReason: row.closeReason,
          createdAt,
        };
      });

      const symbols = Array.from(new Set(journal.trades.map((trade) => trade.symbol)));
      const brokerAndNumber = symbols.length
        ? `${symbols.join(', ')} · Workbook`
        : 'Trading Journal Workbook';

      return {
        html,
        fileName,
        accountName: journal.settings.accountName,
        brokerAndNumber,
        currency: journal.settings.currency,
        initialDeposit: journal.settings.startCapital,
        finalBalance: result.accountBalance,
        closedTrades: result.closedTrades,
        tradeCount: journal.trades.length,
        firstTradeDate: result.firstTradeDate ? dateKey(result.firstTradeDate) : null,
        lastTradeDate: result.lastTradeDate ? dateKey(result.lastTradeDate) : null,
        trades,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Workbook report failed: ${message}`);
    }
  }
}
