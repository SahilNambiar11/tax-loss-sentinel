import asyncio
import ast
import json
import os
import time
from uuid import UUID

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from langchain_classic.agents import AgentExecutor, create_openai_functions_agent
from langchain_classic.memory import ConversationBufferWindowMemory
from langchain_core.messages import HumanMessage, SystemMessage
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


class PortfolioRecord(BaseModel):
    id: str
    workspace_id: str
    client_name: str
    ticker: str
    shares: float
    cost_basis: float

    model_config = ConfigDict(extra="ignore")

    @field_validator("id", "workspace_id", mode="before")
    @classmethod
    def stringify_identifiers(cls, value: object) -> str:
        if value is None:
            return ""
        return str(value)


class PortfolioSeedHolding(BaseModel):
    ticker: str
    shares: float
    cost_basis: float


class PortfolioCreateRequest(BaseModel):
    workspace_id: UUID
    client_name: str
    initial_holdings: list[PortfolioSeedHolding]


class PortfolioUpdateRequest(BaseModel):
    shares: float
    cost_basis: float


class PortfolioListResponse(BaseModel):
    portfolios: list[PortfolioRecord]


class PortfolioResponse(BaseModel):
    portfolio: PortfolioRecord


class StrategistProposal(BaseModel):
    proposed_twin: TwinMatch
    rationale: str


class AuditVerdict(BaseModel):
    verdict: str
    explanation: str


class MemoOutput(BaseModel):
    suitability_memo: list[str] = Field(default_factory=list)


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

    def ensure_workspace_exists(self, workspace_id: UUID) -> None:
        self.client.table("workspaces").upsert({"id": str(workspace_id)}, on_conflict="id").execute()

    def _portfolio_select(self) -> str:
        return "id, workspace_id, client_name, ticker, shares, cost_basis"

    def seed_default_portfolio(self, workspace_id: UUID) -> list[PortfolioRecord]:
        default_holdings = [
            {
                "workspace_id": str(workspace_id),
                "client_name": "Oliver Brooks",
                "ticker": "AMZN",
                "shares": 61,
                "cost_basis": 201.55,
            },
            {
                "workspace_id": str(workspace_id),
                "client_name": "Oliver Brooks",
                "ticker": "COST",
                "shares": 15,
                "cost_basis": 840.20,
            },
            {
                "workspace_id": str(workspace_id),
                "client_name": "Oliver Brooks",
                "ticker": "NFLX",
                "shares": 21,
                "cost_basis": 697.40,
            },
        ]
        response = self.client.table("portfolios").insert(default_holdings).execute()
        return [PortfolioRecord.model_validate(row) for row in (response.data or [])]

    def list_workspace_portfolios(self, workspace_id: UUID) -> list[PortfolioRecord]:
        self.ensure_workspace_exists(workspace_id)
        response = (
            self.client.table("portfolios")
            .select(self._portfolio_select())
            .eq("workspace_id", str(workspace_id))
            .order("client_name")
            .order("ticker")
            .execute()
        )
        rows = [PortfolioRecord.model_validate(row) for row in (response.data or [])]
        if rows:
            return rows
        return self.seed_default_portfolio(workspace_id)

    def create_portfolio(
        self,
        workspace_id: UUID,
        client_name: str,
        initial_holdings: list[PortfolioSeedHolding],
    ) -> list[PortfolioRecord]:
        self.ensure_workspace_exists(workspace_id)
        rows = [
            {
                "workspace_id": str(workspace_id),
                "client_name": client_name,
                "ticker": holding.ticker.upper(),
                "shares": holding.shares,
                "cost_basis": holding.cost_basis,
            }
            for holding in initial_holdings
        ]
        response = self.client.table("portfolios").insert(rows).execute()
        return [PortfolioRecord.model_validate(row) for row in (response.data or [])]

    def update_portfolio(self, portfolio_id: str, payload: PortfolioUpdateRequest) -> PortfolioRecord:
        response = (
            self.client.table("portfolios")
            .update(
                {
                    "shares": payload.shares,
                    "cost_basis": payload.cost_basis,
                }
            )
            .eq("id", portfolio_id)
            .execute()
        )
        if not response.data:
            raise ValueError("Portfolio row not found")
        return PortfolioRecord.model_validate(response.data[0])


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


class MultiAgentChecker:
    def __init__(self, db: SentinelDB, market_data: MarketData, api_key: str):
        self.db = db
        self.market_data = market_data
        self.strategist_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)
        self.auditor_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)
        self.memo_writer_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=api_key)
        self.proposal_parser = PydanticOutputParser(pydantic_object=StrategistProposal)
        self.audit_parser = PydanticOutputParser(pydantic_object=AuditVerdict)
        self.memo_parser = PydanticOutputParser(pydantic_object=MemoOutput)
        self._strategist_memories: dict[str, ConversationBufferWindowMemory] = {}

    def _get_strategist_memory(self, session_id: str) -> ConversationBufferWindowMemory:
        if session_id not in self._strategist_memories:
            self._strategist_memories[session_id] = ConversationBufferWindowMemory(
                k=5,
                memory_key="chat_history",
                input_key="input",
                output_key="output",
                return_messages=True,
            )
        return self._strategist_memories[session_id]

    def _build_strategist_tools(self, company: CompanyProfile) -> list:
        @tool
        def get_current_price(ticker: str) -> str:
            """Fetch the latest market price snapshot for a stock ticker."""
            snapshot = self.market_data.get_current_price(ticker)
            if snapshot is None:
                return json.dumps({"error": f"Unable to fetch market price for {ticker}."})
            return snapshot.model_dump_json()

        @tool
        def search_tool(match_count: int = 3, rejected_tickers_csv: str = "") -> str:
            """Find the most semantically similar replacement stocks, excluding any comma-separated rejected tickers."""
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

        return [search_tool, get_current_price]

    def _build_strategist_executor(self, company: CompanyProfile, session_id: str) -> AgentExecutor:
        tools = self._build_strategist_tools(company)
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "You are The Portfolio Strategist, an aggressive Quant researcher at a top-tier hedge fund.\n"
                        "Your mission is to find the best tax-loss harvesting replacement for {ticker} with the lowest practical tracking error, while preserving strict legal distinctness.\n\n"
                        "PRIORITIES IN ORDER:\n"
                        "1. The replacement must be a distinct legal issuer, not the same company under another share class, ticker, or corporate structure.\n"
                        "2. The replacement should preserve similar business exposure, sector drivers, and market factors.\n"
                        "3. Among legally safe candidates, prefer the one with the strongest semantic similarity and lowest expected tracking error.\n\n"
                        "WORKFLOW:\n"
                        "1. Analyze the original company description.\n"
                        "2. Use search_tool to search for 3 to 5 candidate twins.\n"
                        "3. Filter out {ticker} and anything in rejected_tickers_csv.\n"
                        "4. Apply auditor feedback from prior turns.\n"
                        "5. If prior feedback suggests the candidate was too close to the same issuer, pivot outward to direct competitors or adjacent companies with similar exposure rather than near-duplicate entities.\n"
                        "6. Use get_current_price to confirm the original ticker is active before finalizing your proposal.\n\n"
                        "CRITICAL CONSTRAINTS:\n"
                        "- Never propose {ticker}.\n"
                        "- Never propose a ticker listed in rejected_tickers_csv.\n"
                        "- Never intentionally propose another share class, alternate ticker, or obvious same-issuer variant.\n"
                        "- Optimize for the closest safe substitute, not the closest possible duplicate.\n\n"
                        "Return JSON only.\n"
                        "{format_instructions}"
                    ),
                ),
                MessagesPlaceholder(variable_name="chat_history"),
                (
                    "human",
                    (
                        "Original ticker: {ticker}\n"
                        "Original name: {security_name}\n"
                        "Original description: {description}\n"
                        "Rejected tickers: {rejected_tickers_csv}\n"
                        "Auditor feedback from prior turn: {auditor_feedback}\n"
                        "Call get_current_price for the original ticker to confirm the live quote context.\n"
                        "Then call search_tool to find 3 candidate twins and propose the best remaining option.\n"
                        "Return a proposed_twin object and a short rationale in JSON only."
                    ),
                ),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ]
        )
        agent = create_openai_functions_agent(self.strategist_llm, tools, prompt)
        return AgentExecutor(
            agent=agent,
            tools=tools,
            memory=self._get_strategist_memory(session_id),
            verbose=False,
            handle_parsing_errors=True,
        )

    @staticmethod
    def _clean_output(raw_output: str) -> str:
        cleaned = raw_output.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
        return cleaned

    async def _run_strategist(
        self,
        company: CompanyProfile,
        session_id: str,
        rejected_tickers: list[str],
        auditor_feedback: str,
    ) -> StrategistProposal:
        executor = self._build_strategist_executor(company, session_id)
        result = await executor.ainvoke(
            {
                "input": f"Propose the best replacement for {company.ticker}.",
                "ticker": company.ticker,
                "security_name": company.security_name or "Unknown",
                "description": company.description or "No description available.",
                "rejected_tickers_csv": ",".join(rejected_tickers),
                "auditor_feedback": auditor_feedback or "None yet.",
                "format_instructions": self.proposal_parser.get_format_instructions(),
            }
        )
        return self.proposal_parser.parse(self._clean_output(result["output"]))

    async def _run_auditor(
        self,
        company: CompanyProfile,
        proposal: StrategistProposal,
    ) -> AuditVerdict:
        system_prompt = (
            "You are The Compliance Auditor, a strict, high-stakes IRS Tax Attorney specializing in Section 1091 (Wash Sales).\n"
            "Your goal is to perform a 'Substantially Identical' audit to prevent illegal tax maneuvers.\n\n"
            
            "AUDIT RULES:\n"
            "1. REJECT if the replacement is the SAME corporation (e.g., Alphabet Class A vs Class C, or a company that recently changed its name/ticker).\n"
            "2. APPROVE if the replacement is a COMPETITOR (e.g., Ford vs GM, Google vs Meta, Apple vs Microsoft).\n"
            "3. IMPORTANT: High correlation or being in the same sector is NOT a violation. Different legal entities are safe for Tax-Loss Harvesting.\n\n"
            
            "RESPONSE PROTOCOL:\n"
            "- If REJECTED: Provide a blunt, one-sentence legal reason why they are the same entity.\n"
            "- If APPROVED: Provide a concise explanation of why the pair is legally distinct and acceptable.\n\n"
            
            "Return JSON only.\n"
            f"{self.audit_parser.get_format_instructions()}"
        )
        human_prompt = (
            "Original stock:\n"
            f"- Ticker: {company.ticker}\n"
            f"- Name: {company.security_name or 'Unknown'}\n"
            f"- Description: {company.description or 'No description available.'}\n\n"
            "Proposed twin:\n"
            f"- Ticker: {proposal.proposed_twin.ticker}\n"
            f"- Name: {proposal.proposed_twin.security_name or 'Unknown'}\n"
            f"- Description: {proposal.proposed_twin.description or 'No description available.'}\n"
            f"- Similarity: {proposal.proposed_twin.similarity if proposal.proposed_twin.similarity is not None else 'Unknown'}\n\n"
            "Return verdict as APPROVED or REJECTED."
        )
        response = await self.auditor_llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt),
            ]
        )
        return self.audit_parser.parse(self._clean_output(response.content))

    async def _run_memo_writer(
        self,
        company: CompanyProfile,
        proposal: StrategistProposal,
        verdict: AuditVerdict,
    ) -> MemoOutput:
        system_prompt = (
            "You are the Suitability Memo Writer for a wealth management platform.\n"
            "Write a client-ready suitability memo for an approved tax-loss harvesting replacement.\n"
            "Provide exactly 3 bullet strings in suitability_memo.\n"
            "Focus on business overlap, preserved market exposure, and legal distinctness.\n"
            "Do not mention uncertainty, internal process, or rejection history.\n"
            "Return JSON only.\n"
            f"{self.memo_parser.get_format_instructions()}"
        )
        human_prompt = (
            "Original stock:\n"
            f"- Ticker: {company.ticker}\n"
            f"- Name: {company.security_name or 'Unknown'}\n"
            f"- Description: {company.description or 'No description available.'}\n\n"
            "Approved replacement:\n"
            f"- Ticker: {proposal.proposed_twin.ticker}\n"
            f"- Name: {proposal.proposed_twin.security_name or 'Unknown'}\n"
            f"- Description: {proposal.proposed_twin.description or 'No description available.'}\n"
            f"- Similarity: {proposal.proposed_twin.similarity if proposal.proposed_twin.similarity is not None else 'Unknown'}\n\n"
            f"Compliance explanation: {verdict.explanation}"
        )
        response = await self.memo_writer_llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_prompt),
            ]
        )
        parsed = self.memo_parser.parse(self._clean_output(response.content))
        parsed.suitability_memo = parsed.suitability_memo[:3]
        return parsed

    async def analyze_loss_opportunity(
        self,
        company: CompanyProfile,
        buy_price: float,
        price_snapshot: PriceSnapshot,
        session_id: str,
    ) -> TLHAnalysisResult:
        rejected_tickers: list[str] = []
        auditor_feedback = "None yet."
        last_proposal: StrategistProposal | None = None
        last_verdict: AuditVerdict | None = None

        for _ in range(3):
            proposal = await self._run_strategist(company, session_id, rejected_tickers, auditor_feedback)
            verdict = await self._run_auditor(company, proposal)
            last_proposal = proposal
            last_verdict = verdict

            if verdict.verdict.upper() == "APPROVED":
                memo = await self._run_memo_writer(company, proposal, verdict)
                return TLHAnalysisResult(
                    status="HARVEST",
                    ticker=company.ticker,
                    buy_price=round(buy_price, 2),
                    price_data=price_snapshot,
                    loss_per_share=round(buy_price - price_snapshot.current_price, 2),
                    twin=proposal.proposed_twin,
                    suitability_memo=memo.suitability_memo,
                )

            rejected_tickers.append(proposal.proposed_twin.ticker.upper())
            auditor_feedback = verdict.explanation

        if last_proposal and last_verdict:
            raise ValueError(
                f"No compliant replacement found after 3 review cycles. Latest rejection: {last_proposal.proposed_twin.ticker} - {last_verdict.explanation}"
            )
        raise ValueError("No compliant replacement found after 3 review cycles.")


class TaxEngine:
    def __init__(self, db: SentinelDB, market_data: MarketData, checker: MultiAgentChecker):
        self.db = db
        self.market_data = market_data
        self.checker = checker

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

        return await self.checker.analyze_loss_opportunity(
            company=company,
            buy_price=buy_price,
            price_snapshot=price_snapshot,
            session_id=session_id,
        )

    async def list_workspace_portfolios(self, workspace_id: UUID) -> list[PortfolioRecord]:
        return await asyncio.to_thread(self.db.list_workspace_portfolios, workspace_id)

    async def create_portfolio(
        self,
        workspace_id: UUID,
        client_name: str,
        initial_holdings: list[PortfolioSeedHolding],
    ) -> list[PortfolioRecord]:
        return await asyncio.to_thread(
            self.db.create_portfolio,
            workspace_id,
            client_name,
            initial_holdings,
        )

    async def update_portfolio(self, portfolio_id: str, payload: PortfolioUpdateRequest) -> PortfolioRecord:
        return await asyncio.to_thread(self.db.update_portfolio, portfolio_id, payload)


def create_db_from_env() -> SentinelDB:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")

    if not supabase_url or not supabase_service_key:
        raise RuntimeError("Missing required environment variables for Supabase")

    return SentinelDB(supabase_url, supabase_service_key)


def create_engine_from_env() -> TaxEngine:
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not openai_api_key:
        raise RuntimeError("Missing required environment variables for OpenAI")

    db = create_db_from_env()
    market_data = MarketData(ttl_seconds=300)
    checker = MultiAgentChecker(db=db, market_data=market_data, api_key=openai_api_key)
    return TaxEngine(db, market_data, checker)


def build_app(engine: TaxEngine | None = None) -> FastAPI:
    resolved_db = engine.db if engine is not None else create_db_from_env()
    resolved_engine: TaxEngine | None = engine
    if resolved_engine is None and os.getenv("OPENAI_API_KEY"):
        resolved_engine = create_engine_from_env()
    app = FastAPI(title="Tax-Loss Sentinel")

    @app.get("/portfolios", response_model=PortfolioListResponse)
    async def list_portfolios(workspace_id: UUID) -> PortfolioListResponse:
        try:
            portfolios = await asyncio.to_thread(resolved_db.list_workspace_portfolios, workspace_id)
            return PortfolioListResponse(portfolios=portfolios)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Unable to fetch portfolios: {exc}") from exc

    @app.post("/portfolios", response_model=PortfolioListResponse)
    async def create_portfolio(request: PortfolioCreateRequest) -> PortfolioListResponse:
        if not request.initial_holdings:
            raise HTTPException(status_code=400, detail="At least one initial holding is required")
        try:
            portfolios = await asyncio.to_thread(
                resolved_db.create_portfolio,
                request.workspace_id,
                request.client_name,
                request.initial_holdings,
            )
            return PortfolioListResponse(portfolios=portfolios)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Unable to create portfolio: {exc}") from exc

    @app.patch("/portfolios/{portfolio_id}", response_model=PortfolioResponse)
    async def update_portfolio(portfolio_id: str, request: PortfolioUpdateRequest) -> PortfolioResponse:
        try:
            portfolio = await asyncio.to_thread(resolved_db.update_portfolio, portfolio_id, request)
            return PortfolioResponse(portfolio=portfolio)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Unable to update portfolio: {exc}") from exc

    @app.get("/analyze", response_model=AnalyzeResponse)
    async def analyze(
        ticker: str,
        buy_price: float,
        session_id: str = "default",
    ) -> AnalyzeResponse:
        if resolved_engine is None:
            raise HTTPException(
                status_code=503,
                detail="Analyze endpoint requires OPENAI_API_KEY in addition to Supabase configuration.",
            )
        try:
            result = await resolved_engine.analyze_tlh_opportunity(ticker, buy_price, session_id=session_id)
            return AnalyzeResponse(result=result)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return app


app = build_app() if os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY") else FastAPI(title="Tax-Loss Sentinel")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
