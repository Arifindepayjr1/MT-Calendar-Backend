"""Unit tests for the read-only MT5 stdio worker.

A fake MT5 module is injected, so these tests run without a terminal or broker
connection. Timezone handling, full-session selection, deduplication, and
error mapping are covered here.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import mt5_worker as worker  # noqa: E402

UTC = dt.timezone.utc


class Obj:
    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)


class FakeMT5:
    TIMEFRAME_M1 = 1
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 60
    TIMEFRAME_H4 = 240
    TIMEFRAME_D1 = 1440
    COPY_TICKS_ALL = 0

    def __init__(self) -> None:
        self.init_ok = True
        self.initialized = False
        self.rates: List[Dict[str, Any]] = []
        self.ticks: List[Obj] = []
        self.range_calls: List[tuple] = []
        self.from_pos_calls: List[tuple] = []

    def initialize(self, path: str | None = None) -> bool:
        self.initialized = self.init_ok
        return self.init_ok

    def shutdown(self) -> None:
        self.initialized = False

    def last_error(self) -> tuple:
        return (1, "Success") if self.init_ok else (-10006, "IPC initialize failed")

    def version(self) -> tuple:
        return (5, 0, 45, "build test")

    def terminal_info(self) -> Obj:
        return Obj(
            connected=True,
            name="VT Markets MT5 Terminal",
            path=r"C:\Program Files\VT Markets (Pty) MT5 Terminal\terminal64.exe",
            trade_allowed=True,
        )

    def account_info(self) -> Obj:
        # login is deliberately included to prove the worker never returns it.
        return Obj(company="VT Markets", server="VTMarkets-Live", login=12345678, currency="USD")

    def symbols_get(self) -> tuple:
        return (
            Obj(
                name="XAUUSD-ECNc",
                description="Gold vs US Dollar",
                currency_base="XAU",
                currency_profit="USD",
                digits=2,
                spread=20,
                trade_mode=0,
                visible=True,
            ),
            Obj(
                name="EURUSD-ECNc",
                description="Euro vs US Dollar",
                currency_base="EUR",
                currency_profit="USD",
                digits=5,
                spread=12,
                trade_mode=0,
                visible=True,
            ),
        )

    def symbol_info(self, name: str) -> Obj | None:
        for symbol in self.symbols_get():
            if symbol.name == name:
                return symbol
        return None

    def symbol_select(self, name: str, selected: bool) -> bool:
        return self.symbol_info(name) is not None

    def copy_rates_range(self, symbol: str, timeframe: int, start: int, end: int) -> list:
        self.range_calls.append((symbol, timeframe, start, end))
        return [rate for rate in self.rates if start <= int(rate["time"]) < end]

    def copy_rates_from_pos(self, symbol: str, timeframe: int, start: int, count: int) -> list:
        self.from_pos_calls.append((symbol, timeframe, start, count))
        return self.rates[-count:]

    def copy_ticks_range(self, symbol: str, start: int, end: int, flags: int) -> tuple:
        return tuple(
            tick for tick in self.ticks if start <= int(tick.time) <= end
        )


def rate(timestamp: int, open_price: float = 100.0) -> Dict[str, Any]:
    return {
        "time": timestamp,
        "open": open_price,
        "high": open_price + 2,
        "low": open_price - 1,
        "close": open_price + 1,
        "tick_volume": 10,
        "spread": 5,
        "real_volume": 0,
    }


def ts(year: int, month: int, day: int, hour: int, minute: int) -> int:
    return int(dt.datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp())


@pytest.fixture()
def fake(monkeypatch: pytest.MonkeyPatch) -> tuple[worker.Mt5Bridge, FakeMT5]:
    module = FakeMT5()
    monkeypatch.setattr(worker.Mt5Bridge, "module", lambda self: module)
    return worker.Mt5Bridge(terminal_path=None), module


def test_status_reports_connection_without_credentials(fake: tuple) -> None:
    bridge, _ = fake
    status = bridge.status()
    assert status["initialized"] is True
    assert status["connected"] is True
    assert status["broker"] == "VT Markets"
    assert status["server"] == "VTMarkets-Live"
    assert "12345678" not in json.dumps(status)


def test_status_reports_disconnected_terminal(fake: tuple) -> None:
    bridge, module = fake
    module.init_ok = False
    status = bridge.status()
    assert status["initialized"] is False
    assert status["connected"] is False
    assert "not initialized" in status["error"]
    assert status["errorCode"] == "mt5_disconnected"


def test_symbols_can_be_searched_by_exact_broker_name(fake: tuple) -> None:
    bridge, _ = fake
    data = bridge.symbols(search="xau")
    assert [item["symbol"] for item in data["symbols"]] == ["XAUUSD-ECNc"]


def test_unknown_broker_symbol_returns_clear_error(fake: tuple) -> None:
    bridge, _ = fake
    with pytest.raises(worker.WorkerError) as exc:
        bridge.candles("EURUSD", "2026-11-24", "M15")
    assert exc.value.code == "unknown_symbol"
    assert "EURUSD" in exc.value.message


def test_invalid_timeframe_and_date_are_rejected(fake: tuple) -> None:
    bridge, _ = fake
    with pytest.raises(worker.WorkerError) as tf_exc:
        bridge.candles("XAUUSD-ECNc", "2026-11-24", "W1")
    assert tf_exc.value.code == "invalid_timeframe"

    with pytest.raises(worker.WorkerError) as date_exc:
        bridge.candles("XAUUSD-ECNc", "24-11-2026", "M15")
    assert date_exc.value.code == "invalid_date"


def test_full_session_includes_before_entry_and_after_exit(fake: tuple) -> None:
    bridge, module = fake
    day = dt.date(2026, 11, 24)
    module.rates = [
        rate(ts(2026, 11, 23, 23, minute))  # broker session starts before entry
        for minute in (0, 15, 30, 45)
    ]
    module.rates += [
        rate(ts(2026, 11, 24, hour, minute))
        for hour in range(24)
        for minute in (0, 15, 30, 45)
    ]
    module.rates.append(rate(ts(2026, 11, 25, 2, 0)))  # next session excluded

    data = bridge.candles("XAUUSD-ECNc", day.isoformat(), "M15")
    timestamps = [candle["timestamp"] for candle in data["candles"]]

    assert data["reason"] is None
    assert data["source"] == "mt5"
    assert data["timezone"] == "UTC"
    assert timestamps[0] == ts(2026, 11, 23, 23, 0)
    assert ts(2026, 11, 24, 0, 15) in timestamps
    assert ts(2026, 11, 24, 1, 0) in timestamps
    assert ts(2026, 11, 25, 2, 0) not in timestamps
    assert data["sessionStart"] == "2026-11-23T23:00:00Z"
    assert data["sessionEnd"] == "2026-11-24T23:45:00Z"
    assert len(timestamps) == len(set(timestamps))


def test_split_same_date_groups_selects_the_main_broker_session(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [
        rate(ts(2026, 11, 24, 0, 0)),
        rate(ts(2026, 11, 24, 0, 15)),
        rate(ts(2026, 11, 24, 6, 0)),
        rate(ts(2026, 11, 24, 6, 15)),
        rate(ts(2026, 11, 24, 6, 30)),
        rate(ts(2026, 11, 24, 6, 45)),
    ]
    data = bridge.candles("XAUUSD-ECNc", "2026-11-24", "M15")
    timestamps = [candle["timestamp"] for candle in data["candles"]]
    assert timestamps[0] == ts(2026, 11, 24, 6, 0)
    assert ts(2026, 11, 24, 0, 0) not in timestamps


def test_weekend_with_no_broker_data_returns_empty_result(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [rate(ts(2026, 11, 24, 12, 0))]
    data = bridge.candles("XAUUSD-ECNc", "2026-11-28", "M15")
    assert data["candles"] == []
    assert data["count"] == 0
    assert data["reason"] == "no_broker_history"


def test_duplicate_and_unsorted_rates_are_normalized(fake: tuple) -> None:
    bridge, module = fake
    first = ts(2026, 11, 24, 0, 0)
    second = ts(2026, 11, 24, 0, 1)
    module.rates = [
        rate(second, open_price=100),
        rate(first, open_price=200),
        rate(second, open_price=999),
    ]
    data = bridge.candles("XAUUSD-ECNc", "2026-11-24", "M1")
    assert [item["timestamp"] for item in data["candles"]] == [first, second]
    assert data["candles"][1]["open"] == 999


def test_changing_timeframe_uses_different_mt5_constants(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [rate(ts(2026, 11, 24, 0, 0)), rate(ts(2026, 11, 24, 1, 0))]

    m15 = bridge.candles("XAUUSD-ECNc", "2026-11-24", "M15")
    h1 = bridge.candles("XAUUSD-ECNc", "2026-11-24", "H1")

    assert m15["timeframe"] == "M15"
    assert h1["timeframe"] == "H1"
    assert module.range_calls[0][1] != module.range_calls[1][1]
    assert module.range_calls[0][2:] == module.range_calls[1][2:]


def test_daily_timeframe_returns_centered_real_bars(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [
        rate(ts(2026, 11, day, 0, 0)) for day in range(18, 31)
    ]
    data = bridge.candles("XAUUSD-ECNc", "2026-11-24", "D1")
    assert data["timeframe"] == "D1"
    assert 7 <= data["count"] <= 15
    assert any(candle["time"].startswith("2026-11-24") for candle in data["candles"])


def test_latest_uses_copy_rates_from_pos(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [rate(ts(2026, 11, 24, 0, 0)), rate(ts(2026, 11, 24, 0, 15))]
    data = bridge.latest("XAUUSD-ECNc", "M15", count=2)
    assert data["count"] == 2
    assert module.from_pos_calls[0][1] == FakeMT5.TIMEFRAME_M15


def test_ticks_are_returned_as_utc(fake: tuple) -> None:
    bridge, module = fake
    moment = ts(2026, 11, 24, 12, 0)
    module.ticks = [
        Obj(
            time=moment,
            time_msc=moment * 1000 + 250,
            bid=2650.1,
            ask=2650.35,
            last=2650.2,
            volume=1,
            volume_real=1.5,
            flags=6,
        )
    ]
    data = bridge.ticks(
        "XAUUSD-ECNc",
        "2026-11-24T11:00:00Z",
        "2026-11-24T13:00:00Z",
        limit=10,
    )
    assert data["count"] == 1
    assert data["ticks"][0]["time"] == "2026-11-24T12:00:00Z"


def test_protocol_reports_unknown_commands(fake: tuple) -> None:
    bridge, _ = fake
    response = bridge.handle({"id": "req-7", "command": "place_order"})
    assert response["id"] == "req-7"
    assert response["ok"] is False
    assert response["error"]["code"] == "unknown_command"


def test_protocol_accepts_nested_payload_from_nestjs(fake: tuple) -> None:
    bridge, module = fake
    module.rates = [rate(ts(2026, 11, 24, 0, 0))]
    response = bridge.handle(
        {
            "id": "req-8",
            "command": "candles",
            "payload": {
                "symbol": "XAUUSD-ECNc",
                "date": "2026-11-24",
                "timeframe": "M15",
            },
        }
    )
    assert response["ok"] is True
    assert response["data"]["symbol"] == "XAUUSD-ECNc"
    assert response["data"]["count"] == 1
