import asyncio
import time

from fastapi.testclient import TestClient

from main import (
    AutonomousQuantAuditor,
    CompanyProfile,
    MarketData,
    PriceSnapshot,
    TLHAnalysisResult,
    TaxEngine,
    TwinMatch,
    build_app,
)


class FakeDB:
    def __init__(self, company: CompanyProfile | None):
        self.company = company

    def get_company_profile(self, ticker: str) -> CompanyProfile | None:
        return self.company


class FakeMarketData:
    def __init__(self, price_snapshot: PriceSnapshot | None):
        self.price_snapshot = price_snapshot

    def get_current_price(self, ticker: str) -> PriceSnapshot | None:
        return self.price_snapshot


class FakeAuditor:
    def __init__(self, result: TLHAnalysisResult):
        self.result = result
        self.calls: list[dict[str, object]] = []

    async def analyze_loss_opportunity(
        self,
        company: CompanyProfile,
        buy_price: float,
        price_snapshot: PriceSnapshot,
        session_id: str,
    ) -> TLHAnalysisResult:
        self.calls.append(
            {
                "company": company,
                "buy_price": buy_price,
                "price_snapshot": price_snapshot,
                "session_id": session_id,
            }
        )
        return self.result


def sample_company() -> CompanyProfile:
    return CompanyProfile(
        ticker="AAPL",
        security_name="Apple Inc.",
        description="Consumer technology company with hardware, software, and services offerings.",
        embedding=[0.1, 0.2, 0.3],
    )


def sample_twin() -> TwinMatch:
    return TwinMatch(
        ticker="MSFT",
        security_name="Microsoft Corporation",
        description="Technology company with software, cloud, devices, and productivity platforms.",
        similarity=0.91,
    )


def sample_price(price: float) -> PriceSnapshot:
    return PriceSnapshot(
        ticker="AAPL",
        current_price=price,
        cached=False,
        fetched_at_epoch=time.time(),
    )


def sample_harvest_result() -> TLHAnalysisResult:
    return TLHAnalysisResult(
        status="HARVEST",
        ticker="AAPL",
        buy_price=200.0,
        price_data=sample_price(150.0),
        loss_per_share=50.0,
        twin=sample_twin(),
        suitability_memo=[
            "- Apple and Microsoft both provide broad technology exposure across enterprise and consumer ecosystems.",
            "- Microsoft offers similar large-cap technology exposure while remaining a distinct issuer with different product concentration.",
            "- The replacement appears comparable for portfolio intent without looking substantially identical for wash-sale purposes.",
        ],
    )


def build_test_engine(
    *,
    company: CompanyProfile | None,
    price_snapshot: PriceSnapshot | None,
    auditor_result: TLHAnalysisResult | None = None,
) -> tuple[TaxEngine, FakeAuditor]:
    fake_auditor = FakeAuditor(auditor_result or sample_harvest_result())
    engine = TaxEngine(
        db=FakeDB(company=company),
        market_data=FakeMarketData(price_snapshot=price_snapshot),
        auditor=fake_auditor,
    )
    return engine, fake_auditor


def test_tax_engine_returns_hold_for_gain():
    engine, fake_auditor = build_test_engine(
        company=sample_company(),
        price_snapshot=sample_price(250.0),
    )

    result = asyncio.run(engine.analyze_tlh_opportunity("AAPL", 200.0))

    assert result.status == "HOLD"
    assert result.gain_per_share == 50.0
    assert result.twin is None
    assert result.suitability_memo == []
    assert fake_auditor.calls == []


def test_tax_engine_uses_agentic_auditor_for_loss():
    engine, fake_auditor = build_test_engine(
        company=sample_company(),
        price_snapshot=sample_price(150.0),
    )

    result = asyncio.run(engine.analyze_tlh_opportunity("AAPL", 200.0, session_id="client-123"))

    assert result.status == "HARVEST"
    assert result.loss_per_share == 50.0
    assert result.twin is not None
    assert result.twin.ticker == "MSFT"
    assert len(result.suitability_memo) == 3
    assert fake_auditor.calls[0]["session_id"] == "client-123"


def test_tax_engine_raises_for_missing_company():
    engine, _ = build_test_engine(
        company=None,
        price_snapshot=sample_price(150.0),
    )

    try:
        asyncio.run(engine.analyze_tlh_opportunity("AAPL", 200.0))
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert str(exc) == "Ticker not found in vector database"


def test_analyze_endpoint_returns_clean_json():
    engine, _ = build_test_engine(
        company=sample_company(),
        price_snapshot=sample_price(150.0),
    )
    app = build_app(engine=engine)
    client = TestClient(app)

    response = client.get(
        "/analyze",
        params={"ticker": "AAPL", "buy_price": 200.0, "session_id": "demo-session"},
    )

    assert response.status_code == 200
    payload = response.json()["result"]
    assert payload["status"] == "HARVEST"
    assert payload["price_data"]["current_price"] == 150.0
    assert payload["twin"]["ticker"] == "MSFT"
    assert len(payload["suitability_memo"]) == 3


def test_market_data_uses_ttl_cache(monkeypatch):
    class FakeSeriesIloc:
        def __init__(self, value: float):
            self._value = value

        def __getitem__(self, index: int) -> float:
            return self._value

    class FakeSeries:
        def __init__(self, value: float):
            self.iloc = FakeSeriesIloc(value)

    class FakeHistory:
        empty = False

        def __getitem__(self, key: str) -> FakeSeries:
            assert key == "Close"
            return FakeSeries(123.45)

    call_count = {"count": 0}

    class FakeTicker:
        def __init__(self, ticker: str):
            call_count["count"] += 1

        def history(self, period: str) -> FakeHistory:
            assert period == "1d"
            return FakeHistory()

    monkeypatch.setattr("main.yf.Ticker", FakeTicker)

    market_data = MarketData(ttl_seconds=300)

    first = market_data.get_current_price("aapl")
    second = market_data.get_current_price("AAPL")

    assert first is not None
    assert second is not None
    assert first.cached is False
    assert second.cached is True
    assert first.current_price == 123.45
    assert second.current_price == 123.45
    assert call_count["count"] == 1


def test_agent_memory_reuses_session_window():
    auditor = AutonomousQuantAuditor.__new__(AutonomousQuantAuditor)
    auditor._session_memories = {}

    first = auditor._get_memory("abc")
    second = auditor._get_memory("abc")
    third = auditor._get_memory("xyz")

    assert first is second
    assert first is not third
