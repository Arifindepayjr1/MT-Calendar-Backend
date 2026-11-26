export const MT5_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;

export type Mt5Timeframe = (typeof MT5_TIMEFRAMES)[number];

export interface Mt5StatusResponse {
  initialized: boolean;
  connected: boolean;
  terminal: string | null;
  terminalPath?: string | null;
  broker: string | null;
  server: string | null;
  version?: unknown;
  error: string | null;
  errorCode?: string | null;
  source: string;
}

export interface Mt5Symbol {
  symbol: string;
  description: string | null;
  currencyBase: string | null;
  currencyProfit: string | null;
  digits: number | null;
  spread: number | null;
  tradeMode: number | null;
  visible: boolean;
}

export interface Mt5SymbolsResponse {
  symbols: Mt5Symbol[];
  count: number;
  totalMatches: number;
  truncated: boolean;
  source: string;
}

export interface Mt5Candle {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  realVolume: number | null;
}

export interface Mt5CandleResponse {
  symbol: string;
  date?: string;
  timeframe: Mt5Timeframe;
  source: 'mt5';
  broker: string | null;
  timezone: 'UTC';
  sessionStart: string | null;
  sessionEnd: string | null;
  reason: string | null;
  count: number;
  candles: Mt5Candle[];
}

export interface Mt5LatestResponse extends Omit<Mt5CandleResponse, 'date'> {
  date?: undefined;
}

export interface Mt5Tick {
  timestamp: number;
  timestampMs: number;
  time: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  realVolume: number;
  flags: number;
}

export interface Mt5TicksResponse {
  symbol: string;
  source: 'mt5';
  timezone: 'UTC';
  count: number;
  ticks: Mt5Tick[];
}

export interface Mt5CandlesQuery {
  symbol?: string;
  date?: string;
  timeframe?: string;
}

export interface Mt5LatestQuery {
  symbol?: string;
  timeframe?: string;
  count?: string;
}

export interface Mt5TicksQuery {
  symbol?: string;
  start?: string;
  end?: string;
  limit?: string;
}
