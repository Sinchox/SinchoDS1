import React, { useState, useEffect, useMemo } from 'react';
import {
  Order,
  DateRangePreset,
  FinancialReport,
  ProductPerformanceItem,
  SupplierCostBreakdown,
  LossMakingOrder,
} from '../types.js';
import { computeFinancialReport, getDateRangeBoundaries } from '../utils/financials.js';
import { downloadCsv, generateFinancialOrdersCsv } from '../utils/csv.js';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Download,
  AlertTriangle,
  Package,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Percent,
  Search,
  RefreshCw,
  Info,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Truck,
  Box,
  FileSpreadsheet,
} from 'lucide-react';

interface FinancialsProps {
  orders: Order[];
  onRefreshOrders?: () => Promise<void>;
}

export const Financials: React.FC<FinancialsProps> = ({ orders, onRefreshOrders }) => {
  const [preset, setPreset] = useState<DateRangePreset>('this_month');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [appliedCustomStart, setAppliedCustomStart] = useState<string>('');
  const [appliedCustomEnd, setAppliedCustomEnd] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [txSearch, setTxSearch] = useState('');
  const [txSupplierFilter, setTxSupplierFilter] = useState('all');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Compute local report from current orders state
  const report: FinancialReport = useMemo(() => {
    return computeFinancialReport(
      orders,
      preset,
      preset === 'custom' ? appliedCustomStart || customStart : undefined,
      preset === 'custom' ? appliedCustomEnd || customEnd : undefined
    );
  }, [orders, preset, appliedCustomStart, appliedCustomEnd, customStart, customEnd]);

  const { summary, trends, comparison, bestSellingProducts, mostProfitableProducts, supplierComparisons, lossMakingOrders, cancellationAnalysis } = report;

  // Filtered transactions in the selected date range
  const scopedOrders = useMemo(() => {
    const { startDate, endDate } = getDateRangeBoundaries(
      preset,
      preset === 'custom' ? appliedCustomStart || customStart : undefined,
      preset === 'custom' ? appliedCustomEnd || customEnd : undefined
    );
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    return orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [orders, preset, appliedCustomStart, appliedCustomEnd, customStart, customEnd]);

  // Transaction table filtering
  const filteredTransactions = useMemo(() => {
    return scopedOrders.filter((o) => {
      if (txSupplierFilter !== 'all' && o.supplier_id !== txSupplierFilter) return false;
      if (txStatusFilter !== 'all') {
        if (txStatusFilter === 'completed' && o.status === 'cancelled') return false;
        if (txStatusFilter === 'cancelled' && o.status !== 'cancelled') return false;
        if (txStatusFilter === 'loss' && (Number(o.net_profit) || 0) >= 0) return false;
        if (txStatusFilter === 'refunded' && (!o.refund_amount || o.refund_amount <= 0)) return false;
      }
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase().trim();
        const num = (o.order_number || o.id).toLowerCase();
        const ext = (o.external_order_id || '').toLowerCase();
        const buyer = (o.buyer_name || o.buyer_username || '').toLowerCase();
        const track = (o.tracking_number || '').toLowerCase();
        const supp = (o.supplier_name || o.supplier_id || '').toLowerCase();
        return num.includes(q) || ext.includes(q) || buyer.includes(q) || track.includes(q) || supp.includes(q);
      }
      return true;
    });
  }, [scopedOrders, txSupplierFilter, txStatusFilter, txSearch]);

  // Unique suppliers in scope
  const uniqueSuppliers = useMemo(() => {
    const set = new Map<string, string>();
    for (const o of scopedOrders) {
      if (o.supplier_id) {
        set.set(o.supplier_id, o.supplier_name || o.supplier_id);
      }
    }
    return Array.from(set.entries());
  }, [scopedOrders]);

  const handleApplyCustom = () => {
    setAppliedCustomStart(customStart);
    setAppliedCustomEnd(customEnd);
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      // Export current scoped transactions
      const csv = generateFinancialOrdersCsv(scopedOrders);
      const filename = `sinchods-report-${preset}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, csv);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefresh = async () => {
    if (onRefreshOrders) {
      setIsRefreshing(true);
      try {
        await onRefreshOrders();
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Report Finanziario & Analisi Margini
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Monitoraggio utile netto reale, costi fornitore, commissioni stimate eBay e rendimento prodotti
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono">
              <DollarSign className="w-3 h-3 text-emerald-400" /> Valuta: EUR (€)
            </span>
            <span className="text-slate-500">•</span>
            <span>Periodo attivo: <strong className="text-emerald-400">{report.dateRange.label}</strong></span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {onRefreshOrders && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center gap-1.5"
              title="Aggiorna dati"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Aggiorna</span>
            </button>
          )}

          <button
            onClick={handleExportCsv}
            disabled={isExporting || scopedOrders.length === 0}
            className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>Esporta CSV ({scopedOrders.length})</span>
          </button>
        </div>
      </div>

      {/* Date Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 p-3 sm:p-4 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Filtro:
          </span>
          <button
            onClick={() => setPreset('today')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'today'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Oggi
          </button>
          <button
            onClick={() => setPreset('this_week')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'this_week'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Questa Settimana
          </button>
          <button
            onClick={() => setPreset('this_month')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'this_month'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Questo Mese
          </button>
          <button
            onClick={() => setPreset('previous_month')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'previous_month'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Mese Scorso
          </button>
          <button
            onClick={() => setPreset('custom')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'custom'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Personalizzato
          </button>
          <button
            onClick={() => setPreset('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
              preset === 'all'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
            }`}
          >
            Tutti
          </button>
        </div>

        {/* Custom Date Range Picker */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <span className="text-slate-500 text-xs">a</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleApplyCustom}
              className="px-3 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-xs font-medium transition"
            >
              Applica
            </button>
          </div>
        )}
      </div>

      {/* Primary KPI Grid (8 metrics) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Total Revenue */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Ricavi Totali</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
              €{summary.totalRevenue.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Ordini completati: <strong className="text-slate-200">{summary.completedOrdersCount}</strong></span>
            {comparison && comparison.revenueGrowthPercent !== 0 && (
              <span className={`flex items-center font-semibold ${comparison.revenueGrowthPercent > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {comparison.revenueGrowthPercent > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(comparison.revenueGrowthPercent)}%
              </span>
            )}
          </div>
        </div>

        {/* 2. Total Supplier Cost */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Costi Fornitori</span>
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-slate-200 tracking-tight">
              €{summary.totalSupplierCost.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Costo acquisto merce</span>
            <span className="text-slate-300 font-mono">
              {summary.totalRevenue > 0 ? ((summary.totalSupplierCost / summary.totalRevenue) * 100).toFixed(1) + '%' : '0%'}
            </span>
          </div>
        </div>

        {/* 3. Shipping & Packaging */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Spedizione & Pack</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-slate-200 tracking-tight">
              €{summary.totalShippingPackagingCost.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Sped: €{summary.supplierShippingCost.toFixed(2)}</span>
            <span>Pack: €{summary.packagingCost.toFixed(2)}</span>
          </div>
        </div>

        {/* 4. Estimated eBay Fees */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Commissioni eBay</span>
            <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-mono">Stima</span>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-slate-200 tracking-tight">
              €{summary.estimatedEbayFees.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Aliquota 11.5% + 0.35€</span>
            <span className="text-slate-300 font-mono">
              {summary.totalRevenue > 0 ? ((summary.estimatedEbayFees / summary.totalRevenue) * 100).toFixed(1) + '%' : '0%'}
            </span>
          </div>
        </div>

        {/* 5. Refunds Issued */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Rimborsi Emessi</span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
              <RotateCcw className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-rose-400 tracking-tight">
              €{summary.totalRefunds.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Rimborsi: <strong className="text-slate-300">{cancellationAnalysis.refundsCount}</strong></span>
            <span className="text-slate-400">Detratto dall'utile</span>
          </div>
        </div>

        {/* 6. Net Profit */}
        <div className={`p-4 rounded-2xl shadow-sm relative overflow-hidden border transition ${
          summary.netProfit >= 0
            ? 'bg-gradient-to-br from-emerald-950/40 to-slate-900 border-emerald-500/30'
            : 'bg-gradient-to-br from-rose-950/40 to-slate-900 border-rose-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Utile Netto</span>
            <div className={`p-1.5 rounded-lg ${summary.netProfit >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className={`text-xl sm:text-2xl font-black tracking-tight ${summary.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              €{summary.netProfit.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300 border-t border-slate-800/60 pt-2">
            <span>Margine: <strong className={summary.profitMargin >= 15 ? 'text-emerald-400' : 'text-amber-400'}>{summary.profitMargin}%</strong></span>
            {comparison && (
              <span className={`font-semibold ${comparison.profitGrowthPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {comparison.profitGrowthPercent >= 0 ? '+' : ''}{comparison.profitGrowthPercent}%
              </span>
            )}
          </div>
        </div>

        {/* 7. Profit Margin */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Margine Medio</span>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className={`text-xl sm:text-2xl font-black tracking-tight ${summary.profitMargin >= 15 ? 'text-emerald-400' : summary.profitMargin > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
              {summary.profitMargin}%
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Target min: <strong className="text-slate-300">15.0%</strong></span>
            <span className={summary.profitMargin >= 15 ? 'text-emerald-400' : 'text-amber-400'}>
              {summary.profitMargin >= 15 ? 'In Target' : 'Sotto Target'}
            </span>
          </div>
        </div>

        {/* 8. Average Order Value (AOV) & Profit */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">AOV (Scontrino Medio)</span>
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-slate-200 tracking-tight">
              €{summary.averageOrderValue.toFixed(2)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2">
            <span>Utile medio / ordine:</span>
            <strong className="text-emerald-400 font-mono">€{summary.averageOrderProfit.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      {/* Loss-Making Orders Warning Alert */}
      {lossMakingOrders.length > 0 && (
        <div className="bg-rose-950/30 border border-rose-500/40 p-4 rounded-2xl shadow-lg">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-200 flex items-center gap-2">
                  Rilevati {lossMakingOrders.length} Ordini in Perdita
                </h3>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  Questi ordini hanno generato un margine netto negativo a causa di rimborsi, spese di spedizione elevate o commissioni.
                </p>
              </div>
            </div>
            <span className="text-xs font-bold px-2 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
              Perdita tot: €{lossMakingOrders.reduce((sum, o) => sum + o.netLoss, 0).toFixed(2)}
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead>
                <tr className="border-b border-rose-500/20 text-slate-400 font-medium">
                  <th className="py-1.5 px-2">Ordine</th>
                  <th className="py-1.5 px-2">Data</th>
                  <th className="py-1.5 px-2">Acquirente</th>
                  <th className="py-1.5 px-2 text-right">Ricavi</th>
                  <th className="py-1.5 px-2 text-right">Costi Fornitore</th>
                  <th className="py-1.5 px-2 text-right">Rimborsi</th>
                  <th className="py-1.5 px-2 text-right">Perdita Netta</th>
                  <th className="py-1.5 px-2">Causa Diagnosticata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-500/10 font-mono">
                {lossMakingOrders.map((l) => (
                  <tr key={l.orderId} className="hover:bg-rose-500/5">
                    <td className="py-1.5 px-2 font-bold text-rose-300">{l.orderNumber}</td>
                    <td className="py-1.5 px-2 text-slate-400">{l.date.slice(0, 10)}</td>
                    <td className="py-1.5 px-2 text-slate-300 font-sans">{l.buyerName}</td>
                    <td className="py-1.5 px-2 text-right">€{l.revenue.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right">€{l.supplierCost.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-rose-400">€{l.refunds.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-bold text-rose-400">-€{l.netLoss.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-slate-300 font-sans">{l.lossReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Revenue & Profit Trends Chart (Visual Representation) */}
      <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Andamento Temporale (Ricavi vs Costi vs Utile)
            </h2>
            <p className="text-xs text-slate-400">
              Ripartizione giornaliera dell'attività per il periodo selezionato ({report.dateRange.label})
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Ricavi</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Costi</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-teal-400 inline-block" /> Utile Netto</span>
          </div>
        </div>

        {/* Bars Container */}
        {trends.length === 0 || trends.every((t) => t.revenue === 0) ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            Nessuna transazione registrata nel periodo selezionato.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-44 flex items-end gap-1.5 sm:gap-2 pt-6 pb-2 overflow-x-auto scrollbar-none border-b border-slate-800">
              {(() => {
                const maxVal = Math.max(...trends.map((t) => Math.max(t.revenue, t.costs, t.profit, 1)));
                return trends.map((t) => {
                  const revHeight = Math.max(4, Math.round((t.revenue / maxVal) * 100));
                  const costHeight = Math.max(4, Math.round((t.costs / maxVal) * 100));
                  const profHeight = Math.max(4, Math.round((Math.max(0, t.profit) / maxVal) * 100));

                  return (
                    <div key={t.date} className="flex-1 min-w-[36px] flex flex-col items-center justify-end h-full group relative">
                      {/* Tooltip */}
                      <div className="absolute -top-14 hidden group-hover:flex flex-col items-center bg-slate-950 border border-slate-700 text-slate-200 text-[10px] p-1.5 rounded-lg z-20 whitespace-nowrap shadow-xl">
                        <span className="font-bold text-white">{t.date}</span>
                        <span>Ricavi: €{t.revenue.toFixed(2)}</span>
                        <span>Utile: €{t.profit.toFixed(2)} ({t.ordersCount} ord.)</span>
                      </div>

                      {/* Bar groups */}
                      <div className="w-full flex items-end justify-center gap-0.5 h-full">
                        <div
                          style={{ height: `${revHeight}%` }}
                          className="w-2 sm:w-2.5 bg-emerald-500 rounded-t transition-all group-hover:brightness-125"
                          title={`Ricavi: €${t.revenue.toFixed(2)}`}
                        />
                        <div
                          style={{ height: `${costHeight}%` }}
                          className="w-2 sm:w-2.5 bg-blue-500 rounded-t transition-all group-hover:brightness-125"
                          title={`Costi: €${t.costs.toFixed(2)}`}
                        />
                        <div
                          style={{ height: `${profHeight}%` }}
                          className={`w-2 sm:w-2.5 rounded-t transition-all group-hover:brightness-125 ${t.profit >= 0 ? 'bg-teal-400' : 'bg-rose-500'}`}
                          title={`Utile: €${t.profit.toFixed(2)}`}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1 truncate max-w-full font-mono">{t.label}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Two Column Layout: Products & Suppliers Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Best-Selling & Most Profitable Products */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" /> Prodotti Più Venduti & Redditizi
              </h2>
              <span className="text-xs text-slate-400">{bestSellingProducts.length} articoli</span>
            </div>

            {bestSellingProducts.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                Nessun prodotto venduto nel periodo selezionato.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-2 px-1">Prodotto</th>
                      <th className="py-2 px-1 text-center">Unità</th>
                      <th className="py-2 px-1 text-right">Ricavi</th>
                      <th className="py-2 px-1 text-right">Utile Netto</th>
                      <th className="py-2 px-1 text-right">Margine</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {bestSellingProducts.map((p, idx) => (
                      <tr key={p.sku || p.title + idx} className="hover:bg-slate-800/30">
                        <td className="py-2 px-1 font-sans">
                          <div className="font-semibold text-slate-200 truncate max-w-[180px] sm:max-w-[220px]" title={p.title}>
                            {p.title}
                          </div>
                          {p.variantName && (
                            <div className="text-[10px] text-slate-400 truncate">{p.variantName}</div>
                          )}
                          {p.sku && <div className="text-[9px] text-slate-500 font-mono">{p.sku}</div>}
                        </td>
                        <td className="py-2 px-1 text-center font-bold text-white">{p.unitsSold}</td>
                        <td className="py-2 px-1 text-right text-slate-300">€{p.totalRevenue.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right font-bold text-emerald-400">€{p.totalProfit.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right font-semibold">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.profitMargin >= 20 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>
                            {p.profitMargin}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Supplier Cost & Margin Comparison */}
        <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" /> Confronto Costi per Fornitore
              </h2>
              <span className="text-xs text-slate-400">{supplierComparisons.length} fornitori</span>
            </div>

            {supplierComparisons.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                Nessun dato fornitore registrato nel periodo.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-2 px-1">Fornitore</th>
                      <th className="py-2 px-1 text-center">Ordini</th>
                      <th className="py-2 px-1 text-right">Ricavi</th>
                      <th className="py-2 px-1 text-right">Costo Fornitura</th>
                      <th className="py-2 px-1 text-right">Utile Netto</th>
                      <th className="py-2 px-1 text-right">Margine %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {supplierComparisons.map((s) => (
                      <tr key={s.supplierId} className="hover:bg-slate-800/30">
                        <td className="py-2 px-1 font-sans">
                          <div className="font-bold text-slate-200">{s.supplierName}</div>
                          <div className="text-[10px] text-slate-400">{s.unitsSold} unità vendute</div>
                        </td>
                        <td className="py-2 px-1 text-center text-slate-300">{s.ordersCount}</td>
                        <td className="py-2 px-1 text-right text-slate-300">€{s.totalRevenue.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right text-slate-400">€{s.totalCost.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right font-bold text-emerald-400">€{s.totalProfit.toFixed(2)}</td>
                        <td className="py-2 px-1 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${s.profitMargin >= 15 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                            {s.profitMargin}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Refund & Cancellation Analysis Section */}
      <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-400" /> Analisi Annullamenti & Rimborsi
            </h2>
            <p className="text-xs text-slate-400">
              Impatto economico degli ordini annullati e dei rimborsi erogati ai clienti
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
              Tasso Annullamento: <strong className={cancellationAnalysis.cancellationRate > 5 ? 'text-rose-400' : 'text-emerald-400'}>{cancellationAnalysis.cancellationRate}%</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
              Ricavi Potenziali Persi: <strong className="text-rose-400 font-mono">€{cancellationAnalysis.potentialRevenueLost.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        {cancellationAnalysis.reasons.length === 0 ? (
          <div className="py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Nessun ordine annullato nel periodo selezionato.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cancellationAnalysis.reasons.map((r) => (
              <div key={r.reason} className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 truncate">{r.reason}</span>
                    <span className="text-xs font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded font-mono">
                      {r.count} ord.
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      className="bg-rose-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, r.percentage)}%` }}
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Quota: {r.percentage}%</span>
                  <span>Persi: €{r.potentialRevenueLost.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction-Level Financial Reporting Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Dettaglio Transazioni & Contabilità Ordini
            </h2>
            <p className="text-xs text-slate-400">
              Visualizzazione dettagliata ricavi, costi merci, packaging, commissioni eBay e utile netto per ordine
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Cerca ordine, cliente, tracking..."
                className="bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-44 sm:w-56"
              />
            </div>

            {/* Supplier Filter */}
            <select
              value={txSupplierFilter}
              onChange={(e) => setTxSupplierFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Tutti i Fornitori</option>
              {uniqueSuppliers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={txStatusFilter}
              onChange={(e) => setTxStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Tutti gli Stati</option>
              <option value="completed">Solo Conclusi / Attivi</option>
              <option value="cancelled">Solo Annullati</option>
              <option value="loss">Solo in Perdita (Negativi)</option>
              <option value="refunded">Con Rimborsi</option>
            </select>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            Nessuna transazione corrisponde ai filtri selezionati.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/70 text-slate-400 font-semibold border-b border-slate-800">
                  <th className="py-3 px-3">Ordine</th>
                  <th className="py-3 px-3">Data</th>
                  <th className="py-3 px-3">Acquirente</th>
                  <th className="py-3 px-3">Fornitore</th>
                  <th className="py-3 px-3 text-right">Ricavo Totale</th>
                  <th className="py-3 px-3 text-right">Costo Merce</th>
                  <th className="py-3 px-3 text-right">Sped. & Pack</th>
                  <th className="py-3 px-3 text-right">Comm. eBay (Stima)</th>
                  <th className="py-3 px-3 text-right">Rimborsi</th>
                  <th className="py-3 px-3 text-right">Utile Netto</th>
                  <th className="py-3 px-3 text-right">Margine %</th>
                  <th className="py-3 px-3 text-center">Stato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono">
                {filteredTransactions.map((o) => {
                  let purchaseCost = 0;
                  if (Array.isArray(o.items)) {
                    for (const i of o.items) {
                      purchaseCost += (Number(i.purchase_cost ?? i.supplier_cost) || 0) * (Number(i.quantity) || 1);
                    }
                  }

                  const rev = Number(o.total_paid) || 0;
                  const shippingPack = (Number(o.supplier_shipping_cost) || 0) + (Number(o.packaging_cost) || 0);
                  const fees = Number(o.estimated_ebay_fees) || 0;
                  const refunds = Number(o.refund_amount) || 0;
                  const profit = Number(o.net_profit) || 0;
                  const margin = Number(o.profit_margin) || 0;

                  const isCancelled = o.status === 'cancelled';
                  const isLoss = profit < 0 && !isCancelled;

                  return (
                    <tr
                      key={o.id}
                      className={`hover:bg-slate-800/30 transition ${isCancelled ? 'opacity-60 bg-slate-950/40' : isLoss ? 'bg-rose-500/5' : ''}`}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-white">{o.order_number || o.id}</div>
                        {o.external_order_id && (
                          <div className="text-[10px] text-slate-500 font-mono">{o.external_order_id}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{o.created_at.slice(0, 10)}</td>
                      <td className="py-2.5 px-3 text-slate-200 font-sans truncate max-w-[140px]" title={o.buyer_name || o.buyer_username}>
                        {o.buyer_name || o.buyer_username || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-sans truncate max-w-[130px]" title={o.supplier_name || o.supplier_id}>
                        {o.supplier_name || o.supplier_id || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-200">
                        {isCancelled ? <span className="line-through text-slate-500">€{rev.toFixed(2)}</span> : `€${rev.toFixed(2)}`}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400">€{purchaseCost.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">€{shippingPack.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">€{fees.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">
                        {refunds > 0 ? <span className="text-rose-400 font-bold">-€{refunds.toFixed(2)}</span> : <span className="text-slate-600">-</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black">
                        {isCancelled ? (
                          <span className="text-slate-500 text-[11px]">Annullato</span>
                        ) : (
                          <span className={profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            €{profit.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        {isCancelled ? (
                          <span className="text-slate-600">-</span>
                        ) : (
                          <span className={margin >= 15 ? 'text-emerald-400' : margin > 0 ? 'text-amber-400' : 'text-rose-400'}>
                            {margin}%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-sans font-medium capitalize ${
                          o.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                          o.status === 'shipped' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                          o.status === 'cancelled' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                          o.status === 'returned' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                          'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3 bg-slate-950/40 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>Totale transazioni visualizzate: <strong>{filteredTransactions.length}</strong></span>
          <div className="flex items-center gap-4">
            <span>Ricavi periodo: <strong className="text-slate-200 font-bold">€{summary.totalRevenue.toFixed(2)}</strong></span>
            <span>Utile netto periodo: <strong className={summary.netProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>€{summary.netProfit.toFixed(2)}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
