import React, { useState, useEffect } from 'react';
import { Product, ImportHistoryItem, ScraperSettings, EbayAccountConfig, PricingRule } from '../types.js';
import {
  Settings as SettingsIcon,
  Database,
  ShieldCheck,
  Key,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Check,
  Download,
  Upload,
  Clock,
  Trash2,
  ExternalLink,
  Smartphone,
  Eye,
  EyeOff,
  Sliders,
  Store,
  DollarSign,
  Send,
  AlertTriangle,
} from 'lucide-react';
import {
  getStoredSettings,
  saveStoredSettings,
  testSupabaseConnection,
} from '../utils/supabase.js';

interface SettingsProps {
  products: Product[];
  history: ImportHistoryItem[];
  onClearHistory: () => void;
  onRestoreProducts: (products: Product[]) => Promise<void>;
  isSupabaseConnected: boolean;
  setIsSupabaseConnected: (val: boolean) => void;
  isEbayConnected: boolean;
  setIsEbayConnected: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  products,
  history,
  onClearHistory,
  onRestoreProducts,
  isSupabaseConnected,
  setIsSupabaseConnected,
  isEbayConnected,
  setIsEbayConnected,
}) => {
  const [settings, setSettings] = useState<ScraperSettings>(getStoredSettings());
  const [showAnonKey, setShowAnonKey] = useState(false);
  const [showEbaySecret, setShowEbaySecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; count?: number } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [savedAlert, setSavedAlert] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [isExchangingCode, setIsExchangingCode] = useState(false);
  const [ebayExchangeResult, setEbayExchangeResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ZenRows Provider State
  const [zenrowsConfigured, setZenrowsConfigured] = useState(false);
  const [zenrowsTesting, setZenrowsTesting] = useState(false);
  const [zenrowsTestResult, setZenrowsTestResult] = useState<{ ok: boolean; message: string; sampleTitle?: string } | null>(null);

  // Monitoring Settings (Phase 1.4)
  const [monitoringConfig, setMonitoringConfig] = useState({
    globalIntervalMinutes: 360,
    defaultEbayQuantity: 3,
    minimumProfitEur: 3.0,
    packagingCost: 0.0,
    concurrencyLimit: 2,
    maxRetries: 3,
  });

  // Check eBay status, ZenRows status, and Monitoring settings on mount
  useEffect(() => {
    fetch('/api/ebay/status')
      .then((res) => res.json())
      .then((data) => {
        setIsEbayConnected(data.connected);
      })
      .catch(() => {});

    fetch('/api/zenrows/status')
      .then((res) => res.json())
      .then((data) => {
        setZenrowsConfigured(Boolean(data?.configured));
      })
      .catch(() => {});

    fetch('/api/monitoring/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.settings) {
          setMonitoringConfig((prev) => ({ ...prev, ...data.settings }));
        }
      })
      .catch(() => {});
  }, [setIsEbayConnected]);

  const handleTestZenRows = async () => {
    setZenrowsTesting(true);
    setZenrowsTestResult(null);
    try {
      const res = await fetch('/api/zenrows/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://httpbin.org/html' }),
      });
      const data = await res.json();
      setZenrowsTestResult(data);
      if (data.ok) {
        setZenrowsConfigured(true);
      }
    } catch (err: any) {
      setZenrowsTestResult({ ok: false, message: err.message || 'Connection test failed' });
    } finally {
      setZenrowsTesting(false);
    }
  };

  const handleSaveSettings = () => {
    saveStoredSettings(settings);
    fetch('/api/monitoring/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(monitoringConfig),
    }).catch(() => {});

    setSavedAlert(true);
    setTimeout(() => setSavedAlert(false), 2500);
    handleTestConnection();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testSupabaseConnection();
      setTestResult(res);
      setIsSupabaseConnected(res.ok);
    } finally {
      setIsTesting(false);
    }
  };

  // Generate official eBay OAuth URL
  const handleGenerateEbayAuthUrl = async () => {
    const clientId = settings.ebayConfig.clientId.trim();
    const ruName = settings.ebayConfig.ruName.trim();
    if (!clientId || !ruName) {
      alert('Please enter your eBay Client ID and RuName in the configuration fields first.');
      return;
    }

    try {
      const res = await fetch(
        `/api/ebay/auth-url?clientId=${encodeURIComponent(clientId)}&ruName=${encodeURIComponent(ruName)}&env=${settings.ebayConfig.environment}`
      );
      const data = await res.json();
      if (data.ok && data.authUrl) {
        setAuthUrl(data.authUrl);
      } else {
        alert(data.message || 'Error generating eBay authorization link');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  // Exchange auth code for tokens
  const handleExchangeEbayCode = async () => {
    if (!authCodeInput.trim()) return;
    setIsExchangingCode(true);
    setEbayExchangeResult(null);

    try {
      const res = await fetch('/api/ebay/exchange-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: authCodeInput.trim(),
          clientId: settings.ebayConfig.clientId.trim(),
          clientSecret: settings.ebayConfig.clientSecret.trim(),
          ruName: settings.ebayConfig.ruName.trim(),
          environment: settings.ebayConfig.environment,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setEbayExchangeResult({ ok: true, message: 'eBay account successfully connected!' });
        setIsEbayConnected(true);
        setSettings({
          ...settings,
          ebayConfig: { ...settings.ebayConfig, connected: true },
        });
        saveStoredSettings({
          ...settings,
          ebayConfig: { ...settings.ebayConfig, connected: true },
        });
      } else {
        setEbayExchangeResult({ ok: false, message: data.error || 'Failed to exchange authorization code' });
      }
    } catch (e: any) {
      setEbayExchangeResult({ ok: false, message: e.message || 'Network error communicating with eBay' });
    } finally {
      setIsExchangingCode(false);
    }
  };

  // Full Database JSON Backup
  const handleDownloadBackup = () => {
    const backupData = {
      version: '2.0-sinchods',
      exported_at: new Date().toISOString(),
      products_count: products.length,
      products,
      history,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sinchods_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Restore from JSON Backup
  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result as string;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.products)) {
          if (confirm(`Confirm restoring ${parsed.products.length} products from the backup file?`)) {
            await onRestoreProducts(parsed.products);
            alert(`Successfully restored ${parsed.products.length} products!`);
          }
        } else {
          alert('The selected file does not contain a valid products array.');
        }
      } catch (err: any) {
        alert(`Error reading JSON file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleCopySql = () => {
    fetch('/supabase/schema.sql')
      .then((res) => res.text())
      .then((sql) => {
        navigator.clipboard.writeText(sql);
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 2000);
      })
      .catch(() => {
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 2000);
      });
  };

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <h1 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
          <SettingsIcon className="w-5 h-5 text-emerald-400" />
          <span>SinchoDS Platform Settings</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          Configure official eBay Sell APIs (eBay.it), default pricing margins, free Supabase cloud database, and disaster recovery backups.
        </p>
      </div>

      {/* eBay Sell API & Developer Configuration */}
      <div className="bg-slate-900/80 border border-blue-900/30 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center">
              <Store className="w-4 h-4 mr-2 text-blue-400" />
              Official eBay Sell APIs Integration (eBay.it)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect your eBay Developer application to automatically publish listings and synchronize inventory on eBay Italy.
            </p>
          </div>

          <span
            className={`self-start sm:self-center text-xs font-semibold px-2.5 py-1 rounded-full border ${
              isEbayConnected
                ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                : 'bg-slate-850 text-slate-400 border-slate-700'
            }`}
          >
            {isEbayConnected ? '● eBay Account Connected' : 'Not Connected (Draft Mode Active)'}
          </span>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                eBay Client ID (App ID)
              </label>
              <input
                type="text"
                placeholder="SinchoAp-SinchoDS-PRD-..."
                value={settings.ebayConfig.clientId}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ebayConfig: { ...settings.ebayConfig, clientId: e.target.value.trim() },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-300 font-medium">eBay Client Secret (Cert ID)</label>
                <button
                  type="button"
                  onClick={() => setShowEbaySecret(!showEbaySecret)}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  {showEbaySecret ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                type={showEbaySecret ? 'text' : 'password'}
                placeholder="PRD-1234567890abcdef..."
                value={settings.ebayConfig.clientSecret}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ebayConfig: { ...settings.ebayConfig, clientSecret: e.target.value.trim() },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                RuName (eBay Redirect URL Name)
              </label>
              <input
                type="text"
                placeholder="Sincho_Official-SinchoAp-Sincho-..."
                value={settings.ebayConfig.ruName}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ebayConfig: { ...settings.ebayConfig, ruName: e.target.value.trim() },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">eBay Environment</label>
              <select
                value={settings.ebayConfig.environment}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ebayConfig: { ...settings.ebayConfig, environment: e.target.value as any },
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
              >
                <option value="PRODUCTION">Production (eBay.it Live)</option>
                <option value="SANDBOX">Sandbox (Test Environment)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleSaveSettings}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-sm"
            >
              Save eBay Credentials
            </button>
            <button
              type="button"
              onClick={handleGenerateEbayAuthUrl}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium border border-slate-700 inline-flex items-center space-x-1"
            >
              <span>Generate eBay Authorization Link</span>
              <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          {/* Authorization instructions box */}
          {authUrl && (
            <div className="p-3.5 bg-slate-950 border border-blue-900/40 rounded-xl space-y-3 animate-in fade-in">
              <div className="flex items-center space-x-2 text-blue-300 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                <span>Step 1: Sign in and authorize your app on eBay</span>
              </div>
              <p className="text-slate-300 leading-relaxed text-[11px]">
                Open the link below in a new tab, sign in with your eBay seller account, and tap <strong>I Agree</strong>:
              </p>
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold text-xs"
              >
                Open eBay.it Sign-in Page &rarr;
              </a>

              <div className="pt-2 border-t border-slate-800">
                <label className="block text-slate-300 font-semibold mb-1">
                  Step 2: Paste the authorization code returned upon redirection:
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="v^1.1#i^1#r^1#p^3#..."
                    value={authCodeInput}
                    onChange={(e) => setAuthCodeInput(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 text-white font-mono text-xs"
                  />
                  <button
                    onClick={handleExchangeEbayCode}
                    disabled={isExchangingCode || !authCodeInput.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-semibold"
                  >
                    {isExchangingCode ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </div>

              {ebayExchangeResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs ${
                    ebayExchangeResult.ok
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/60 text-rose-300 border border-rose-800'
                  }`}
                >
                  {ebayExchangeResult.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Default Pricing Rule Settings */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center">
          <DollarSign className="w-4 h-4 mr-2 text-emerald-400" />
          Default Pricing &amp; Margin Rules
        </h2>
        <p className="text-xs text-slate-400">
          These default settings initialize the pricing calculator in the Listing Builder to recommend optimal eBay.it selling prices.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Target Margin (%)</label>
            <input
              type="number"
              value={settings.defaultPricingRule.targetMarginPercent}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultPricingRule: {
                    ...settings.defaultPricingRule,
                    targetMarginPercent: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Min. Fixed Profit (€)</label>
            <input
              type="number"
              step="0.5"
              value={settings.defaultPricingRule.targetFixedProfit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultPricingRule: {
                    ...settings.defaultPricingRule,
                    targetFixedProfit: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">eBay.it Fee (%)</label>
            <input
              type="number"
              step="0.1"
              value={settings.defaultPricingRule.ebayFeePercent}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultPricingRule: {
                    ...settings.defaultPricingRule,
                    ebayFeePercent: parseFloat(e.target.value) || 11.5,
                  },
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">eBay Fixed Fee (€)</label>
            <input
              type="number"
              step="0.05"
              value={settings.defaultPricingRule.ebayFixedFee}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultPricingRule: {
                    ...settings.defaultPricingRule,
                    ebayFixedFee: parseFloat(e.target.value) || 0.35,
                  },
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700"
        >
          Save Pricing Rules
        </button>
      </div>

      {/* Automatic Price & Stock Monitoring Configuration (Phase 1.4) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center">
              <Clock className="w-4 h-4 mr-2 text-blue-400" />
              Automatic Price &amp; Stock Monitoring Engine
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configures persistent background scrape jobs that verify supplier prices and stock every 6 hours independently of browser sessions.
            </p>
          </div>
          <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-semibold">
            6h Scheduled Cycle Active
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">Monitoring Interval</label>
            <select
              value={monitoringConfig.globalIntervalMinutes}
              onChange={(e) =>
                setMonitoringConfig({
                  ...monitoringConfig,
                  globalIntervalMinutes: parseInt(e.target.value) || 360,
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none"
            >
              <option value="120">Every 2 Hours (120m)</option>
              <option value="240">Every 4 Hours (240m)</option>
              <option value="360">Every 6 Hours (360m - Default)</option>
              <option value="720">Every 12 Hours (720m)</option>
              <option value="1440">Every 24 Hours (Daily)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Default eBay Quantity</label>
            <select
              value={monitoringConfig.defaultEbayQuantity}
              onChange={(e) =>
                setMonitoringConfig({
                  ...monitoringConfig,
                  defaultEbayQuantity: parseInt(e.target.value) === 5 ? 5 : 3,
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white outline-none"
            >
              <option value="3">3 Units (Conservative dropship default)</option>
              <option value="5">5 Units (Higher volume buffer)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Min. Dropship Profit (€)</label>
            <input
              type="number"
              step="0.5"
              value={monitoringConfig.minimumProfitEur}
              onChange={(e) =>
                setMonitoringConfig({
                  ...monitoringConfig,
                  minimumProfitEur: parseFloat(e.target.value) || 3.0,
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Packaging Cost (€)</label>
            <input
              type="number"
              step="0.25"
              value={monitoringConfig.packagingCost}
              onChange={(e) =>
                setMonitoringConfig({
                  ...monitoringConfig,
                  packagingCost: parseFloat(e.target.value) || 0.0,
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
            />
          </div>
        </div>

        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 text-[11px] leading-relaxed">
          <span className="font-semibold text-slate-300 block mb-0.5">Automated Rules &amp; Recovery:</span>
          When supplier stock reaches 0, the eBay listing available quantity is set to 0 without ending the listing. When supplier stock returns, available quantity is restored to the configured fixed quantity ({monitoringConfig.defaultEbayQuantity} units). Supplier price increases only recalculate listings if the €{monitoringConfig.minimumProfitEur.toFixed(2)} profit threshold is preserved.
        </div>

        <button
          onClick={handleSaveSettings}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-sm inline-flex items-center space-x-1.5"
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Save Monitoring Settings</span>
        </button>
      </div>

      {/* Supabase Free Tier Configuration */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center">
            <Key className="w-4 h-4 mr-2 text-emerald-400" />
            Supabase PostgreSQL Database (Free Tier)
          </h2>
          <span className="text-[10px] text-slate-400">
            {isSupabaseConnected ? 'Connected' : 'Local Storage Mode'}
          </span>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Project URL</label>
            <input
              type="text"
              placeholder="https://your-project.supabase.co"
              value={settings.supabaseUrl}
              onChange={(e) => setSettings({ ...settings, supabaseUrl: e.target.value.trim() })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-medium">Anon Public Key</label>
              <button
                type="button"
                onClick={() => setShowAnonKey(!showAnonKey)}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                {showAnonKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showAnonKey ? 'text' : 'password'}
              placeholder="eyJhbGciOiJIUzI1Ni..."
              value={settings.supabaseAnonKey}
              onChange={(e) => setSettings({ ...settings, supabaseAnonKey: e.target.value.trim() })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleSaveSettings}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold shadow-sm"
            >
              Save Credentials
            </button>
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium border border-slate-700"
            >
              {isTesting ? 'Testing connection...' : 'Test Connection'}
            </button>
            <button
              onClick={handleCopySql}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium border border-slate-700 inline-flex items-center space-x-1"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'Copied!' : 'Copy SinchoDS SQL Schema'}</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                testResult.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* ZenRows REST API Provider Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center">
              <ShieldCheck className="w-4 h-4 mr-2 text-emerald-400" />
              ZenRows REST API Provider
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Centralized, supplier-independent HTML extraction engine (<code>https://api.zenrows.com/v1/</code>).
            </p>
          </div>
          <span
            className={`self-start sm:self-center text-xs font-semibold px-2.5 py-1 rounded-full border ${
              zenrowsConfigured
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
            }`}
          >
            {zenrowsConfigured ? '● Server Key Configured' : '○ Key Missing (ZENROWS_API_KEY)'}
          </span>
        </div>

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 space-y-1.5 leading-relaxed text-[11px]">
            <p>
              <strong>Security &amp; Architecture:</strong> The API key is stored strictly on the server in the{' '}
              <code className="text-emerald-400">ZENROWS_API_KEY</code> environment variable and is never sent to the client browser.
            </p>
            <p>
              <strong>Credit Conservation:</strong> JavaScript rendering is disabled by default (<code>js_render=false</code>). Enable it in the Scraper only when dynamic JS execution is required.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestZenRows}
              disabled={zenrowsTesting}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-semibold shadow-sm inline-flex items-center space-x-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${zenrowsTesting ? 'animate-spin' : ''}`} />
              <span>{zenrowsTesting ? 'Testing ZenRows API...' : 'Test ZenRows API (Public URL)'}</span>
            </button>
          </div>

          {zenrowsTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start space-x-2 ${
                zenrowsTestResult.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {zenrowsTestResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <p className="font-medium">{zenrowsTestResult.message}</p>
                {zenrowsTestResult.sampleTitle && (
                  <p className="text-[11px] opacity-80">Sample title retrieved: &ldquo;{zenrowsTestResult.sampleTitle}&rdquo;</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* JSON Backup & Disaster Recovery */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center">
          <Download className="w-4 h-4 mr-2 text-blue-400" />
          Full JSON Backup &amp; Disaster Recovery
        </h2>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={handleDownloadBackup}
            disabled={products.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download JSON Backup ({products.length} products)</span>
          </button>

          <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium inline-flex items-center space-x-1.5 border border-slate-700 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Restore from JSON Backup</span>
            <input type="file" accept=".json" onChange={handleRestoreBackup} className="hidden" />
          </label>
        </div>
      </div>
    </div>
  );
};
