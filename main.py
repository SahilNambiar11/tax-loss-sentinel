import asyncio
import ast
import json
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from langchain_classic.agents import AgentExecutor, create_openai_functions_agent
from langchain_classic.memory import ConversationBufferWindowMemory
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ConfigDict, Field, field_validator
from supabase import Client, create_client
import yfinance as yf

load_dotenv()

class CompanyProfile(BaseModel):
    ticker: str
    security_name: str | None = None
    description: str | None = None
    sector: str | None = None
    sub_industry: str | None = None
    embedding: list[float] | None = None

    model_config = ConfigDict(extra="ignore")

    @field_validator("embedding", mode="before")
    @classmethod
    def parse_embedding(cls, value: object) -> object:
        if value is None or isinstance(value, list):
            return value
        if isinstance(value, str):
            parsed = ast.literal_eval(value)
            if isinstance(parsed, list):
                return [float(item) for item in parsed]
        return value


class TwinMatch(BaseModel):
    ticker: str
    security_name: str | None = None
    description: str | None = None
    similarity: float | None = None
    sector: str | None = None
    sub_industry: str | None = None

    model_config = ConfigDict(extra="ignore")


class PriceSnapshot(BaseModel):
    ticker: str
    current_price: float
    cached: bool
    fetched_at_epoch: float


class TLHAnalysisResult(BaseModel):
    status: str
    ticker: str
    buy_price: float
    price_data: PriceSnapshot
    loss_per_share: float | None = None
    gain_per_share: float | None = None
    twin: TwinMatch | None = None
    suitability_memo: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    result: TLHAnalysisResult


class SentinelDB:
    def __init__(self, url: str, service_key: str):
        self.client: Client = create_client(url, service_key)

    def get_company_profile(self, ticker: str) -> CompanyProfile | None:
        response = (
            self.client.table("companies")
            .select("ticker, security_name, description, sector, sub_industry, embedding")
            .eq("ticker", ticker)
            .limit(1)
            .execute()
        )
        if not response.data:
            return None
        return CompanyProfile.model_validate(response.data[0])

    def find_semantic_twin(
        self,
        embedding: list[float],
        exclude_ticker: str,
        match_count: int = 1,
        rejected_tickers: list[str] | None = None,
    ) -> list[TwinMatch]:
        response = self.client.rpc(
            "match_companies",
            {
                "query_embedding": embedding,
                "match_threshold": 0.5,
                "match_count": max(match_count + len(rejected_tickers or []), match_count),
                "exclude_ticker": exclude_ticker,
            },
        ).execute()
        matches = [TwinMatch.model_validate(row) for row in (response.data or [])]
        rejected = {ticker.upper() for ticker in (rejected_tickers or [])}
        filtered_matches = [match for match in matches if match.ticker.upper() not in rejected]
        return filtered_matches[:match_count]


class MarketData:
    def __init__(self, ttl_seconds: int = 300):
        self.ttl_seconds = ttl_seconds
        self._price_cache: dict[str, tuple[float, float]] = {}

    def get_current_price(self, ticker: str) -> PriceSnapshot | None:
        normalized_ticker = ticker.upper()
        now = time.time()
        cached_price = self._price_cache.get(normalized_ticker)

        if cached_price and now - cached_price[1] < self.ttl_seconds:
            return PriceSnapshot(
                ticker=normalized_ticker,
                current_price=round(cached_price[0], 2),
                cached=True,
                fetched_at_epoch=cached_price[1],
            )

        try:
            stock = yf.Ticker(normalized_ticker)
            history = stock.history(period="1d")
            if history.empty:
                return None

            price = float(history["Close"].iloc[-1])
            fetched_at = time.time()
            self._price_cache[normalized_ticker] = (price, fetched_at)
            return PriceSnapshot(
                ticker=normalized_ticker,
                current_price=round(price, 2),
                cached=False,
                fetched_at_epoch=fetched_at,
            )
        except Exception:
            return None


class AutonomousQuantAuditor:
    def __init__(self, db: SentinelDB, market_data: MarketData, api_key: str):
        self.db = db
        self.market_data = market_data
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)
        self.output_parser = PydanticOutputParser(pydantic_object=TLHAnalysisResult)
        self._session_memories: dict[str, ConversationBufferWindowMemory] = {}

    def _get_memory(self, session_id: str) -> ConversationBufferWindowMemory:
        if session_id not in self._session_memories:
            self._session_memories[session_id] = ConversationBufferWindowMemory(
                k=5,
                memory_key="chat_history",
                input_key="input",
                output_key="output",
                return_messages=True,
            )
        return self._session_memories[session_id]

    def _build_tools(self, company: CompanyProfile) -> list:
        @tool
        def get_current_price(ticker: str) -> str:
            """Fetch the latest market price snapshot for a stock ticker."""
            snapshot = self.market_data.get_current_price(ticker)
            if snapshot is None:
                return json.dumps({"error": f"Unable to fetch market price for {ticker}."})
            return snapshot.model_dump_json()

        @tool
        def search_tool(match_count: int = 3, rejected_tickers_csv: str = "") -> str:
            """Search for up to match_count semantic twin candidates for the original stock, excluding any comma-separated rejected tickers."""
            if not company.embedding:
                return json.dumps({"error": f"{company.ticker} is missing an embedding."})

            rejected_tickers = [
                ticker.strip().upper()
                for ticker in rejected_tickers_csv.split(",")
                if ticker.strip()
            ]
            twins = self.db.find_semantic_twin(
                embedding=company.embedding,
                exclude_ticker=company.ticker,
                match_count=match_count,
                rejected_tickers=rejected_tickers,
            )
            return json.dumps([twin.model_dump() for twin in twins])

        return [get_current_price, search_tool]

    def _build_executor(self, company: CompanyProfile, session_id: str) -> AgentExecutor:
        tools = self._build_tools(company)
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "You are an Autonomous Quant Auditor. Your goal is to harvest a tax loss for {ticker}.\n"
                        "Step 1: Use the search_tool to find 3 potential twins.\n"
                        "Step 2: Compare their business descriptions. If any are substantially identical, such as different share classes of the same issuer, reject them.\n"
                        "Step 3: If you reject a twin, loop back and search again with a more specific query using rejected tickers remembered from the conversation.\n"
                        "Step 4: Once a safe twin is found, output a final suitability memo.\n"
                        "Always keep suitability_memo to exactly 3 bullet strings.\n"
                        "Return only JSON that matches the required schema.\n"
                        "{format_instructions}"
                    ),
                ),
                MessagesPlaceholder(variable_name="chat_history"),
                (
                    "human",
                    (
                        "Analyze ticker {ticker} for tax-loss harvesting.\n"
                        "Buy price: {buy_price}\n"
                        "Current price snapshot: {price_data_json}\n"
                        "Current loss per share: {loss_per_share}\n"
                        "Original company name: {security_name}\n"
                        "Original company description: {description}\n"
                        "Use the current price tool to confirm the latest quote before you finalize the answer.\n"
                        "If the current price shows no loss, return a HOLD result.\n"
                        "If there is a loss, search for candidates, reject substantially identical names, and return a HARVEST result.\n"
                        "Your final answer must be valid JSON only."
                    ),
                ),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ]
        )
        agent = create_openai_functions_agent(self.llm, tools, prompt)
        return AgentExecutor(
            agent=agent,
            tools=tools,
            memory=self._get_memory(session_id),
            verbose=True,
            handle_parsing_errors=True,
        )

    @staticmethod
    def _clean_agent_output(raw_output: str) -> str:
        cleaned = raw_output.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
        return cleaned

    async def analyze_loss_opportunity(
        self,
        company: CompanyProfile,
        buy_price: float,
        price_snapshot: PriceSnapshot,
        session_id: str,
    ) -> TLHAnalysisResult:
        executor = self._build_executor(company, session_id)
        result = await executor.ainvoke(
            {
                "input": f"Find a safe tax-loss harvesting replacement for {company.ticker}.",
                "ticker": company.ticker,
                "buy_price": round(buy_price, 2),
                "price_data_json": price_snapshot.model_dump_json(),
                "loss_per_share": round(buy_price - price_snapshot.current_price, 2),
                "security_name": company.security_name or "Unknown",
                "description": company.description or "No description available.",
                "format_instructions": self.output_parser.get_format_instructions(),
            }
        )
        raw_output = self._clean_agent_output(result["output"])
        parsed = self.output_parser.parse(raw_output)
        parsed.buy_price = round(parsed.buy_price, 2)
        return parsed


class TaxEngine:
    def __init__(self, db: SentinelDB, market_data: MarketData, auditor: AutonomousQuantAuditor):
        self.db = db
        self.market_data = market_data
        self.auditor = auditor

    async def analyze_tlh_opportunity(
        self,
        ticker: str,
        buy_price: float,
        session_id: str = "default",
    ) -> TLHAnalysisResult:
        normalized_ticker = ticker.upper()
        company = await asyncio.to_thread(self.db.get_company_profile, normalized_ticker)
        if company is None:
            raise ValueError("Ticker not found in vector database")

        price_snapshot = await asyncio.to_thread(self.market_data.get_current_price, normalized_ticker)
        if price_snapshot is None:
            raise ValueError("Unable to fetch market price for ticker")

        loss = round(buy_price - price_snapshot.current_price, 2)
        if loss <= 0:
            return TLHAnalysisResult(
                status="HOLD",
                ticker=normalized_ticker,
                buy_price=round(buy_price, 2),
                price_data=price_snapshot,
                gain_per_share=round(abs(loss), 2),
            )

        if not company.embedding:
            raise ValueError("Ticker is missing an embedding in the vector database")

        return await self.auditor.analyze_loss_opportunity(
            company=company,
            buy_price=buy_price,
            price_snapshot=price_snapshot,
            session_id=session_id,
        )


def create_engine_from_env() -> TaxEngine:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not supabase_url or not supabase_service_key or not openai_api_key:
        raise RuntimeError("Missing required environment variables for Supabase or OpenAI")

    db = SentinelDB(supabase_url, supabase_service_key)
    market_data = MarketData(ttl_seconds=300)
    auditor = AutonomousQuantAuditor(db=db, market_data=market_data, api_key=openai_api_key)
    return TaxEngine(db, market_data, auditor)


def build_app(engine: TaxEngine | None = None) -> FastAPI:
    resolved_engine = engine or create_engine_from_env()
    app = FastAPI(title="Tax-Loss Sentinel")

    @app.get("/analyze", response_model=AnalyzeResponse)
    async def analyze(
        ticker: str,
        buy_price: float,
        session_id: str = "default",
    ) -> AnalyzeResponse:
        try:
            result = await resolved_engine.analyze_tlh_opportunity(ticker, buy_price, session_id=session_id)
            return AnalyzeResponse(result=result)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return app


app = build_app() if os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY") and os.getenv("OPENAI_API_KEY") else FastAPI(title="Tax-Loss Sentinel")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
