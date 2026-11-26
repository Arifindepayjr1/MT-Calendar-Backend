import { Controller, Get, Header, Query } from '@nestjs/common';
import { Mt5Service } from './mt5.service';

/**
 * Public MT5 history API. The Python bridge is internal and never listens on
 * a socket; all requests pass through this NestJS controller.
 *
 * Query values are read individually because the global ValidationPipe uses
 * `whitelist: true`, which strips undecorated fields from a plain DTO object.
 */
@Controller('mt5')
export class Mt5Controller {
  constructor(private readonly mt5Service: Mt5Service) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.mt5Service.status();
  }

  @Get('symbols')
  @Header('Cache-Control', 'no-store')
  symbols(@Query('search') search?: string) {
    return this.mt5Service.symbols(search);
  }

  @Get('candles')
  @Header('Cache-Control', 'no-store')
  candles(
    @Query('symbol') symbol?: string,
    @Query('date') date?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.mt5Service.candles({ symbol, date, timeframe });
  }

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  latest(
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe?: string,
    @Query('count') count?: string,
  ) {
    return this.mt5Service.latest({ symbol, timeframe, count });
  }

  @Get('ticks')
  @Header('Cache-Control', 'no-store')
  ticks(
    @Query('symbol') symbol?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('limit') limit?: string,
  ) {
    return this.mt5Service.ticks({ symbol, start, end, limit });
  }
}
