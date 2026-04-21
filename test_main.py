import asyncio
import time

from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import (
    CompanyProfile,
    MarketData,
    MultiAgentChecker,
    PriceSnapshot,
    StrategistProposal,
    TLHAnalysisResult,
    TaxEngine,
    TwinMatch,
    AuditVerdict,
    MemoOutput,
    build_app,
    parse_workspace_uuid,
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


class FakeChecker:
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


def sample_twin(ticker: str = "MSFT", similarity: float = 0.91) -> TwinMatch:
    return TwinMatch(
        ticker=ticker,
        security_name="Microsoft Corporation" if ticker == "MSFT" else "Alphabet Inc. Class C",
        description="Technology company with software, cloud, devices, and productivity platforms."
        if ticker == "MSFT"
        else "Internet services and advertising platform.",
        similarity=similarity,
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
    checker_result: TLHAnalysisResult | None = None,
) -> tuple[TaxEngine, FakeChecker]:
    fake_checker = FakeChecker(checker_result or sample_harvest_result())
    engine = TaxEngine(
        db=FakeDB(company=company),
        market_data=FakeMarketData(price_snapshot=price_snapshot),
        checker=fake_checker,
    )
    return engine, fake_checker


def test_tax_engine_returns_hold_for_gain():
    engine, fake_checker = build_test_engine(
        company=sample_company(),
        price_snapshot=sample_price(250.0),
    )

    result = asyncio.run(engine.analyze_tlh_opportunity("AAPL", 200.0))

    assert result.status == "HOLD"
    assert result.gain_per_share == 50.0
    assert result.twin is None
    assert result.suitability_memo == []
    assert fake_checker.calls == []


def test_tax_engine_uses_checker_for_loss():
    engine, fake_checker = build_test_engine(
        company=sample_company(),
        price_snapshot=sample_price(150.0),
    )

    result = asyncio.run(engine.analyze_tlh_opportunity("AAPL", 200.0, session_id="client-123"))

    assert result.status == "HARVEST"
    assert result.loss_per_share == 50.0
    assert result.twin is not None
    assert result.twin.ticker == "MSFT"
    assert len(result.suitability_memo) == 3
    assert fake_checker.calls[0]["session_id"] == "client-123"


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


def test_checker_memory_reuses_session_window():
    checker = MultiAgentChecker.__new__(MultiAgentChecker)
    checker._strategist_memories = {}

    first = checker._get_strategist_memory("abc")
    second = checker._get_strategist_memory("abc")
    third = checker._get_strategist_memory("xyz")

    assert first is second
    assert first is not third


def test_checker_loops_until_auditor_approves():
    checker = MultiAgentChecker.__new__(MultiAgentChecker)
    checker._strategist_memories = {}

    proposals = [
        StrategistProposal(
            proposed_twin=sample_twin("GOOG", 0.98),
            rationale="Closest semantic match.",
        ),
        StrategistProposal(
            proposed_twin=sample_twin("MSFT", 0.91),
            rationale="Next best match after rejection.",
        ),
    ]
    verdicts = [
        AuditVerdict(
            verdict="REJECTED",
            explanation="This is effectively the same issuer exposure. Try again.",
        ),
        AuditVerdict(
            verdict="APPROVED",
            explanation="Acceptable replacement.",
        ),
    ]
    memos = [
        MemoOutput(
            suitability_memo=[
                "- Apple and Microsoft both sit in large-cap technology ecosystems.",
                "- Microsoft is a distinct issuer, not a share-class variant of Apple.",
                "- The overlap is strong for exposure goals without looking substantially identical.",
            ]
        )
    ]

    async def fake_run_strategist(company, session_id, rejected_tickers, auditor_feedback):
        if rejected_tickers:
            assert rejected_tickers == ["GOOG"]
            assert "same issuer exposure" in auditor_feedback
        return proposals.pop(0)

    async def fake_run_auditor(company, proposal):
        return verdicts.pop(0)

    async def fake_run_memo_writer(company, proposal, verdict):
        assert verdict.verdict == "APPROVED"
        return memos.pop(0)

    checker._run_strategist = fake_run_strategist
    checker._run_auditor = fake_run_auditor
    checker._run_memo_writer = fake_run_memo_writer

    result = asyncio.run(
        checker.analyze_loss_opportunity(
            company=sample_company(),
            buy_price=200.0,
            price_snapshot=sample_price(150.0),
            session_id="session-1",
        )
    )

    assert result.status == "HARVEST"
    assert result.twin is not None
    assert result.twin.ticker == "MSFT"
    assert len(result.suitability_memo) == 3


def test_checker_raises_after_three_rejections():
    checker = MultiAgentChecker.__new__(MultiAgentChecker)
    checker._strategist_memories = {}

    proposals = [
        StrategistProposal(proposed_twin=sample_twin("GOOG", 0.98), rationale="First try."),
        StrategistProposal(proposed_twin=sample_twin("META", 0.92), rationale="Second try."),
        StrategistProposal(proposed_twin=sample_twin("ADBE", 0.88), rationale="Third try."),
    ]
    verdicts = [
        AuditVerdict(verdict="REJECTED", explanation="Same issuer issue."),
        AuditVerdict(verdict="REJECTED", explanation="Still too close."),
        AuditVerdict(verdict="REJECTED", explanation="No clean substitute."),
    ]

    async def fake_run_strategist(company, session_id, rejected_tickers, auditor_feedback):
        return proposals.pop(0)

    async def fake_run_auditor(company, proposal):
        return verdicts.pop(0)

    async def fake_run_memo_writer(company, proposal, verdict):
        assert False, "Memo writer should not run on rejected candidates"

    checker._run_strategist = fake_run_strategist
    checker._run_auditor = fake_run_auditor
    checker._run_memo_writer = fake_run_memo_writer

    try:
        asyncio.run(
            checker.analyze_loss_opportunity(
                company=sample_company(),
                buy_price=200.0,
                price_snapshot=sample_price(150.0),
                session_id="session-2",
            )
        )
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert "No compliant replacement found after 3 review cycles" in str(exc)


def test_parse_workspace_uuid_rejects_invalid_value():
    try:
        parse_workspace_uuid("not-a-uuid")
        assert False, "Expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "workspace_id must be a valid UUID"
