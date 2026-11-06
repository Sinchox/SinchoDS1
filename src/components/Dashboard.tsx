import React, { useState, useEffect } from 'react';
import { Product, ImportHistoryItem, EbayListing, Supplier, Order } from '../types.js';
import { PageId } from './Navbar.js';
import {
  Package,
  Layers,
  Tag,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  Globe,
  Download,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  Clock,
  Sparkles,
  Store,
  DollarSign,
  RefreshCw,
  Bell,
  ShieldCheck,
  ShoppingBag,
  Truck,
  RotateCcw,
} from 'lucide-react';
import { generateProductsCsv, generateVariantsCsv, generateCombinedCsv, downloadCsv } from '../utils/csv.js';

interface DashboardProps {
  products: Product[];
  listings: EbayListing[];
  suppliers: Supplier[];
  history: ImportHistoryItem[];
  orders?: Order[];
  setCurrentPage: (page: PageId) => void;
  isLoading: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  products,
  listings,
  suppliers,
  history,
  orders = [],
  setCurrentPage,
  isLoading,
}) => {
  // Compute real metrics from live records
  const totalProducts = products.length;
  const totalVariants = products.reduce((acc, p) => acc + (p.variants ? p.variants.length : 0), 0);

  const uniqueBrands = new Set(products.map((p) => p.brand).filter(Boolean));
  const totalBrands = uniqueBrands.size;

  const inStockCount = products.filter(
    (p) => p.availability === 'InStock' || (p.stock_quantity != null && p.stock_quantity > 0)
  ).length;

  const outOfStockCount = products.filter(
    (p) => p.availability === 'OutOfStock' || (p.stock_quantity != null && p.stock_quantity === 0)
  ).length;

  const missingSkuCount = products.filter((p) => !p.sku).length;
  const missingEanCount = products.filter((p) => !p.ean).length;

  const draftListingsCount = listings.filter((l) => l.status === 'draft').length;
  const activeListingsCount = listings.filter((l) => l.status === 'active').length;
  const totalEstimatedProfit = listings.reduce((acc, l) => acc + (l.expected_profit || 0), 0);

  const activeSuppliersCount = suppliers.filter((s) => s.status === 'active').length;

  const successfulImports = history.filter((h) => h.status === 'success').length;
  const failedImports = history.filter((h) => h.status === 'failed').length;
  const blockedImports = history.filter((h) => h.status === 'blocked').length;

  // Phase 1.6A Order Metrics
  const orderList = orders || [];
  const pendingOrdersCount = orderList.filter(
    (o) => o.status === 'pending' || o.status === 'pending_fulfillment'
  ).length;
  const awaitingPurchaseCount = orderList.filter((o) => o.status === 'awaiting_purchase').length;
  const awaitingDispatchCount = orderList.filter((o) => o.status === 'purchased').length;
  const shippedOrdersCount = orderList.filter((o) => o.status === 'shipped').length;
  const deliveredOrdersCount = orderList.filter(
    (o) => o.status === 'delivered' || o.status === 'fulfilled'
  ).length;
  const returnedOrdersCount = orderList.filter((o) => o.status === 'returned').length;
  const totalOrderRevenue = orderList.reduce((acc, o) => acc + (Number(o.total_paid) || 0), 0);
  const totalOrderNetProfit = orderList.reduce((acc, o) => acc + (Number(o.net_profit) || 0), 0);

  const recentProducts = [...products]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const [monitoringStatus, setMonitoringStatus] = useState<{
    statusCounts?: {
      total: number;
      idle: number;
      checking: number;
      error: number;
      out_of_stock: number;
      pending_approval: number;
      changes_detected: number;
    };
    pendingReviewsCount?: number;
    pendingPriceApprovalsCount?: number;
    unreadNotificationsCount?: number;
    nextDueTimestamp?: string | null;
  } | null>(null);

  useEffect(() => {
    fetch('/api/monitoring/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setMonitoringStatus(data);
      })
      .catch(() => {});
  }, []);

  const handleExportAll = () => {
    if (products.length === 0) return;
    const csv = generateCombinedCsv(products);
    downloadCsv(`sinchods_export_completo_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Welcome & Quick Action Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 text-white relative overflow-hidden shadow-lg">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-medium mb-2 border border-blue-500/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>SinchoDS &bull; Multi-Supplier Sourcing & Dropshipping</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              SinchoDS & eBay.it Overview
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
              Import products from PlusPower and multiple suppliers, create compliant eBay.it listing drafts, calculate real net margins, and publish via official APIs.
            </p>
          </div>

          {/* Quick Buttons for Mobile & Desktop */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCurrentPage('financials')}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-medium text-xs sm:text-sm rounded-xl transition-all shadow-md shadow-emerald-950/40"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Finanze & Margini</span>
            </button>
            <button
              onClick={() => setCurrentPage('orders')}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-medium text-xs sm:text-sm rounded-xl transition-all border border-slate-700"
            >
              <ShoppingBag className="w-4 h-4 text-emerald-400" />
              <span>Ordini ({orderList.length})</span>
            </button>
            <button
              onClick={() => setCurrentPage('products')}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 px-3.5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium text-xs sm:text-sm rounded-xl transition-all shadow-md shadow-blue-950/40"
            >
              <Package className="w-4 h-4" />
              <span>Catalogue & eBay</span>
            </button>
            <button
              onClick={() => setCurrentPage('html-import')}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-medium text-xs sm:text-sm rounded-xl transition-all border border-slate-700"
            >
              <FileCode className="w-4 h-4 text-emerald-400" />
              <span>HTML Import</span>
            </button>
            <button
              onClick={() => setCurrentPage('listings')}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-medium text-xs sm:text-sm rounded-xl transition-all border border-slate-700"
            >
              <Store className="w-4 h-4 text-blue-400" />
              <span>Listings ({listings.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metrics Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Products */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Catalogue Products</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {isLoading ? '...' : totalProducts}
            </div>
            <button
              onClick={() => setCurrentPage('products')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center"
            >
              Catalogue <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{totalVariants} variants / flavours</p>
        </div>

        {/* eBay Listings Status */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">eBay.it Listings</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Store className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {listings.length}
            </div>
            <span className="text-xs text-blue-400 font-medium">
              {activeListingsCount} Active &bull; {draftListingsCount} Drafts
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">eBay Italy Marketplace</p>
        </div>

        {/* Estimated Profit */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Estimated Net Profit</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              € {totalEstimatedProfit.toFixed(2)}
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Net of eBay selling fees</p>
        </div>

        {/* Suppliers Status */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Connected Suppliers</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center space-x-2">
            <span className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {activeSuppliersCount}
            </span>
            <span className="text-xs text-purple-400 font-medium">
              PlusPower Active
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Independent connectors</p>
        </div>
      </div>

      {/* Phase 1.4: Price & Stock Monitoring Engine Overview */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white tracking-tight">Price &amp; Stock Monitoring Engine</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Active (6h Cycle)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Automatic dropship protection: margin threshold enforcement, stock depletion to 0, restoration, and content change review queue.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentPage('products')}
            className="self-start sm:self-auto text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors inline-flex items-center space-x-1.5"
          >
            <span>Review Pipeline</span>
            <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 pt-3">
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium">Monitored Items</span>
            <div className="text-lg font-bold text-white mt-1">
              {monitoringStatus?.statusCounts?.total ?? totalProducts}
            </div>
            <span className="text-[10px] text-slate-500">Every 6 hours</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium">Pending Price Approvals</span>
            <div className={`text-lg font-bold mt-1 ${(monitoringStatus?.pendingPriceApprovalsCount || 0) > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
              {monitoringStatus?.pendingPriceApprovalsCount ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Decreases / Margin alerts</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium">Content Changes Queue</span>
            <div className={`text-lg font-bold mt-1 ${(monitoringStatus?.pendingReviewsCount || 0) > 0 ? 'text-blue-400' : 'text-slate-300'}`}>
              {monitoringStatus?.pendingReviewsCount ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Held for manual review</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium">Out of Stock Alerts</span>
            <div className={`text-lg font-bold mt-1 ${(monitoringStatus?.statusCounts?.out_of_stock || 0) > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
              {monitoringStatus?.statusCounts?.out_of_stock ?? outOfStockCount}
            </div>
            <span className="text-[10px] text-slate-500">eBay qty set to 0</span>
          </div>
        </div>
      </div>

      {/* Orders & Fulfillment Summary (Phase 1.6A) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white tracking-tight">Ordini &amp; Fulfillment Overview</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {orderList.length} Ordini Totali
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Monitoraggio ordini attivi, acquisti dai fornitori, tracciamento spedizioni e controllo utile netto.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentPage('orders')}
            className="self-start sm:self-auto text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors inline-flex items-center space-x-1.5 shadow-sm"
          >
            <span>Apri Gestione Ordini</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 6 Core Summaries Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-amber-400 text-[11px] font-medium">
              <span>In Attesa</span>
              <Clock className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{pendingOrdersCount}</div>
            <span className="text-[10px] text-slate-500">Da elaborare</span>
          </div>

          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-purple-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-purple-400 text-[11px] font-medium">
              <span>Da Ordinare</span>
              <Package className="w-3.5 h-3.5" />
            </div>
            <div className={`text-xl font-bold mt-1 ${awaitingPurchaseCount > 0 ? 'text-purple-300' : 'text-white'}`}>
              {awaitingPurchaseCount}
            </div>
            <span className="text-[10px] text-slate-500">Al fornitore</span>
          </div>

          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-blue-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-blue-400 text-[11px] font-medium">
              <span>Da Spedire</span>
              <Truck className="w-3.5 h-3.5" />
            </div>
            <div className={`text-xl font-bold mt-1 ${awaitingDispatchCount > 0 ? 'text-blue-300' : 'text-white'}`}>
              {awaitingDispatchCount}
            </div>
            <span className="text-[10px] text-slate-500">Acquistati fornitore</span>
          </div>

          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-cyan-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-cyan-400 text-[11px] font-medium">
              <span>Spediti</span>
              <Truck className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{shippedOrdersCount}</div>
            <span className="text-[10px] text-slate-500">In transito corriere</span>
          </div>

          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-emerald-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-emerald-400 text-[11px] font-medium">
              <span>Consegnati</span>
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-emerald-400 mt-1">{deliveredOrdersCount}</div>
            <span className="text-[10px] text-slate-500">Consegna completata</span>
          </div>

          <div
            onClick={() => setCurrentPage('orders')}
            className="cursor-pointer p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-rose-500/40 transition-colors"
          >
            <div className="flex items-center justify-between text-rose-400 text-[11px] font-medium">
              <span>Resi</span>
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
            <div className={`text-xl font-bold mt-1 ${returnedOrdersCount > 0 ? 'text-rose-400' : 'text-white'}`}>
              {returnedOrdersCount}
            </div>
            <span className="text-[10px] text-slate-500">Resi o rimborsati</span>
          </div>
        </div>

        {/* Bottom Financial Banner inside order summary */}
        <div className="bg-slate-950/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs border border-slate-850">
          <div className="flex items-center space-x-6">
            <div>
              <span className="text-slate-500 text-[10px] block">Fatturato Ordini Totale</span>
              <span className="font-bold text-white text-sm">€{totalOrderRevenue.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">Utile Netto Calcolato</span>
              <span className={`font-bold text-sm ${totalOrderNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                €{totalOrderNetProfit.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentPage('financials')}
              className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold inline-flex items-center space-x-1"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Report Finanziario</span>
            </button>
            <button
              onClick={() => setCurrentPage('orders')}
              className="text-slate-400 hover:text-slate-200 text-xs font-medium inline-flex items-center space-x-1"
            >
              <span>Ordini ({orderList.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quality Checks & Pipeline Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Data Quality Check */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Catalogue Quality Control
            </h3>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800">
              <span className="text-xs text-slate-300">Missing supplier SKU</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${missingSkuCount > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {missingSkuCount}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800">
              <span className="text-xs text-slate-300">Missing EAN / Barcode</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${missingEanCount > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {missingEanCount}
              </span>
            </div>
          </div>
        </div>

        {/* Pipeline Statistics */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Import Statistics
            </h3>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-900/40 text-center">
              <div className="text-base sm:text-lg font-bold text-emerald-400">{successfulImports}</div>
              <div className="text-[10px] text-emerald-300/80 font-medium">Successful</div>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-900/40 text-center">
              <div className="text-base sm:text-lg font-bold text-amber-400">{blockedImports}</div>
              <div className="text-[10px] text-amber-300/80 font-medium">Blocked (CF)</div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/40 text-center">
              <div className="text-base sm:text-lg font-bold text-rose-400">{failedImports}</div>
              <div className="text-[10px] text-rose-300/80 font-medium">Failed</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2.5">
            Pages protected by Cloudflare can be imported reliably using <strong>HTML Import</strong>.
          </p>
        </div>

        {/* Zero Paid APIs Guarantee */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Zero Paid Services Policy
              </h3>
              <ShieldAlert className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              SinchoDS relies strictly on official eBay Sell APIs and our built-in engine to generate Italian SEO titles and descriptions, with zero dependencies on OpenAI, Tavily, or paid proxies.
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-emerald-400 flex items-center">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            <span>No hidden costs or subscriptions</span>
          </div>
        </div>
      </div>

      {/* Recently Added Products Feed & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Products */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center">
              <Clock className="w-4 h-4 mr-2 text-emerald-400" />
              Recently Imported Products
            </h2>
            <button
              onClick={() => setCurrentPage('products')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              Full Catalogue
            </button>
          </div>

          {totalProducts === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <Package className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-300">No products in catalogue</p>
              <button
                onClick={() => setCurrentPage('html-import')}
                className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-xl transition-all"
              >
                Import First Product
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {recentProducts.map((product) => (
                <div key={product.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-3 min-w-0">
                    {product.images && product.images.length > 0 ? (
                      <img
                        src={product.images[0]}
                        alt={product.title}
                        className="w-10 h-10 rounded-lg object-contain bg-slate-950 p-1 border border-slate-800 flex-shrink-0"
                        onError={(e) => {
                          (e.target as any).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                        <Package className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{product.title}</p>
                      <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-0.5">
                        {product.brand && <span className="text-slate-300">{product.brand}</span>}
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[10px]">
                          {product.supplier_name || 'PlusPower'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-xs font-bold text-white">
                      {product.price !== null ? `€ ${Number(product.price).toFixed(2)}` : 'N/A'}
                    </span>
                    <div className="text-[10px] text-slate-500">
                      {new Date(product.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity Log */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center">
              <TrendingUp className="w-4 h-4 mr-2 text-blue-400" />
              System & eBay Activity
            </h2>
            <button
              onClick={() => setCurrentPage('settings')}
              className="text-xs text-slate-400 hover:text-slate-300 font-medium"
            >
              Settings
            </button>
          </div>

          {history.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <Clock className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-300">No activity recorded</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {history.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl bg-slate-850/60 border border-slate-800 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start space-x-2 min-w-0">
                    {item.status === 'success' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    )}
                    {item.status === 'blocked' && (
                      <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    )}
                    {item.status === 'failed' && (
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200 truncate">
                        {item.title || item.url}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                        {item.message}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 flex-shrink-0">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
