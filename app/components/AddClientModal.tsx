"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

type StockDraft = {
  ticker: string;
  shares: string;
  costBasis: string;
};

type AddClientPayload = {
  client_name: string;
  strategy: string;
  initial_holdings: Array<{
    ticker: string;
    shares: number;
    cost_basis: number;
  }>;
};

type AddClientModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (payload: AddClientPayload) => void;
};

const EMPTY_STOCK_ROW: StockDraft = {
  ticker: "",
  shares: "",
  costBasis: "",
};

export default function AddClientModal({
  isOpen,
  onClose,
  onCreated,
}: AddClientModalProps) {
  const [clientName, setClientName] = useState("");
  const [strategy, setStrategy] = useState("");
  const [stocks, setStocks] = useState<StockDraft[]>([{ ...EMPTY_STOCK_ROW }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateStock = (index: number, field: keyof StockDraft, value: string) => {
    setStocks((current) =>
      current.map((stock, stockIndex) =>
        stockIndex === index ? { ...stock, [field]: value } : stock,
      ),
    );
  };

  const addStockRow = () => {
    setStocks((current) => [...current, { ...EMPTY_STOCK_ROW }]);
  };

  const removeStockRow = (index: number) => {
    setStocks((current) => (current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index)));
  };

  const resetForm = () => {
    setClientName("");
    setStrategy("");
    setStocks([{ ...EMPTY_STOCK_ROW }]);
    setErrorMessage(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const normalizedStocks = stocks
      .map((stock) => ({
        ticker: stock.ticker.trim().toUpperCase(),
        shares: Number(stock.shares),
        cost_basis: Number(stock.costBasis),
      }))
      .filter((stock) => stock.ticker);

    if (!clientName.trim()) {
      setErrorMessage("Client name is required.");
      return;
    }

    if (!strategy.trim()) {
      setErrorMessage("Strategy / description is required.");
      return;
    }

    if (normalizedStocks.length === 0) {
      setErrorMessage("Add at least one stock before saving.");
      return;
    }

    if (
      normalizedStocks.some(
        (stock) =>
          Number.isNaN(stock.shares) ||
          Number.isNaN(stock.cost_basis),
      )
    ) {
      setErrorMessage("Each stock row needs valid shares and cost basis values.");
      return;
    }

    const payload: AddClientPayload = {
      client_name: clientName.trim(),
      strategy: strategy.trim(),
      initial_holdings: normalizedStocks,
    };
    setIsSubmitting(true);
    onCreated?.(payload);
    handleClose();
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-4xl rounded-[2rem] border border-emerald-400/20 bg-slate-900/95 shadow-2xl shadow-emerald-950/30"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/70">New Portfolio</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Add New Client</h2>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="rounded-2xl border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white"
                aria-label="Close add client modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Client Name</span>
                  <input
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    placeholder="Oliver Brooks"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Strategy / Description</span>
                  <input
                    value={strategy}
                    onChange={(event) => setStrategy(event.target.value)}
                    placeholder="Large-cap quality"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/70"
                  />
                </label>
              </div>

              <div className="rounded-[1.75rem] border border-slate-800 bg-slate-950/70 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Starting Holdings</p>
                    <p className="mt-1 text-sm text-slate-400">Add 3 to 4 stocks before saving the new client.</p>
                  </div>

                  <button
                    type="button"
                    onClick={addStockRow}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    <Plus className="h-4 w-4" />
                    Add Stock
                  </button>
                </div>

                <div className="space-y-3">
                  {stocks.map((stock, index) => (
                    <div
                      key={`stock-row-${index}`}
                      className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 md:grid-cols-[1.2fr_1fr_1fr_auto]"
                    >
                      <input
                        value={stock.ticker}
                        onChange={(event) => updateStock(index, "ticker", event.target.value)}
                        placeholder="AAPL"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/70"
                      />
                      <input
                        value={stock.shares}
                        onChange={(event) => updateStock(index, "shares", event.target.value)}
                        placeholder="61"
                        inputMode="decimal"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/70"
                      />
                      <input
                        value={stock.costBasis}
                        onChange={(event) => updateStock(index, "costBasis", event.target.value)}
                        placeholder="201.55"
                        inputMode="decimal"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/70"
                      />
                      <button
                        type="button"
                        onClick={() => removeStockRow(index)}
                        disabled={stocks.length === 1}
                        className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-3 text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Remove stock row ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                  {errorMessage}
                </div>
              ) : null}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Saving..." : "Save Client"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
