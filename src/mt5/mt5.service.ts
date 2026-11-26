import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MT5_TIMEFRAMES,
  Mt5CandleResponse,
  Mt5LatestQuery,
  Mt5LatestResponse,
  Mt5StatusResponse,
  Mt5SymbolsResponse,
  Mt5TicksQuery,
  Mt5TicksResponse,
  Mt5Timeframe,
} from './mt5.models';

export class Mt5BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'Mt5BridgeError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

interface CachedValue {
  expiresAt: number;
  value: unknown;
}

/**
 * Owns one internal Python stdio worker. NestJS remains the only HTTP API;
 * the worker is a child process and is never bound to a network port.
 */
@Injectable()
export class Mt5Service implements OnModuleDestroy {
  private readonly logger = new Logger(Mt5Service.name);
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly cache = new Map<string, CachedValue>();
  private readonly requestTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly workerPath: string;

  constructor(private readonly config: ConfigService) {
    this.requestTimeoutMs = this.configNumber('MT5_REQUEST_TIMEOUT_MS', 30_000);
    this.cacheTtlMs = this.configNumber('MT5_CACHE_TTL_SECONDS', 60) * 1_000;
    const configuredWorker = this.config.get<string>('MT5_WORKER_PATH');
    const moduleRelative = resolve(__dirname, '..', '..', '..', 'mt5_worker.py');
    this.workerPath =
      configuredWorker ||
      (existsSync(moduleRelative) ? moduleRelative : resolve(process.cwd(), 'mt5_worker.py'));
  }

  onModuleDestroy(): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Mt5BridgeError('MT5_UNAVAILABLE', 'MT5 worker is shutting down.'));
    }
    this.pending.clear();
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = null;
  }

  async status(): Promise<Mt5StatusResponse> {
    try {
      return await this.request<Mt5StatusResponse>('status', {});
    } catch (error) {
      const described = this.describe(error);
      return {
        initialized: false,
        connected: false,
        terminal: null,
        broker: null,
        server: null,
        error: described.message,
        errorCode: described.code,
        source: 'nestjs',
      };
    }
  }

  async symbols(search?: string): Promise<Mt5SymbolsResponse> {
    if (search && search.length > 128) {
      throw this.validationError('search must be 128 characters or fewer.');
    }
    return this.call<Mt5SymbolsResponse>('symbols', { search: search || '' }, true);
  }

  async candles(query: {
    symbol?: string;
    date?: string;
    timeframe?: string;
  }): Promise<Mt5CandleResponse> {
    const payload = {
      symbol: this.validateSymbol(query.symbol),
      date: this.validateDate(query.date),
      timeframe: this.validateTimeframe(query.timeframe),
    };
    return this.call<Mt5CandleResponse>('candles', payload, true);
  }

  async latest(query: Mt5LatestQuery): Promise<Mt5LatestResponse> {
    const payload = {
      symbol: this.validateSymbol(query.symbol),
      timeframe: this.validateTimeframe(query.timeframe),
      count: this.validatePositiveInt(query.count, 'count', 1, 5_000, 200),
    };
    return this.call<Mt5LatestResponse>('latest', payload, true);
  }

  async ticks(query: Mt5TicksQuery): Promise<Mt5TicksResponse> {
    const payload: Record<string, unknown> = {
      symbol: this.validateSymbol(query.symbol),
      limit: this.validatePositiveInt(query.limit, 'limit', 1, 5_000, 1_000),
    };
    if (query.start) payload.start = this.validateIsoTimestamp(query.start, 'start');
    if (query.end) payload.end = this.validateIsoTimestamp(query.end, 'end');
    return this.call<Mt5TicksResponse>('ticks', payload, false);
  }

  // -- Worker lifecycle and protocol ----------------------------------------

  private getProcess(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }

    const interpreter = this.resolveInterpreter();
    this.child = spawn(interpreter.command, [...interpreter.args, this.workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        MT5_TERMINAL_PATH: this.config.get<string>('MT5_TERMINAL_PATH') || '',
      },
    });

    this.stdoutBuffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onWorkerStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => this.onWorkerStderr(chunk));
    this.child.on('exit', (code, signal) => this.onWorkerExit(code, signal));
    this.child.on('error', (error) => this.onWorkerError(error));
    return this.child;
  }

  private resolveInterpreter(): { command: string; args: string[] } {
    const configured = this.config.get<string>('MT5_PYTHON');
    if (configured) return { command: configured, args: [] };

    const venvPython =
      process.platform === 'win32'
        ? resolve(process.cwd(), '.venv', 'Scripts', 'python.exe')
        : resolve(process.cwd(), '.venv', 'bin', 'python');
    if (existsSync(venvPython)) return { command: venvPython, args: [] };

    if (process.platform === 'win32') return { command: 'py', args: ['-3.12'] };
    return { command: 'python3', args: [] };
  }

  private onWorkerStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (!line) continue;

      let response: {
        id?: string | number | null;
        ok?: boolean;
        data?: unknown;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      try {
        response = JSON.parse(line);
      } catch {
        this.logger.warn('MT5 worker emitted a non-JSON line on stdout.');
        continue;
      }

      if (response.id === null || response.id === undefined) continue;
      const request = this.pending.get(String(response.id));
      if (!request) continue;
      this.pending.delete(String(response.id));
      clearTimeout(request.timer);

      if (response.ok && response.data !== undefined) {
        request.resolve(response.data);
      } else {
        request.reject(
          new Mt5BridgeError(
            response.error?.code || 'MT5_WORKER_ERROR',
            response.error?.message || 'The MT5 worker rejected the request.',
            response.error?.details,
          ),
        );
      }
    }
  }

  private onWorkerStderr(chunk: string): void {
    const text = chunk.trim();
    if (text) this.logger.debug(`MT5 worker: ${text.slice(0, 500)}`);
  }

  private onWorkerExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    this.stdoutBuffer = '';
    const reason = `MT5 worker exited (code=${code ?? 'none'}, signal=${signal ?? 'none'}).`;
    this.rejectPending(new Mt5BridgeError('MT5_UNAVAILABLE', reason));
  }

  private onWorkerError(error: Error): void {
    this.child = null;
    this.rejectPending(
      new Mt5BridgeError(
        'MT5_UNAVAILABLE',
        `Could not start the MT5 Python worker: ${error.message}`,
      ),
    );
  }

  private rejectPending(error: Mt5BridgeError): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request<T>(command: string, payload: Record<string, unknown>): Promise<T> {
    const child = this.getProcess();
    const id = `${Date.now()}-${this.nextRequestId++}`;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Mt5BridgeError(
            'MT5_TIMEOUT',
            `MT5 worker did not answer within ${this.requestTimeoutMs}ms.`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolvePromise as (value: unknown) => void,
        reject: rejectPromise,
        timer,
      });

      child.stdin.write(
        `${JSON.stringify({ id, command, payload })}\n`,
        (error?: Error | null) => {
          if (!error) return;
          const request = this.pending.get(id);
          if (!request) return;
          this.pending.delete(id);
          clearTimeout(timer);
          rejectPromise(
            new Mt5BridgeError('MT5_UNAVAILABLE', `Could not write to MT5 worker: ${error.message}`),
          );
        },
      );
    });
  }

  // -- Caching and validation -----------------------------------------------

  private async call<T>(
    command: string,
    payload: Record<string, unknown>,
    cacheable: boolean,
  ): Promise<T> {
    const key = `${command}:${JSON.stringify(payload)}`;
    if (cacheable) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value as T;
      if (cached) this.cache.delete(key);
    }

    try {
      const data = await this.request<T>(command, payload);
      if (cacheable && this.cacheTtlMs > 0) {
        this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, value: data });
      }
      return data;
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private describe(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
    if (error instanceof Mt5BridgeError) {
      return { code: error.code, message: error.message, details: error.details };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'message' in response) {
        return {
          code: 'VALIDATION_ERROR',
          message: String((response as { message: unknown }).message),
        };
      }
    }
    return {
      code: 'MT5_INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    const described = this.describe(error);
    const statusByCode: Record<string, HttpStatus> = {
      invalid_symbol: HttpStatus.BAD_REQUEST,
      invalid_date: HttpStatus.BAD_REQUEST,
      invalid_timeframe: HttpStatus.BAD_REQUEST,
      invalid_timestamp: HttpStatus.BAD_REQUEST,
      invalid_request: HttpStatus.BAD_REQUEST,
      unknown_symbol: HttpStatus.NOT_FOUND,
      session_too_large: HttpStatus.BAD_REQUEST,
      symbol_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
      mt5_disconnected: HttpStatus.SERVICE_UNAVAILABLE,
      mt5_package_missing: HttpStatus.SERVICE_UNAVAILABLE,
      MT5_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
      MT5_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
      mt5_call_failed: HttpStatus.BAD_GATEWAY,
      internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
      unknown_command: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    const status = statusByCode[described.code] ?? HttpStatus.BAD_GATEWAY;
    return new HttpException(
      {
        statusCode: status,
        code: described.code,
        message: described.message,
        ...(described.details ? { details: described.details } : {}),
      },
      status,
    );
  }

  private validationError(message: string): HttpException {
    return new HttpException(
      { statusCode: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR', message },
      HttpStatus.BAD_REQUEST,
    );
  }

  private validateSymbol(value: string | undefined): string {
    const symbol = (value || '').trim();
    if (!symbol || symbol.length > 128 || !/^[\w.\-#+$!]+$/.test(symbol)) {
      throw this.validationError(
        'symbol is required and may contain only broker symbol characters (max 128).',
      );
    }
    return symbol;
  }

  private validateTimeframe(value: string | undefined): Mt5Timeframe {
    const timeframe = (value || '').trim().toUpperCase() as Mt5Timeframe;
    if (!MT5_TIMEFRAMES.includes(timeframe)) {
      throw this.validationError(
        'timeframe must be one of M1, M5, M15, M30, H1, H4, D1.',
      );
    }
    return timeframe;
  }

  private validateDate(value: string | undefined): string {
    const date = (value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw this.validationError('date must be a valid YYYY-MM-DD date.');
    }
    return date;
  }

  private validateIsoTimestamp(value: string, name: string): string {
    if (Number.isNaN(Date.parse(value))) {
      throw this.validationError(`${name} must be a valid ISO-8601 timestamp.`);
    }
    return value;
  }

  private validatePositiveInt(
    value: string | undefined,
    name: string,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw this.validationError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
  }

  private configNumber(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
