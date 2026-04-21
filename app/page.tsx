"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, FileText, Plus, Search, Shield } from "lucide-react";
import AddClientModal from "./components/AddClientModal";

type Holding = {
  ticker: string;
  shares: number;
  costBasis: number;
  currentPrice: number | null;
};

type Client = {
  id: string;
  name: string;
  riskProfile: string;
  holdings: Holding[];
};

type ProposedTrade = {
  sellTicker: string;
  buyTicker: string;
  similarity: number;
  memo: string[];
};

type AnalyzeResult = {
  status: "HARVEST" | "HOLD";
  ticker: string;
  buy_price: number;
  price_data: {
    ticker: string;
    current_price: number;
    cached: boolean;
    fetched_at_epoch: number;
  };
  loss_per_share?: number | null;
  gain_per_share?: number | null;
  twin?: {
    ticker: string;
    security_name?: string | null;
    description?: string | null;
    similarity?: number | null;
    sector?: string | null;
    sub_industry?: string | null;
  } | null;
  suitability_memo: string[];
};

type PortfolioApiRow = {
  id: string;
  workspace_id: string;
  client_name: string;
  ticker: string;
  shares: number;
  cost_basis: number;
};

function mapPortfolioRowsToClients(rows: PortfolioApiRow[]): Client[] {
  const grouped = new Map<string, Client>();

  rows.forEach((row) => {
    const clientKey = row.client_name.trim().toLowerCase();
    const existing = grouped.get(clientKey);

    if (existing) {
      existing.holdings.push({
        ticker: row.ticker.toUpperCase(),
        shares: row.shares,
        costBasis: row.cost_basis,
        currentPrice: null,
      });
      return;
    }

    grouped.set(clientKey, {
      id: row.id,
      name: row.client_name,
      riskProfile: "Workspace portfolio",
      holdings: [
        {
          ticker: row.ticker.toUpperCase(),
          shares: row.shares,
          costBasis: row.cost_basis,
          currentPrice: null,
        },
      ],
    });
  });

  return Array.from(grouped.values());
}

const STATUS_AGENTS = [
  { name: "Strategist", label: "Online" },
  { name: "Auditor", label: "Online" },
  { name: "Writer", label: "Ready" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function calculateUnrealizedLoss(holding: Holding) {
  if (holding.currentPrice === null) {
    return null;
  }
  return (holding.costBasis - holding.currentPrice) * holding.shares;
}

export default function Page() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [workspaceDraftOpen, setWorkspaceDraftOpen] = useState(false);
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClientId, setActiveClientId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [proposedTrade, setProposedTrade] = useState<ProposedTrade | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const runIdRef = useRef(0);

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) ?? clients[0],
    [activeClientId, clients],
  );

  const loadWorkspacePortfolios = async (targetWorkspaceId: string) => {
    setIsLoadingWorkspace(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setAgentLogs([]);
    setProposedTrade(null);

    try {
      const params = new URLSearchParams({ workspace_id: targetWorkspaceId });
      const response = await fetch(`/api/portfolios?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as
        | { portfolios: PortfolioApiRow[] }
        | { detail?: string };

      if (!response.ok || !("portfolios" in payload)) {
        const detail = "detail" in payload && payload.detail ? payload.detail : "Failed to load workspace portfolios.";
        throw new Error(detail);
      }

      const mappedClients = mapPortfolioRowsToClients(payload.portfolios);
      setClients(mappedClients);
      setActiveClientId(mappedClients[0]?.id ?? "");
      setStatusMessage(
        mappedClients.length > 0
          ? `Workspace ${targetWorkspaceId} loaded: ${mappedClients.length} client${mappedClients.length === 1 ? "" : "s"}.`
          : "Workspace has no clients yet.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected workspace loading error";
      setErrorMessage(message);
      setClients([]);
      setActiveClientId("");
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const workspaceFromUrl = search.get("workspace_id");
    const resolvedWorkspaceId = workspaceFromUrl?.trim() || crypto.randomUUID();

    setWorkspaceId(resolvedWorkspaceId);
    setWorkspaceInput(resolvedWorkspaceId);

    if (!workspaceFromUrl) {
      search.set("workspace_id", resolvedWorkspaceId);
      const query = search.toString();
      const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState({}, "", nextUrl);
    }

    void loadWorkspacePortfolios(resolvedWorkspaceId);

    return () => {
      runIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!workspaceCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setWorkspaceCopied(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [workspaceCopied]);

  const handleCopyWorkspaceId = async () => {
    try {
      await navigator.clipboard.writeText(workspaceId);
      setWorkspaceCopied(true);
    } catch {
      setErrorMessage("Unable to copy workspace ID to clipboard.");
    }
  };

  const handleOpenWorkspace = () => {
    const nextWorkspaceId = workspaceInput.trim();
    if (!nextWorkspaceId) {
      setErrorMessage("Workspace ID cannot be empty.");
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("workspace_id", nextWorkspaceId);
    window.location.href = nextUrl.toString();
  };

  const runSentinel = async () => {
    if (!activeClient) {
      return;
    }

    const runId = Date.now();
    runIdRef.current = runId;
    setIsRunning(true);
    setProposedTrade(null);
    setAgentLogs([]);
    setStatusMessage(null);
    setErrorMessage(null);

    const addLog = (message: string) => {
      if (runIdRef.current !== runId) {
        return;
      }
      setAgentLogs((currentLogs) => [...currentLogs, message]);
    };

    try {
      addLog(`Sentinel: analyzing ${activeClient.holdings.length} holdings for ${activeClient.name}...`);

      const responses = await Promise.all(
        activeClient.holdings.map(async (holding) => {
          addLog(`Strategist: requesting backend analysis for ${holding.ticker}...`);

          const params = new URLSearchParams({
            ticker: holding.ticker,
            buy_price: holding.costBasis.toString(),
            session_id: `${workspaceId}-${activeClient.id}-${holding.ticker}`,
          });

          const response = await fetch(`/api/analyze?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          });

          const payload = (await response.json()) as
            | { result: AnalyzeResult }
            | { detail?: string };

          if (!response.ok || !("result" in payload)) {
            const detail = "detail" in payload && payload.detail ? payload.detail : `Analysis failed for ${holding.ticker}`;
            throw new Error(detail);
          }

          return {
            holding,
            analysis: payload.result,
          };
        }),
      );

      if (runIdRef.current !== runId) {
        return;
      }

      setClients((currentClients) =>
        currentClients.map((client) =>
          client.id === activeClient.id
            ? {
                ...client,
                holdings: client.holdings.map((holding) => {
                  const matchingResponse = responses.find(
                    ({ analysis }) => analysis.ticker === holding.ticker,
                  );

                  return matchingResponse
                    ? {
                        ...holding,
                        currentPrice: matchingResponse.analysis.price_data.current_price,
                      }
                    : holding;
                }),
              }
            : client,
        ),
      );

      responses.forEach(({ holding, analysis }) => {
        addLog(
          analysis.status === "HARVEST"
            ? `Auditor: ${holding.ticker} cleared for harvesting with ${analysis.twin?.ticker ?? "no substitute"} as the replacement.`
            : `Auditor: ${holding.ticker} is currently a hold based on live pricing.`,
        );
      });

      const harvestCandidates = responses
        .filter(({ analysis }) => analysis.status === "HARVEST" && analysis.twin)
        .sort((left, right) => {
          const leftLoss = (left.analysis.loss_per_share ?? 0) * left.holding.shares;
          const rightLoss = (right.analysis.loss_per_share ?? 0) * right.holding.shares;
          return rightLoss - leftLoss;
        });

      const bestCandidate = harvestCandidates[0];

      if (!bestCandidate || !bestCandidate.analysis.twin) {
        setStatusMessage("No live tax-loss harvesting opportunity was found for this client.");
        addLog("Writer: no harvestable positions found in the current backend scan.");
        return;
      }

      setProposedTrade({
        sellTicker: bestCandidate.holding.ticker,
        buyTicker: bestCandidate.analysis.twin.ticker,
        similarity: bestCandidate.analysis.twin.similarity ?? 0,
        memo: bestCandidate.analysis.suitability_memo,
      });
      setStatusMessage(`Best opportunity identified from live backend analysis: ${bestCandidate.holding.ticker}.`);
      addLog(`Writer: finalized memo for ${bestCandidate.holding.ticker} -> ${bestCandidate.analysis.twin.ticker}.`);
    } catch (error) {
      if (runIdRef.current !== runId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Unexpected backend error";
      setErrorMessage(message);
      addLog(`Sentinel: ${message}`);
    } finally {
      if (runIdRef.current === runId) {
        setIsRunning(false);
      }
    }
  };

  if (!activeClient && !isLoadingWorkspace) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-emerald-400/10 bg-slate-900/80 p-5 shadow-fintech backdrop-blur">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Tax-Loss Sentinel</p>
            <h1 className="mt-3 text-2xl font-semibold text-white">Client Sandbox</h1>
            <p className="mt-2 text-sm text-slate-400">
              Live portfolio triage powered by backend analysis, agent review, and memo generation.
            </p>
          </div>

          <div className="space-y-3">
            {clients.map((client) => {
              const isActive = client.id === activeClientId;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => {
                    setActiveClientId(client.id);
                    setIsRunning(false);
                    setAgentLogs([]);
                    setProposedTrade(null);
                    setStatusMessage(null);
                    setErrorMessage(null);
                  }}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    isActive
                      ? "border-emerald-400/40 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/70 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-white">{client.name}</p>
                    <Shield className={`h-4 w-4 ${isActive ? "text-emerald-300" : "text-slate-500"}`} />
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{client.riskProfile}</p>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-zinc-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-emerald-400/40 hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4 text-emerald-300" />
            New Client
          </button>

          <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Sentinel Status</p>
            <div className="mt-4 space-y-3">
              {STATUS_AGENTS.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"
                >
                  <span className="text-sm font-medium text-white">{agent.name}</span>
                  <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-emerald-300">
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                    </span>
                    {agent.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Workspace</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 font-mono text-xs text-slate-200">
                {workspaceId}
              </code>
              <div className="relative">
                <button
                  type="button"
                  onClick={handleCopyWorkspaceId}
                  className="rounded-xl border border-slate-700 bg-slate-900/90 p-2 text-slate-300 transition hover:border-emerald-400/40 hover:text-emerald-200"
                  aria-label="Copy workspace ID"
                  title="Copy workspace ID"
                >
                  <Copy className="h-4 w-4" />
                </button>
                {workspaceCopied ? (
                  <span className="absolute -top-8 right-0 rounded-md border border-emerald-400/30 bg-emerald-500/20 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-200">
                    Copied!
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setWorkspaceDraftOpen((current) => !current);
                setWorkspaceInput(workspaceId);
                setErrorMessage(null);
              }}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-emerald-400/40 hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5 text-emerald-300" />
              Open Different Workspace
            </button>

            {workspaceDraftOpen ? (
              <div className="mt-3 space-y-2">
                <input
                  value={workspaceInput}
                  onChange={(event) => setWorkspaceInput(event.target.value)}
                  placeholder="Paste workspace ID"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 font-mono text-xs text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/60"
                />
                <button
                  type="button"
                  onClick={handleOpenWorkspace}
                  className="w-full rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-400"
                >
                  Open Workspace
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="rounded-[2rem] border border-slate-800 bg-slate-900/75 p-5 shadow-fintech backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Active Client</p>
              <h2 className="mt-2 text-3xl font-semibold text-white">
                {activeClient ? activeClient.name : "No Client Selected"}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {activeClient ? activeClient.riskProfile : "Load or open a workspace to begin analysis."}
              </p>
            </div>
            <button
              type="button"
              onClick={runSentinel}
              disabled={isRunning || isLoadingWorkspace || !activeClient}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 font-medium text-slate-950 transition hover:bg-emerald-300"
            >
              <Search className="h-4 w-4" />
              {isLoadingWorkspace ? "Loading Workspace..." : isRunning ? "Running..." : "Run Sentinel"}
            </button>
          </div>

          <div className="relative mt-6 overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-950/60">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-[0.25em] text-slate-400">
                  <tr>
                    <th className="px-5 py-4">Ticker</th>
                    <th className="px-5 py-4">Shares</th>
                    <th className="px-5 py-4">Cost Basis</th>
                    <th className="px-5 py-4">Current Price</th>
                    <th className="px-5 py-4">Unrealized Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {activeClient?.holdings.map((holding) => {
                    const unrealizedLoss = calculateUnrealizedLoss(holding);
                    const hasLoss = (unrealizedLoss ?? 0) > 0;
                    return (
                      <tr key={holding.ticker} className="border-t border-slate-800/80">
                        <td className="px-5 py-4 font-medium text-white">{holding.ticker}</td>
                        <td className="px-5 py-4 text-slate-300">{holding.shares}</td>
                        <td className="px-5 py-4 text-slate-300">{formatCurrency(holding.costBasis)}</td>
                        <td className="px-5 py-4 text-slate-300">
                          {holding.currentPrice === null ? "Live on analysis" : formatCurrency(holding.currentPrice)}
                        </td>
                        <td className={`px-5 py-4 font-medium ${hasLoss ? "text-rose-400" : "text-emerald-300"}`}>
                          {unrealizedLoss === null ? "Run Sentinel" : formatCurrency(unrealizedLoss)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!activeClient && !isLoadingWorkspace ? (
              <div className="p-6 text-sm text-slate-400">No clients found in this workspace yet.</div>
            ) : null}

            {isRunning ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-3xl border border-emerald-400/20 bg-black/80 p-5 shadow-fintech">
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                    <div className="flex gap-2">
                      <span className="h-3 w-3 rounded-full bg-rose-400" />
                      <span className="h-3 w-3 rounded-full bg-amber-300" />
                      <span className="h-3 w-3 rounded-full bg-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-emerald-300">Sentinel Runtime</p>
                  </div>
                  <div className="mt-4 space-y-3 font-mono text-sm text-emerald-200">
                    {agentLogs.map((log, index) => (
                      <p key={`${index}-${log}`} className="animate-pulse">
                        {log}
                      </p>
                    ))}
                    {agentLogs.length === 0 ? <p>Booting agent sandbox...</p> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-3xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          {statusMessage && !proposedTrade ? (
            <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              {statusMessage}
            </div>
          ) : null}

          {proposedTrade ? (
            <div className="mt-6 rounded-[1.75rem] border border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 via-slate-900 to-slate-950 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Proposed Trade</p>
                  <div className="mt-4 flex flex-col gap-4 text-lg font-semibold text-white md:flex-row md:items-center">
                    <span className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-rose-300">
                      Sell {proposedTrade.sellTicker} @ Loss
                    </span>
                    <span className="text-slate-500">→</span>
                    <span className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-emerald-200">
                      Buy {proposedTrade.buyTicker} @ Similarity {proposedTrade.similarity.toFixed(2)}
                    </span>
                  </div>
                  {statusMessage ? <p className="mt-3 text-sm text-slate-300">{statusMessage}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setProposedTrade(null)}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  Dismiss
                </button>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <FileText className="h-5 w-5 text-emerald-300" />
                  <h3 className="text-lg font-semibold text-white">Generated Memo</h3>
                </div>
                <div className="space-y-3 text-sm text-slate-300">
                  {proposedTrade.memo.map((line) => (
                    <p key={line} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <AnimatePresence>
        {showIntro ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-4xl rounded-[2rem] border border-emerald-400/20 bg-slate-950/90 p-6 shadow-fintech md:p-8"
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
                transition: { type: "spring", stiffness: 180, damping: 18 },
              }}
              exit={{ opacity: 0, scale: 0.95, y: 18, transition: { duration: 0.22 } }}
            >
              <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Recruiter Overview</p>
                  <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white md:text-5xl">
                    Tax-Loss Sentinel: Adversarial Agentic Harvesting
                  </h2>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                    Most tax-harvesting tools fail the &quot;Wash Sale&quot; test by suggesting substantially identical tickers.
                    Sentinel uses a 3-agent adversarial loop to ensure legal compliance and economic correlation.
                  </p>
                </div>

                <div className="grid gap-3">
                  <motion.div
                    className="rounded-3xl border border-emerald-400/15 bg-emerald-400/10 p-4"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.08, duration: 0.32 } }}
                  >
                    <div className="flex items-center gap-3">
                      <Search className="h-5 w-5 text-emerald-300" />
                      <h3 className="font-semibold text-white">Strategist</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      Uses vector search to find high-correlation twins.
                    </p>
                  </motion.div>

                  <motion.div
                    className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.16, duration: 0.32 } }}
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="h-5 w-5 text-emerald-300" />
                      <h3 className="font-semibold text-white">Auditor</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      Acts as an &quot;IRS Attorney&quot; to block wash-sale violations.
                    </p>
                  </motion.div>

                  <motion.div
                    className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.24, duration: 0.32 } }}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-emerald-300" />
                      <h3 className="font-semibold text-white">Memo Writer</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      Synthesizes rationale for investment committees.
                    </p>
                  </motion.div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <motion.button
                  type="button"
                  onClick={() => setShowIntro(false)}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
                >
                  Enter Sandbox
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AddClientModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onCreated={async (payload) => {
          try {
            const response = await fetch("/api/portfolios", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                workspace_id: workspaceId,
                client_name: payload.client_name,
                initial_holdings: payload.initial_holdings,
              }),
            });

            const body = (await response.json()) as
              | { portfolios: PortfolioApiRow[] }
              | { detail?: string };

            if (!response.ok) {
              const detail = "detail" in body && body.detail ? body.detail : "Unable to create client in workspace.";
              throw new Error(detail);
            }

            await loadWorkspacePortfolios(workspaceId);
            setIsOpen(false);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unexpected workspace create error";
            setErrorMessage(message);
          }
        }}
      />
    </main>
  );
}
