#!/usr/bin/env python3
"""Internal, read-only MetaTrader 5 stdio worker.

This is deliberately NOT an HTTP server. NestJS owns the public API and spawns
this process. Requests and responses are newline-delimited JSON on stdin/stdout.

Example request::

    {"id":"1","command":"candles","symbol":"XAUUSD-ECNc","date":"2026-11-24","timeframe":"M15"}

Example response::

    {"id":"1","ok":true,"data":{...}}

All market timestamps are emitted as UTC ISO-8601 strings plus epoch seconds.
The worker never places, modifies, or closes trades.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import importlib
import json
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

UTC = dt.timezone.utc

TIMEFRAMES: Dict[str, Tuple[str, int]] = {
    "M1": ("TIMEFRAME_M1", 60),
    "M5": ("TIMEFRAME_M5", 300),
    "M15": ("TIMEFRAME_M15", 900),
    "M30": ("TIMEFRAME_M30", 1800),
    "H1": ("TIMEFRAME_H1", 3600),
    "H4": ("TIMEFRAME_H4", 14400),
    "D1": ("TIMEFRAME_D1", 86400),
}


@dataclass
class WorkerError(Exception):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def _iso_from_timestamp(timestamp: int) -> str:
    return (
        dt.datetime.fromtimestamp(timestamp, UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _field(row: Any, name: str, default: Any = None) -> Any:
    """Read a field from dicts and numpy.void structured-array rows."""
    if isinstance(row, dict):
        return row.get(name, default)
    try:
        return row[name]
    except (KeyError, IndexError, TypeError):
        return default


def _last_error_text(mt5: Any) -> Optional[str]:
    try:
        with contextlib.redirect_stdout(sys.stderr):
            error = mt5.last_error()
        if not error:
            return None
        if isinstance(error, (tuple, list)):
            return " ".join(str(part) for part in error if part not in (None, ""))
        return str(error)
    except Exception:
        return None


class Mt5Bridge:
    """Wraps the official MetaTrader5 package behind read-only commands."""

    def __init__(self, terminal_path: Optional[str] = None) -> None:
        self.terminal_path = terminal_path or os.environ.get("MT5_TERMINAL_PATH") or None
        self._mt5: Any = None
        self._initialized = False
        self.max_bars = _env_int("MT5_MAX_REQUEST_BARS", 5000)
        self.session_gap_multiplier = _env_float("MT5_SESSION_GAP_MULTIPLIER", 3.0, 1.0)
        self.max_session_hours = _env_float("MT5_MAX_SESSION_HOURS", 30.0, 1.0)

    # -- MetaTrader lifecycle -------------------------------------------------

    def module(self) -> Any:
        if self._mt5 is None:
            try:
                self._mt5 = importlib.import_module("MetaTrader5")
            except ImportError as exc:
                raise WorkerError(
                    "mt5_package_missing",
                    "The MetaTrader5 Python package is not installed. "
                    "Install backend/requirements-mt5.txt in a Python 3.12 virtual environment.",
                    {"detail": str(exc)},
                ) from exc
        return self._mt5

    def _broker_name(self, mt5: Any) -> Optional[str]:
        account = self._call(mt5.account_info)
        company = _attr(account, "company", None)
        return str(company) if company else None

    def _call(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            # Some MetaTrader5 builds print diagnostics. stdout is the protocol
            # channel, so route library output to stderr instead.
            with contextlib.redirect_stdout(sys.stderr):
                return func(*args, **kwargs)
        except WorkerError:
            raise
        except Exception as exc:
            name = getattr(func, "__name__", "mt5_call")
            raise WorkerError(
                "mt5_call_failed",
                f"{name} failed: {exc}",
                {"detail": str(exc)},
            ) from exc

    def ensure_initialized(self) -> Any:
        if self._initialized and self._mt5 is not None:
            return self._mt5
        mt5 = self.module()
        kwargs: Dict[str, Any] = {}
        if self.terminal_path:
            kwargs["path"] = self.terminal_path
        ok = self._call(mt5.initialize, **kwargs)
        if not ok:
            error = _last_error_text(mt5)
            raise WorkerError(
                "mt5_disconnected",
                "MT5 terminal is not initialized. Start MetaTrader 5 and log in to the broker account.",
                {"lastError": error} if error else None,
            )
        self._initialized = True
        return mt5

    def shutdown(self) -> None:
        if self._initialized and self._mt5 is not None:
            with contextlib.suppress(Exception), contextlib.redirect_stdout(sys.stderr):
                self._mt5.shutdown()
        self._initialized = False

    # -- Commands -------------------------------------------------------------

    def status(self) -> Dict[str, Any]:
        mt5 = self.module()
        try:
            self.ensure_initialized()
        except WorkerError as exc:
            return {
                "initialized": False,
                "connected": False,
                "terminal": None,
                "broker": None,
                "server": None,
                "terminalPath": self.terminal_path,
                "error": exc.message,
                "errorCode": exc.code,
                "source": "mt5",
            }

        terminal = self._call(mt5.terminal_info)
        account = self._call(mt5.account_info)
        version = self._call(mt5.version)
        connected = bool(_attr(terminal, "connected", False))
        error = None if connected else _last_error_text(mt5)
        return {
            "initialized": True,
            "connected": connected,
            "terminal": _attr(terminal, "name", None),
            "terminalPath": _attr(terminal, "path", self.terminal_path),
            "broker": _attr(account, "company", None),
            "server": _attr(account, "server", None),
            "version": list(version) if isinstance(version, (tuple, list)) else version,
            "error": error,
            "errorCode": None if connected else "mt5_disconnected",
            "source": "mt5",
        }

    def symbols(self, search: Optional[str] = None, limit: Optional[int] = None) -> Dict[str, Any]:
        mt5 = self.ensure_initialized()
        raw = self._call(mt5.symbols_get) or []
        needle = (search or "").strip().lower()
        max_items = min(_env_int("MT5_MAX_SYMBOLS", 5000), int(limit or 5000))

        result: List[Dict[str, Any]] = []
        for symbol in raw:
            name = _attr(symbol, "name", None)
            if not name:
                continue
            if needle and needle not in str(name).lower():
                continue
            result.append(
                {
                    "symbol": str(name),
                    "description": _attr(symbol, "description", None),
                    "currencyBase": _attr(symbol, "currency_base", None),
                    "currencyProfit": _attr(symbol, "currency_profit", None),
                    "digits": _attr(symbol, "digits", None),
                    "spread": _attr(symbol, "spread", None),
                    "tradeMode": _attr(symbol, "trade_mode", None),
                    "visible": bool(_attr(symbol, "visible", False)),
                }
            )
        result.sort(key=lambda item: item["symbol"])

        truncated = len(result) > max_items
        return {
            "symbols": result[:max_items],
            "count": min(len(result), max_items),
            "totalMatches": len(result),
            "truncated": truncated,
            "source": "mt5",
        }

    def _resolve_symbol(self, mt5: Any, symbol: str) -> Any:
        name = (symbol or "").strip()
        if not name:
            raise WorkerError("invalid_symbol", "symbol is required.")
        info = self._call(mt5.symbol_info, name)
        if info is None:
            raise WorkerError(
                "unknown_symbol",
                f"Broker symbol '{name}' is not available in the connected MT5 terminal.",
                {"symbol": name},
            )
        # Market Watch selection is a UI/readiness change only; it never
        # touches orders or positions. Some brokers require it before history.
        if hasattr(mt5, "symbol_select"):
            selected = self._call(mt5.symbol_select, name, True)
            if selected is False:
                raise WorkerError(
                    "symbol_unavailable",
                    f"Broker symbol '{name}' could not be selected for history requests.",
                    {"symbol": name},
                )
        return info

    def _resolve_timeframe(self, mt5: Any, timeframe: str) -> Tuple[Any, int, str]:
        name = (timeframe or "").strip().upper()
        if name not in TIMEFRAMES:
            raise WorkerError(
                "invalid_timeframe",
                "timeframe must be one of M1, M5, M15, M30, H1, H4, D1.",
                {"timeframe": timeframe},
            )
        constant_name, seconds = TIMEFRAMES[name]
        constant = getattr(mt5, constant_name, None)
        if constant is None:
            raise WorkerError(
                "unsupported_timeframe",
                f"The connected MT5 package does not expose {constant_name}.",
            )
        return constant, seconds, name

    def _normalize_rates(self, rates: Any) -> List[Dict[str, Any]]:
        candles: List[Dict[str, Any]] = []
        if rates is None:
            return candles
        try:
            iterator = iter(rates)
        except TypeError:
            return candles

        for row in iterator:
            try:
                timestamp = int(row["time"])
                candle = {
                    "timestamp": timestamp,
                    "time": _iso_from_timestamp(timestamp),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "tickVolume": int(_field(row, "tick_volume", 0) or 0),
                    "spread": int(_field(row, "spread", 0) or 0),
                    "realVolume": (
                        float(_field(row, "real_volume"))
                        if _field(row, "real_volume") is not None
                        else None
                    ),
                }
            except (KeyError, TypeError, ValueError, IndexError):
                continue
            candles.append(candle)

        unique: Dict[int, Dict[str, Any]] = {}
        for candle in candles:
            unique[candle["timestamp"]] = candle
        result = list(unique.values())
        result.sort(key=lambda item: item["timestamp"])
        return result

    def _window_for_date(self, day: dt.date, timeframe_name: str) -> Tuple[dt.datetime, dt.datetime]:
        if timeframe_name == "D1":
            start = dt.datetime.combine(day - dt.timedelta(days=7), dt.time.min, UTC)
            end = dt.datetime.combine(day + dt.timedelta(days=8), dt.time.min, UTC)
        else:
            # One day of context on each side is enough for a session that
            # crosses UTC midnight while keeping M1 requests bounded.
            start = dt.datetime.combine(day - dt.timedelta(days=1), dt.time.min, UTC)
            end = dt.datetime.combine(day + dt.timedelta(days=2), dt.time.min, UTC)
        return start, end

    def _fetch_rates(
        self,
        mt5: Any,
        symbol: str,
        timeframe: Any,
        timeframe_name: str,
        start: dt.datetime,
        end: dt.datetime,
    ) -> List[Dict[str, Any]]:
        start_ts = int(start.timestamp())
        end_ts = int(end.timestamp())
        rates = self._call(
            mt5.copy_rates_range, symbol, timeframe, start_ts, end_ts
        )
        candles = self._normalize_rates(rates)

        if not candles and hasattr(mt5, "copy_rates_from_pos"):
            # Latest-history fallback for a recent requested date. It still
            # returns real broker bars; no data is fabricated.
            latest = self._call(
                mt5.copy_rates_from_pos, symbol, timeframe, 0, self.max_bars
            )
            candles = [
                candle
                for candle in self._normalize_rates(latest)
                if start_ts <= candle["timestamp"] < end_ts
            ]
        return candles

    def _select_session(
        self,
        candles: List[Dict[str, Any]],
        day: dt.date,
        timeframe_name: str,
        timeframe_seconds: int,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        if not candles:
            return [], "no_broker_history"

        if timeframe_name == "D1":
            # A daily bar is the full session. Include nearby real daily bars
            # as context for chart navigation.
            selected = [
                candle
                for candle in candles
                if abs(
                    (
                        dt.datetime.fromtimestamp(candle["timestamp"], UTC).date() - day
                    ).days
                )
                <= 3
            ]
            if not selected:
                return [], "no_data_for_date"
            return selected, None

        gap_threshold = max(timeframe_seconds * self.session_gap_multiplier, timeframe_seconds)
        max_span_seconds = self.max_session_hours * 3600
        groups: List[List[Dict[str, Any]]] = []
        current: List[Dict[str, Any]] = [candles[0]]

        for candle in candles[1:]:
            gap = candle["timestamp"] - current[-1]["timestamp"]
            span = current[-1]["timestamp"] - current[0]["timestamp"]
            if gap > gap_threshold or span > max_span_seconds:
                groups.append(current)
                current = [candle]
            else:
                current.append(candle)
        groups.append(current)

        # A broker session can start on the previous UTC day and end on the
        # next. Pick the real session with the most bars on the requested date
        # rather than merging unrelated sessions that happen to touch it.
        scored: List[Tuple[int, List[Dict[str, Any]]]] = []
        for group in groups:
            matches = sum(
                1
                for candle in group
                if dt.datetime.fromtimestamp(candle["timestamp"], UTC).date() == day
            )
            if matches > 0:
                scored.append((matches, group))
        if not scored:
            return [], "no_data_for_date"

        scored.sort(key=lambda item: (item[0], item[1][-1]["timestamp"]), reverse=True)
        selected = scored[0][1]
        return selected, None

    def candles(
        self,
        symbol: str,
        date: str,
        timeframe: str,
    ) -> Dict[str, Any]:
        mt5 = self.ensure_initialized()
        self._resolve_symbol(mt5, symbol)
        timeframe_value, timeframe_seconds, timeframe_name = self._resolve_timeframe(
            mt5, timeframe
        )
        try:
            day = dt.date.fromisoformat((date or "").strip())
        except (TypeError, ValueError) as exc:
            raise WorkerError(
                "invalid_date", "date must be YYYY-MM-DD.", {"date": date}
            ) from exc

        start, end = self._window_for_date(day, timeframe_name)
        all_candles = self._fetch_rates(
            mt5, symbol, timeframe_value, timeframe_name, start, end
        )
        selected, reason = self._select_session(
            all_candles, day, timeframe_name, timeframe_seconds
        )

        if len(selected) > self.max_bars:
            raise WorkerError(
                "session_too_large",
                f"The selected session has {len(selected)} bars; the limit is {self.max_bars}. "
                "Use a higher timeframe.",
                {"count": len(selected), "limit": self.max_bars},
            )

        return {
            "symbol": symbol.strip(),
            "date": day.isoformat(),
            "timeframe": timeframe_name,
            "source": "mt5",
            "broker": self._broker_name(mt5),
            "timezone": "UTC",
            "sessionStart": selected[0]["time"] if selected else None,
            "sessionEnd": selected[-1]["time"] if selected else None,
            "reason": reason,
            "count": len(selected),
            "candles": selected,
        }

    def latest(
        self, symbol: str, timeframe: str, count: Optional[int] = None
    ) -> Dict[str, Any]:
        mt5 = self.ensure_initialized()
        self._resolve_symbol(mt5, symbol)
        timeframe_value, _, timeframe_name = self._resolve_timeframe(mt5, timeframe)
        limit = min(self.max_bars, int(count or 200))
        rates = self._call(mt5.copy_rates_from_pos, symbol, timeframe_value, 0, limit)
        candles = self._normalize_rates(rates)
        return {
            "symbol": symbol.strip(),
            "timeframe": timeframe_name,
            "source": "mt5",
            "broker": self._broker_name(mt5),
            "timezone": "UTC",
            "sessionStart": candles[0]["time"] if candles else None,
            "sessionEnd": candles[-1]["time"] if candles else None,
            "reason": None if candles else "no_broker_history",
            "count": len(candles),
            "candles": candles,
        }

    def ticks(
        self,
        symbol: str,
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        mt5 = self.ensure_initialized()
        self._resolve_symbol(mt5, symbol)

        def parse(value: Optional[str], fallback: dt.datetime) -> dt.datetime:
            if not value:
                return fallback
            try:
                parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=UTC)
                return parsed.astimezone(UTC)
            except ValueError as exc:
                raise WorkerError(
                    "invalid_timestamp",
                    "start/end must be ISO-8601 timestamps.",
                    {"value": value},
                ) from exc

        now = dt.datetime.now(UTC)
        start_dt = parse(start, now - dt.timedelta(hours=1))
        end_dt = parse(end, now)
        max_ticks = min(self.max_bars, int(limit or 1000))

        raw = self._call(
            mt5.copy_ticks_range,
            symbol,
            int(start_dt.timestamp()),
            int(end_dt.timestamp()),
            getattr(self.module(), "COPY_TICKS_ALL", 0),
        )
        result: List[Dict[str, Any]] = []
        for tick in raw or []:
            timestamp_ms = int(_attr(tick, "time_msc", 0) or 0)
            timestamp = int(_attr(tick, "time", 0) or 0)
            result.append(
                {
                    "timestamp": timestamp,
                    "timestampMs": timestamp_ms,
                    "time": _iso_from_timestamp(timestamp),
                    "bid": float(_attr(tick, "bid", 0) or 0),
                    "ask": float(_attr(tick, "ask", 0) or 0),
                    "last": float(_attr(tick, "last", 0) or 0),
                    "volume": int(_attr(tick, "volume", 0) or 0),
                    "realVolume": float(_attr(tick, "volume_real", 0) or 0),
                    "flags": int(_attr(tick, "flags", 0) or 0),
                }
            )
            if len(result) >= max_ticks:
                break
        return {
            "symbol": symbol.strip(),
            "source": "mt5",
            "timezone": "UTC",
            "count": len(result),
            "ticks": result,
        }

    # -- JSON-line protocol ---------------------------------------------------

    def handle(self, request: Any) -> Dict[str, Any]:
        request_id = request.get("id") if isinstance(request, dict) else None
        try:
            if not isinstance(request, dict):
                raise WorkerError("invalid_request", "Request must be a JSON object.")
            # NestJS sends arguments under `payload`; direct stdio callers may
            # use flat fields. Accept both shapes.
            args = request.get("payload")
            if not isinstance(args, dict):
                args = request
            command = str(request.get("command") or "").strip().lower()
            if command == "status":
                data = self.status()
            elif command == "symbols":
                data = self.symbols(args.get("search"), args.get("limit"))
            elif command == "candles":
                data = self.candles(
                    str(args.get("symbol") or ""),
                    str(args.get("date") or ""),
                    str(args.get("timeframe") or ""),
                )
            elif command == "latest":
                data = self.latest(
                    str(args.get("symbol") or ""),
                    str(args.get("timeframe") or ""),
                    args.get("count"),
                )
            elif command == "ticks":
                data = self.ticks(
                    str(args.get("symbol") or ""),
                    args.get("start"),
                    args.get("end"),
                    args.get("limit"),
                )
            else:
                raise WorkerError(
                    "unknown_command",
                    f"Unknown command '{command}'.",
                    {"command": command},
                )
            return {"id": request_id, "ok": True, "data": data}
        except WorkerError as exc:
            return {"id": request_id, "ok": False, "error": exc.to_dict()}
        except Exception as exc:  # pragma: no cover - defensive protocol guard
            return {
                "id": request_id,
                "ok": False,
                "error": {
                    "code": "internal_error",
                    "message": f"Unexpected worker error: {exc}",
                },
            }


def emit(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> int:
    bridge = Mt5Bridge()
    try:
        for line in sys.stdin:
            raw = line.strip()
            if not raw:
                continue
            try:
                request = json.loads(raw)
            except json.JSONDecodeError as exc:
                emit(
                    {
                        "id": None,
                        "ok": False,
                        "error": {
                            "code": "invalid_json",
                            "message": f"Invalid JSON request: {exc.msg}",
                        },
                    }
                )
                continue
            emit(bridge.handle(request))
    finally:
        bridge.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
