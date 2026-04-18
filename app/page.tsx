"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Search, Shield } from "lucide-react";

type Holding = {
  ticker: string;
  shares: number;
  costBasis: number;
  currentPrice: number;
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

const INITIAL_CLIENTS: Client[] = [
  {
    id: "cl-001",
    name: "Maya Chen",
    riskProfile: "Tax-sensitive growth",
    holdings: [
      { ticker: "AAPL", shares: 120, costBasis: 224.15, currentPrice: 197.24 },
      { ticker: "MSFT", shares: 40, costBasis: 445.3, currentPrice: 421.1 },
      { ticker: "V", shares: 55, costBasis: 288.4, currentPrice: 276.2 },
    ],
  },
  {
    id: "cl-002",
    name: "Daniel Rivera",
    riskProfile: "Core equity income",
    holdings: [
      { ticker: "GOOGL", shares: 32, costBasis: 182.75, currentPrice: 169.4 },
      { ticker: "META", shares: 18, costBasis: 512.2, currentPrice: 488.1 },
      { ticker: "ADBE", shares: 22, costBasis: 611.6, currentPrice: 574.85 },
    ],
  },
  {
    id: "cl-003",
    name: "Priya Kapoor",
    riskProfile: "Balanced innovation",
    holdings: [
      { ticker: "NVDA", shares: 26, costBasis: 136.8, currentPrice: 119.45 },
      { ticker: "AMD", shares: 95, costBasis: 171.25, currentPrice: 154.2 },
      { ticker: "CRM", shares: 37, costBasis: 318.7, currentPrice: 301.4 },
    ],
  },
  {
    id: "cl-004",
    name: "Oliver Brooks",
    riskProfile: "Large-cap quality",
    holdings: [
      { ticker: "AMZN", shares: 61, costBasis: 201.55, currentPrice: 183.3 },
      { ticker: "COST", shares: 15, costBasis: 840.2, currentPrice: 809.75 },
      { ticker: "NFLX", shares: 21, costBasis: 697.4, currentPrice: 668.5 },
    ],
  },
  {
    id: "cl-005",
    name: "Sophia Martinez",
    riskProfile: "Tech concentration unwind",
    holdings: [
      { ticker: "TSLA", shares: 48, costBasis: 241.7, currentPrice: 214.8 },
      { ticker: "INTU", shares: 14, costBasis: 694.1, currentPrice: 672.25 },
      { ticker: "NOW", shares: 16, costBasis: 816.45, currentPrice: 788.6 },
    ],
  },
];

const REPLACEMENT_MAP: Record<string, { ticker: string; similarity: number; memo: string[] }> = {
  AAPL: {
    ticker: "MSFT",
    similarity: 0.94,
    memo: [
      "Both issuers provide large-cap technology exposure anchored by sticky enterprise ecosystems and global end-market demand.",
      "Microsoft preserves software and platform sensitivity while remaining a distinct legal issuer from Apple for wash sale purposes.",
      "The swap maintains innovation-driven factor exposure with lower realized tax drag and limited style drift.",
    ],
  },
  GOOGL: {
    ticker: "META",
    similarity: 0.92,
    memo: [
      "Alphabet and Meta both monetize digital advertising and large-scale consumer platforms, preserving internet-services exposure.",
      "Meta is a separate legal issuer with different governance and product concentration, supporting wash sale distance.",
      "The rotation keeps communication-services growth exposure intact while harvesting the embedded tax loss.",
    ],
  },
  NVDA: {
    ticker: "AMD",
    similarity: 0.91,
    memo: [
      "NVIDIA and AMD both express semiconductor and accelerated-computing demand across AI and data center markets.",
      "AMD offers comparable chip-cycle sensitivity without constituting the same issuer or share-class variant.",
      "The trade keeps high-beta compute exposure in place while crystallizing the unrealized loss.",
    ],
  },
  AMZN: {
    ticker: "MELI",
    similarity: 0.9,
    memo: [
      "Amazon and MercadoLibre both combine commerce-platform economics with scaled digital payments optionality.",
      "MercadoLibre is a distinct issuer with separate geography and operating structure, reducing wash sale concern.",
      "The substitute maintains platform-growth exposure while improving tax efficiency in the portfolio.",
    ],
  },
  TSLA: {
    ticker: "RIVN",
    similarity: 0.89,
    memo: [
      "Tesla and Rivian both provide EV adoption sensitivity and innovation-led automotive exposure.",
      "Rivian is a separate legal entity with materially different scale and execution profile, preserving compliance distance.",
      "The switch retains clean-transport upside while monetizing the tax loss on Tesla.",
    ],
  },
};

const AGENT_LOGS = [
  "Strategist: Checking correlation matrix...",
  "Auditor: Checking Wash Sale compliance (Section 1091)...",
  "Writer: Finalizing trade rationale memo...",
];

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
  return (holding.costBasis - holding.currentPrice) * holding.shares;
}

export default function Page() {
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
  const [activeClientId, setActiveClientId] = useState(INITIAL_CLIENTS[0]?.id ?? "");
  const [isRunning, setIsRunning] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [proposedTrade, setProposedTrade] = useState<ProposedTrade | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const timeoutRef = useRef<number[]>([]);

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) ?? clients[0],
    [activeClientId, clients],
  );

  const topLossHolding = useMemo(() => {
    if (!activeClient) {
      return null;
    }
    return [...activeClient.holdings]
      .map((holding) => ({
        holding,
        loss: calculateUnrealizedLoss(holding),
      }))
      .sort((left, right) => right.loss - left.loss)[0]?.holding ?? null;
  }, [activeClient]);

  useEffect(() => {
    return () => {
      timeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const updateHoldingPrice = (ticker: string, nextValue: string) => {
    const parsed = Number(nextValue);
    setClients((currentClients) =>
      currentClients.map((client) =>
        client.id !== activeClientId
          ? client
          : {
              ...client,
              holdings: client.holdings.map((holding) =>
                holding.ticker !== ticker
                  ? holding
                  : {
                      ...holding,
                      currentPrice: Number.isFinite(parsed) ? parsed : 0,
                    },
              ),
            },
      ),
    );
  };

  const runSentinel = () => {
    if (!topLossHolding) {
      return;
    }

    timeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutRef.current = [];
    setIsRunning(true);
    setProposedTrade(null);
    setAgentLogs([]);

    AGENT_LOGS.forEach((log, index) => {
      const timeoutId = window.setTimeout(() => {
        setAgentLogs((currentLogs) => [...currentLogs, log]);
      }, index * 1000);
      timeoutRef.current.push(timeoutId);
    });

    const finalTimeout = window.setTimeout(() => {
      const replacement = REPLACEMENT_MAP[topLossHolding.ticker] ?? {
        ticker: "QQQ",
        similarity: 0.9,
        memo: [
          "The replacement preserves adjacent growth exposure across the same broad innovation complex.",
          "The substitute is a distinct issuer from the harvested holding, creating cleaner wash sale separation.",
          "The trade maintains portfolio intent while improving after-tax efficiency in the sandbox portfolio.",
        ],
      };
      setIsRunning(false);
      setProposedTrade({
        sellTicker: topLossHolding.ticker,
        buyTicker: replacement.ticker,
        similarity: replacement.similarity,
        memo: replacement.memo,
      });
    }, 3200);
    timeoutRef.current.push(finalTimeout);
  };

  if (!activeClient) {
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
              Frontend-only simulation for portfolio triage, agent review, and memo reveal.
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
        </aside>

        <section className="rounded-[2rem] border border-slate-800 bg-slate-900/75 p-5 shadow-fintech backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">Active Client</p>
              <h2 className="mt-2 text-3xl font-semibold text-white">{activeClient.name}</h2>
              <p className="mt-2 text-sm text-slate-400">{activeClient.riskProfile}</p>
            </div>
            <button
              type="button"
              onClick={runSentinel}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 font-medium text-slate-950 transition hover:bg-emerald-300"
            >
              <Search className="h-4 w-4" />
              Run Sentinel
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
                  {activeClient.holdings.map((holding) => {
                    const unrealizedLoss = calculateUnrealizedLoss(holding);
                    const hasLoss = unrealizedLoss > 0;
                    return (
                      <tr key={holding.ticker} className="border-t border-slate-800/80">
                        <td className="px-5 py-4 font-medium text-white">{holding.ticker}</td>
                        <td className="px-5 py-4 text-slate-300">{holding.shares}</td>
                        <td className="px-5 py-4 text-slate-300">{formatCurrency(holding.costBasis)}</td>
                        <td className="px-5 py-4">
                          <input
                            type="number"
                            step="0.01"
                            value={holding.currentPrice}
                            onChange={(event) => updateHoldingPrice(holding.ticker, event.target.value)}
                            className="w-32 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none ring-0 transition focus:border-emerald-400"
                          />
                        </td>
                        <td className={`px-5 py-4 font-medium ${hasLoss ? "text-rose-400" : "text-emerald-300"}`}>
                          {hasLoss ? formatCurrency(unrealizedLoss) : formatCurrency(unrealizedLoss)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
                    {agentLogs.map((log) => (
                      <p key={log} className="animate-pulse">
                        {log}
                      </p>
                    ))}
                    {agentLogs.length === 0 ? <p>Booting agent sandbox...</p> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

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
                      Buy {proposedTrade.buyTicker} @ Similarity {proposedTrade.similarity.toFixed(2)}x
                    </span>
                  </div>
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
    </main>
  );
}
