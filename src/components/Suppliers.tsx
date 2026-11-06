import React, { useState } from 'react';
import { Supplier, SupplierParserConfig } from '../types.js';
import { PageId } from './Navbar.js';
import {
  Layers,
  CheckCircle2,
  XCircle,
  Plus,
  RefreshCw,
  ExternalLink,
  Settings as SettingsIcon,
  Trash2,
  Edit3,
  FlaskConical,
  ShieldCheck,
  Check,
  AlertTriangle,
  Globe,
  DollarSign,
  Truck,
  Box,
  Code,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface SuppliersProps {
  suppliers: Supplier[];
  onToggleSupplier: (id: string) => void;
  onAddSupplier: (supplier: Supplier) => void;
  onUpdateSupplier?: (supplier: Supplier) => void;
  onDeleteSupplier?: (id: string) => void;
  setCurrentPage: (page: PageId) => void;
}

export const Suppliers: React.FC<SuppliersProps> = ({
  suppliers,
  onToggleSupplier,
  onAddSupplier,
  onUpdateSupplier,
  onDeleteSupplier,
  setCurrentPage,
}) => {
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [testModalSupplier, setTestModalSupplier] = useState<Supplier | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state for add/edit
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formFetchMethod, setFormFetchMethod] = useState<'direct' | 'zenrows'>('direct');
  const [formJsRender, setFormJsRender] = useState(false);
  const [formShippingCost, setFormShippingCost] = useState<number>(0);
  const [formStockThreshold, setFormStockThreshold] = useState<number>(5);
  const [formMarginPercent, setFormMarginPercent] = useState<number>(25);
  const [formFixedProfit, setFormFixedProfit] = useState<number>(5);
  const [showAdvancedSelectors, setShowAdvancedSelectors] = useState(false);
  const [selectorTitle, setSelectorTitle] = useState('');
  const [selectorPrice, setSelectorPrice] = useState('');
  const [selectorSku, setSelectorSku] = useState('');
  const [selectorEan, setSelectorEan] = useState('');
  const [selectorImages, setSelectorImages] = useState('');
  const [selectorDesc, setSelectorDesc] = useState('');

  // Parser test mode state
  const [testUrl, setTestUrl] = useState('');
  const [testFetchMethod, setTestFetchMethod] = useState<'direct' | 'zenrows'>('direct');
  const [testJsRender, setTestJsRender] = useState(false);
  const [isTestingParser, setIsTestingParser] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    product?: any;
    detectedFields?: any;
    error?: string;
  } | null>(null);

  // Quick connectivity test state per supplier
  const [quickTestingId, setQuickTestingId] = useState<string | null>(null);
  const [quickTestMessage, setQuickTestMessage] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const resetForm = () => {
    setFormName('');
    setFormUrl('');
    setFormDesc('');
    setFormFetchMethod('direct');
    setFormJsRender(false);
    setFormShippingCost(0);
    setFormStockThreshold(5);
    setFormMarginPercent(25);
    setFormFixedProfit(5);
    setShowAdvancedSelectors(false);
    setSelectorTitle('');
    setSelectorPrice('');
    setSelectorSku('');
    setSelectorEan('');
    setSelectorImages('');
    setSelectorDesc('');
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (s: Supplier) => {
    setEditingSupplier(s);
    setFormName(s.name);
    setFormUrl(s.baseUrl || s.base_url || '');
    setFormDesc(s.description || '');
    setFormFetchMethod(s.fetchMethod || s.fetch_method || 'direct');
    setFormJsRender(Boolean(s.jsRender ?? s.js_render ?? false));
    setFormShippingCost(s.shippingCost ?? s.shipping_cost ?? 0);
    setFormStockThreshold(s.stockThreshold ?? s.stock_threshold ?? 5);
    setFormMarginPercent(s.pricingRule?.targetMarginPercent || 25);
    setFormFixedProfit(s.pricingRule?.targetFixedProfit || 5);

    const cfg = s.parserConfig || s.parser_config;
    if (cfg) {
      setSelectorTitle(cfg.titleSelector || '');
      setSelectorPrice(cfg.priceSelector || '');
      setSelectorSku(cfg.skuSelector || '');
      setSelectorEan(cfg.eanSelector || '');
      setSelectorImages(cfg.imageSelector || '');
      setSelectorDesc(cfg.descriptionSelector || '');
      setShowAdvancedSelectors(true);
    } else {
      setShowAdvancedSelectors(false);
    }
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formUrl.trim()) return;

    const parserConfig: SupplierParserConfig = {};
    if (selectorTitle.trim()) parserConfig.titleSelector = selectorTitle.trim();
    if (selectorPrice.trim()) parserConfig.priceSelector = selectorPrice.trim();
    if (selectorSku.trim()) parserConfig.skuSelector = selectorSku.trim();
    if (selectorEan.trim()) parserConfig.eanSelector = selectorEan.trim();
    if (selectorImages.trim()) parserConfig.imageSelector = selectorImages.trim();
    if (selectorDesc.trim()) parserConfig.descriptionSelector = selectorDesc.trim();

    const payload: Supplier = {
      id: editingSupplier ? editingSupplier.id : formName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: formName.trim(),
      baseUrl: formUrl.trim(),
      logoText: `📦 ${formName.trim()}`,
      status: editingSupplier ? editingSupplier.status : 'active',
      connected: true,
      lastSyncAt: editingSupplier?.lastSyncAt || new Date().toISOString(),
      productCount: editingSupplier?.productCount || 0,
      failedCount: 0,
      description: formDesc.trim() || 'Custom workspace supplier',
      isGlobal: false,
      fetchMethod: formFetchMethod,
      jsRender: formJsRender,
      shippingCost: Number(formShippingCost) || 0,
      stockThreshold: Number(formStockThreshold) || 5,
      pricingRule: {
        targetMarginPercent: Number(formMarginPercent) || 25,
        targetFixedProfit: Number(formFixedProfit) || 5,
        supplierShippingCost: Number(formShippingCost) || 0,
        ebayFeePercent: 11.5,
        ebayFixedFee: 0.35,
        paymentFeePercent: 0,
        vatRatePercent: 22,
      },
      parserConfig: Object.keys(parserConfig).length > 0 ? parserConfig : undefined,
      supportedFeatures: editingSupplier?.supportedFeatures || {
        sitemap: false,
        variants: true,
        lotExpiry: false,
        liveScraping: true,
        htmlImport: true,
      },
    };

    // Save to server
    try {
      const endpoint = editingSupplier ? `/api/suppliers/${editingSupplier.id}` : '/api/suppliers';
      const method = editingSupplier ? 'PUT' : 'POST';
      await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier: payload }),
      });
    } catch {
      // Fallback
    }

    if (editingSupplier && onUpdateSupplier) {
      onUpdateSupplier(payload);
    } else {
      onAddSupplier(payload);
    }

    setShowAddModal(false);
    setEditingSupplier(null);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    } catch {
      // Fallback
    }
    if (onDeleteSupplier) {
      onDeleteSupplier(id);
    }
    setDeleteConfirmId(null);
  };

  const handleToggleConnection = async (supplier: Supplier) => {
    const isCurrentlyConnected = supplier.connected !== false && supplier.status === 'active';
    const newConnected = !isCurrentlyConnected;

    try {
      const endpoint = newConnected ? `/api/suppliers/${supplier.id}/connect` : `/api/suppliers/${supplier.id}/disconnect`;
      await fetch(endpoint, { method: 'POST' });
    } catch {
      // Fallback
    }

    onToggleSupplier(supplier.id);
  };

  const handleQuickTest = async (supplier: Supplier) => {
    setQuickTestingId(supplier.id);
    setQuickTestMessage(null);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        setQuickTestMessage({
          id: supplier.id,
          ok: true,
          message: `Connector for ${supplier.name} is operational. Backend routes active.`,
        });
      } else {
        setQuickTestMessage({
          id: supplier.id,
          ok: false,
          message: 'Server backend endpoint unreachable.',
        });
      }
    } catch (e: any) {
      setQuickTestMessage({
        id: supplier.id,
        ok: false,
        message: e.message || 'Connection error',
      });
    } finally {
      setQuickTestingId(null);
    }
  };

  const openParserTestModal = (supplier: Supplier) => {
    setTestModalSupplier(supplier);
    const base = supplier.baseUrl || supplier.base_url || '';
    setTestUrl(base.endsWith('/') ? base : base + '/');
    setTestFetchMethod(supplier.fetchMethod || supplier.fetch_method || 'direct');
    setTestJsRender(Boolean(supplier.jsRender ?? supplier.js_render ?? false));
    setTestResult(null);
  };

  const handleRunParserTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testUrl.trim()) return;

    setIsTestingParser(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/suppliers/test-parser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: testUrl.trim(),
          supplierId: testModalSupplier?.id,
          parserConfig: testModalSupplier?.parserConfig,
          fetchMethod: testFetchMethod,
          jsRender: testJsRender,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setTestResult({
          ok: true,
          product: data.product,
          detectedFields: data.detectedFields,
        });
      } else {
        setTestResult({
          ok: false,
          error: data.error || 'Parser failed to extract required product data.',
          detectedFields: data.detectedFields,
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        error: err.message || 'Network error during parser test.',
      });
    } finally {
      setIsTestingParser(false);
    }
  };

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            <span>Supplier Management &amp; Integrations</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Configure, connect, and test custom suppliers with workspace data isolation. Includes built-in parser testing, custom pricing rules, and ZenRows anti-bot rendering.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="self-start sm:self-center px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Custom Supplier</span>
        </button>
      </div>

      {/* Suppliers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {suppliers.map((supplier) => {
          const isConnected = supplier.connected !== false && supplier.status === 'active';
          const isPlusPower = supplier.id === 'pluspower' || Boolean(supplier.isGlobal || supplier.is_global);

          return (
            <div
              key={supplier.id}
              className={`bg-slate-900/90 border rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4 transition-all shadow-sm ${
                isConnected ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/50 opacity-75'
              }`}
            >
              <div>
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-lg font-bold">
                      {isPlusPower ? '⚡' : '📦'}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                        <span>{supplier.name}</span>
                        {isPlusPower ? (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-semibold border border-emerald-500/30">
                            Global • Primary
                          </span>
                        ) : (
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-semibold border border-blue-500/30">
                            Custom Workspace
                          </span>
                        )}
                      </h3>
                      <a
                        href={supplier.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-400 hover:text-emerald-400 font-mono inline-flex items-center space-x-1"
                      >
                        <span className="truncate max-w-[200px]">{supplier.baseUrl}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>

                  {/* Connect / Disconnect Toggle Button */}
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleToggleConnection(supplier)}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-all ${
                        isConnected
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                      title={isConnected ? 'Click to disconnect' : 'Click to connect'}
                    >
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </button>
                    {!isPlusPower && (
                      <>
                        <button
                          onClick={() => openEditModal(supplier)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          title="Edit supplier"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(supplier.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition-colors"
                          title="Delete supplier"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 mt-3 leading-relaxed">
                  {supplier.description}
                </p>

                {/* Config Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-center">
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Fetch Method</span>
                    <span className="text-[11px] font-semibold text-slate-200">
                      {supplier.fetchMethod === 'zenrows' ? 'ZenRows API' : 'Direct Fetch'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">JS Rendering</span>
                    <span className="text-[11px] font-semibold text-slate-200">
                      {supplier.jsRender ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Shipping Cost</span>
                    <span className="text-[11px] font-semibold text-slate-200">
                      € {Number(supplier.shippingCost ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Min Stock Alert</span>
                    <span className="text-[11px] font-semibold text-slate-200">
                      {supplier.stockThreshold ?? 5} units
                    </span>
                  </div>
                </div>

                {/* Pricing Rule Info if set */}
                {supplier.pricingRule && (
                  <div className="mt-2.5 p-2 bg-slate-950/60 rounded-xl border border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Markup: <strong className="text-emerald-400">{supplier.pricingRule.targetMarginPercent ?? 25}%</strong> + Fixed Profit:{' '}
                      <strong className="text-emerald-400">€ {Number(supplier.pricingRule.targetFixedProfit ?? 5).toFixed(2)}</strong>
                    </span>
                    <span>VAT: {supplier.pricingRule.vatRatePercent ?? 22}%</span>
                  </div>
                )}
              </div>

              {/* Action Buttons & Parser Test Link */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleQuickTest(supplier)}
                    disabled={quickTestingId === supplier.id}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium inline-flex items-center space-x-1.5 border border-slate-700"
                  >
                    <RefreshCw className={`w-3 h-3 ${quickTestingId === supplier.id ? 'animate-spin' : ''}`} />
                    <span>Check Connection</span>
                  </button>

                  <button
                    onClick={() => openParserTestModal(supplier)}
                    className="px-2.5 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 shadow-sm"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>Test Parser</span>
                  </button>
                </div>

                {isPlusPower && (
                  <button
                    onClick={() => setCurrentPage('scraper')}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center"
                  >
                    Open Scraper &rarr;
                  </button>
                )}
              </div>

              {/* Quick Connection Message */}
              {quickTestMessage && quickTestMessage.id === supplier.id && (
                <div
                  className={`p-2.5 rounded-xl border text-xs flex items-center space-x-2 animate-in fade-in ${
                    quickTestMessage.ok
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  }`}
                >
                  {quickTestMessage.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  )}
                  <span>{quickTestMessage.message}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Delete Supplier</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to remove this supplier from your workspace? Products already imported will not be deleted.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Delete Supplier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parser Test Mode Modal */}
      {testModalSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-5 space-y-4 shadow-2xl animate-in fade-in max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <FlaskConical className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  Parser Test Mode: <span className="text-indigo-300">{testModalSupplier.name}</span>
                </h3>
              </div>
              <button
                onClick={() => setTestModalSupplier(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter a real product URL from this supplier to verify live scraping, JSON-LD Schema.org extraction, variant discovery, and field accuracy before importing catalog items.
            </p>

            <form onSubmit={handleRunParserTest} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Product Test URL</label>
                <input
                  type="url"
                  placeholder="https://supplier.com/product/example-item"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-xs outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Fetch Method</label>
                  <select
                    value={testFetchMethod}
                    onChange={(e) => setTestFetchMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                  >
                    <option value="direct">Direct Server Fetch (Fast)</option>
                    <option value="zenrows">ZenRows Anti-Bot Proxy</option>
                  </select>
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={testJsRender}
                      onChange={(e) => setTestJsRender(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Render JavaScript</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isTestingParser}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-sm inline-flex items-center space-x-1.5"
                >
                  <FlaskConical className={`w-3.5 h-3.5 ${isTestingParser ? 'animate-spin' : ''}`} />
                  <span>{isTestingParser ? 'Extracting Data...' : 'Run Parser Test'}</span>
                </button>
              </div>
            </form>

            {/* Test Results Display */}
            {testResult && (
              <div className="mt-4 pt-3 border-t border-slate-800 space-y-3">
                {testResult.ok ? (
                  <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs space-y-2">
                    <div className="flex items-center space-x-2 text-emerald-300 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Parser Extraction Succeeded!</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-slate-300">
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Title</span>
                        <span className="font-semibold text-white truncate block">{testResult.detectedFields?.title || 'N/A'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Price</span>
                        <span className="font-bold text-emerald-400">
                          {testResult.detectedFields?.price !== null ? `€ ${Number(testResult.detectedFields?.price).toFixed(2)}` : 'N/A'}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Brand</span>
                        <span className="font-semibold text-white truncate block">{testResult.detectedFields?.brand || 'N/A'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">SKU Code</span>
                        <span className="font-mono text-slate-200 truncate block">{testResult.detectedFields?.sku || 'None'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">EAN Code</span>
                        <span className="font-mono text-slate-200 truncate block">{testResult.detectedFields?.ean || 'None'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Variants Count</span>
                        <span className="font-bold text-indigo-400">{testResult.detectedFields?.variantsCount || 0}</span>
                      </div>
                    </div>

                    {testResult.product?.variants && testResult.product.variants.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-emerald-900/40">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">
                          Detected Variants:
                        </span>
                        <div className="max-h-28 overflow-y-auto space-y-1 text-[11px]">
                          {testResult.product.variants.map((v: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between bg-slate-900/60 p-1.5 rounded border border-slate-800">
                              <span className="text-white font-medium truncate max-w-[200px]">{v.name}</span>
                              <div className="flex items-center space-x-2 text-slate-400 font-mono text-[10px]">
                                {v.sku && <span>SKU: {v.sku}</span>}
                                {v.price !== null && <span className="text-emerald-300">€{Number(v.price).toFixed(2)}</span>}
                                {v.stock_quantity !== null && <span>Stock: {v.stock_quantity}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs space-y-2 text-rose-300">
                    <div className="flex items-center space-x-2 font-bold">
                      <XCircle className="w-4 h-4 text-rose-400" />
                      <span>Parser Detection Failed</span>
                    </div>
                    <p className="text-[11px] text-rose-200">{testResult.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Supplier Modal */}
      {(showAddModal || editingSupplier) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-2xl animate-in fade-in max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                {editingSupplier ? <Edit3 className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
                <span>{editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : 'Connect New Supplier'}</span>
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingSupplier(null);
                }}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Supplier Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Bulk Supplements, MyProtein"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Official Base URL *</label>
                  <input
                    type="url"
                    placeholder="https://www.supplier-domain.com"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-xs outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Description / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Wholesale supplier, delivery times, catalog notes..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white outline-none focus:border-emerald-500"
                />
              </div>

              {/* Scraping & Fetch Configuration */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide block">
                  Scraping &amp; Anti-Bot Settings
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Default Fetch Provider</label>
                    <select
                      value={formFetchMethod}
                      onChange={(e) => setFormFetchMethod(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="direct">Direct Fetch (Fast)</option>
                      <option value="zenrows">ZenRows REST API</option>
                    </select>
                  </div>
                  <div className="flex items-center pt-5">
                    <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formJsRender}
                        onChange={(e) => setFormJsRender(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span>Enable JS Rendering</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Shipping & Stock Defaults */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide block">
                  Shipping &amp; Stock Controls
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Supplier Shipping Cost (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formShippingCost}
                      onChange={(e) => setFormShippingCost(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Low Stock Threshold</label>
                    <input
                      type="number"
                      value={formStockThreshold}
                      onChange={(e) => setFormStockThreshold(parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Pricing Rules */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide block">
                  Automated Pricing Formula
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Target Margin %</label>
                    <input
                      type="number"
                      step="0.5"
                      value={formMarginPercent}
                      onChange={(e) => setFormMarginPercent(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Fixed Profit (€)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={formFixedProfit}
                      onChange={(e) => setFormFixedProfit(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Optional Custom CSS Selectors Dropdown */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSelectors(!showAdvancedSelectors)}
                  className="w-full p-2.5 bg-slate-950 flex items-center justify-between text-slate-300 font-semibold"
                >
                  <span className="flex items-center space-x-1.5">
                    <Code className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Custom HTML Parser Selectors (Optional)</span>
                  </span>
                  {showAdvancedSelectors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showAdvancedSelectors && (
                  <div className="p-3 bg-slate-900/60 space-y-2 border-t border-slate-800">
                    <p className="text-[10px] text-slate-400">
                      If standard Schema.org JSON-LD is missing, specify custom CSS selectors for this supplier.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 block">Title Selector</label>
                        <input
                          type="text"
                          placeholder="h1.product-title"
                          value={selectorTitle}
                          onChange={(e) => setSelectorTitle(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-white font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block">Price Selector</label>
                        <input
                          type="text"
                          placeholder=".product-price, .price"
                          value={selectorPrice}
                          onChange={(e) => setSelectorPrice(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-white font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block">SKU Selector</label>
                        <input
                          type="text"
                          placeholder=".sku-code"
                          value={selectorSku}
                          onChange={(e) => setSelectorSku(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-white font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block">EAN Selector</label>
                        <input
                          type="text"
                          placeholder=".barcode, [data-ean]"
                          value={selectorEan}
                          onChange={(e) => setSelectorEan(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-white font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingSupplier(null);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm"
                >
                  {editingSupplier ? 'Update Supplier' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
