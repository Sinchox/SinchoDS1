import React, { useState, useRef, useEffect } from 'react';
import { Product, ScrapingJobItem } from '../types.js';
import { PageId } from './Navbar.js';
import {
  Globe,
  Play,
  Pause,
  Square,
  RefreshCw,
  FileCode,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sliders,
  Plus,
  Trash2,
  ListFilter,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { isValidProductUrl, normalizeProductUrl, CLOUDFLARE_ERROR_MESSAGE } from '../utils/parser.js';

interface ScraperProps {
  onSaveProduct: (product: Product) => Promise<{ ok: boolean; product: Product }>;
  setCurrentPage: (page: PageId) => void;
  onSetHtmlImportTargetUrl: (url: string) => void;
  existingProductUrls: Set<string>;
  defaultDelay: number;
  defaultBatchSize: number;
}

export const Scraper: React.FC<ScraperProps> = ({
  onSaveProduct,
  setCurrentPage,
  onSetHtmlImportTargetUrl,
  existingProductUrls,
  defaultDelay,
  defaultBatchSize,
}) => {
  // Input URLs state
  const [urlInput, setUrlInput] = useState('');
  const [urlQueue, setUrlQueue] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(defaultBatchSize);
  const [delaySeconds, setDelaySeconds] = useState<number>(defaultDelay);

  // ZenRows Fetching Provider State
  const [fetchProvider, setFetchProvider] = useState<'direct' | 'zenrows'>('direct');
  const [zenrowsConfigured, setZenrowsConfigured] = useState(false);
  const [zenrowsJsRender, setZenrowsJsRender] = useState(false);

  // Single URL direct import state
  const [isSingleImporting, setIsSingleImporting] = useState(false);
  const [singleImportMessage, setSingleImportMessage] = useState<{
    ok: boolean;
    message: string;
    isDuplicate?: boolean;
  } | null>(null);

  // Background import jobs state
  const [activeBackgroundJob, setActiveBackgroundJob] = useState<any | null>(null);
  const [isStartingJob, setIsStartingJob] = useState(false);

  useEffect(() => {
    fetch('/api/zenrows/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.configured) {
          setZenrowsConfigured(true);
        }
      })
      .catch(() => {});
  }, []);

  // Poll background job if active
  useEffect(() => {
    if (!activeBackgroundJob || activeBackgroundJob.status === 'completed' || activeBackgroundJob.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/imports/jobs/${activeBackgroundJob.id}`);
        const data = await res.json();
        if (data.ok && data.job) {
          setActiveBackgroundJob(data.job);
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeBackgroundJob]);

  // Sitemap discovery state
  const [sitemapUrl, setSitemapUrl] = useState('https://www.pluspowersupplements.com/sitemap.xml');
  const [sitemapProvider, setSitemapProvider] = useState<'auto' | 'zenrows' | 'direct'>('auto');
  const [isDiscoveringSitemap, setIsDiscoveringSitemap] = useState(false);
  const [sitemapDiscoveryMessage, setSitemapDiscoveryMessage] = useState<string | null>(null);
  const [sitemapErrorType, setSitemapErrorType] = useState<string | null>(null);
  const [discoveredProducts, setDiscoveredProducts] = useState<string[]>([]);
  const [selectedDiscoveredUrls, setSelectedDiscoveredUrls] = useState<Set<string>>(new Set());
  const [sitemapMeta, setSitemapMeta] = useState<{
    isIndex?: boolean;
    childSitemapsFound?: number;
    childSitemapsProcessed?: number;
    providerUsed?: string;
  } | null>(null);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jobItems, setJobItems] = useState<ScrapingJobItem[]>([]);

  // Ref to cancel/pause loop
  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);

  // Discovery Categories
  const categories = [
    { name: 'Proteine', path: 'https://www.pluspowersupplements.com/proteine' },
    { name: 'Aminoacidi', path: 'https://www.pluspowersupplements.com/aminoacidi' },
    { name: 'Creatina', path: 'https://www.pluspowersupplements.com/creatina' },
    { name: 'Vitamine e Minerali', path: 'https://www.pluspowersupplements.com/vitamine-e-minerali' },
    { name: 'Barrette Proteiche', path: 'https://www.pluspowersupplements.com/barrette-proteiche' },
  ];

  // Add URLs to queue
  const handleAddUrls = (raw: string) => {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const validNewUrls: string[] = [];
    let invalidCount = 0;
    let duplicateCount = 0;

    for (const line of lines) {
      const isPP = isValidProductUrl(line);
      let isValidGeneric = false;
      try {
        const u = new URL(line);
        isValidGeneric = (u.protocol === 'http:' || u.protocol === 'https:') && u.pathname.length > 1;
      } catch {
        isValidGeneric = false;
      }

      if (!isPP && !isValidGeneric) {
        invalidCount++;
        continue;
      }
      const norm = normalizeProductUrl(line);
      if (urlQueue.includes(norm)) {
        duplicateCount++;
        continue;
      }
      validNewUrls.push(norm);
    }

    if (validNewUrls.length > 0) {
      setUrlQueue((prev) => [...prev, ...validNewUrls]);
      setUrlInput('');
    }
  };

  const handleSingleUrlImport = async () => {
    const firstLine = urlInput.trim().split('\n')[0]?.trim();
    if (!firstLine) return;

    setIsSingleImporting(true);
    setSingleImportMessage(null);

    try {
      const res = await fetch('/api/products/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: firstLine,
          fetchMethod: fetchProvider,
          jsRender: fetchProvider === 'zenrows' ? zenrowsJsRender : false,
        }),
      });

      const data = await res.json();
      if (data.ok && data.product) {
        data.product.status = 'draft';
        await onSaveProduct(data.product);
        setSingleImportMessage({
          ok: true,
          message: `Success: Imported "${data.product.title}" (${data.product.variants?.length || 0} variants) as Draft.`,
        });
        setUrlInput('');
      } else if (data.isDuplicate) {
        setSingleImportMessage({
          ok: false,
          isDuplicate: true,
          message: data.error || 'Duplicate: Already imported in this workspace.',
        });
      } else {
        setSingleImportMessage({
          ok: false,
          message: data.error || 'Import failed.',
        });
      }
    } catch (err: any) {
      setSingleImportMessage({
        ok: false,
        message: err.message || 'Network error during import',
      });
    } finally {
      setIsSingleImporting(false);
    }
  };

  const handleStartBackgroundJob = async () => {
    if (urlQueue.length === 0) return;
    setIsStartingJob(true);
    try {
      const res = await fetch('/api/imports/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urlQueue,
          fetchMethod: fetchProvider,
          jsRender: fetchProvider === 'zenrows' ? zenrowsJsRender : false,
        }),
      });
      const data = await res.json();
      if (data.ok && data.job) {
        setActiveBackgroundJob(data.job);
        setUrlQueue([]);
      }
    } catch (err) {
      console.error('Error starting background job:', err);
    } finally {
      setIsStartingJob(false);
    }
  };

  // Discover URLs from sitemap
  const handleDiscoverSitemap = async () => {
    setIsDiscoveringSitemap(true);
    setSitemapDiscoveryMessage(null);
    setSitemapErrorType(null);
    setDiscoveredProducts([]);
    setSelectedDiscoveredUrls(new Set());
    setSitemapMeta(null);

    try {
      const providerParam =
        sitemapProvider === 'auto'
          ? (zenrowsConfigured ? 'zenrows' : 'direct')
          : sitemapProvider;

      const res = await fetch(
        `/api/sitemap?url=${encodeURIComponent(sitemapUrl)}&provider=${providerParam}`
      );
      const data = await res.json();

      if (!data.ok) {
        setSitemapErrorType(
          data.errorType || (data.blocked ? 'CLOUDFLARE_CHALLENGE' : 'FETCH_FAILED')
        );
        setSitemapDiscoveryMessage(
          data.message || 'Sitemap scan failed.'
        );
        return;
      }

      const products: string[] = Array.isArray(data.products)
        ? data.products
        : Array.isArray(data.urls)
        ? data.urls
        : [];

      setDiscoveredProducts(products);
      setSelectedDiscoveredUrls(new Set(products));
      setSitemapMeta({
        isIndex: data.isIndex,
        childSitemapsFound: data.childSitemapsFound,
        childSitemapsProcessed: data.childSitemapsProcessed,
        providerUsed: data.providerUsed,
      });

      const providerLabel = data.providerUsed === 'zenrows' ? 'ZenRows REST API' : 'Direct Fetch';
      const indexInfo = data.isIndex
        ? ` (Processed ${data.childSitemapsProcessed} of ${data.childSitemapsFound} child sitemaps)`
        : '';
      setSitemapDiscoveryMessage(
        `Discovered ${products.length} product URLs via ${providerLabel}${indexInfo}. Select products to add to your scraping queue below.`
      );
    } catch (err: any) {
      setSitemapErrorType('FETCH_FAILED');
      setSitemapDiscoveryMessage(`Failed to read sitemap: ${err.message || 'Network error'}`);
    } finally {
      setIsDiscoveringSitemap(false);
    }
  };

  const handleToggleProductSelection = (url: string) => {
    setSelectedDiscoveredUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const handleSelectAllDiscovered = () => {
    setSelectedDiscoveredUrls(new Set(discoveredProducts));
  };

  const handleDeselectAllDiscovered = () => {
    setSelectedDiscoveredUrls(new Set());
  };

  const handleAddSelectedToQueue = () => {
    const toAdd = Array.from(selectedDiscoveredUrls).filter((u) => !urlQueue.includes(u));
    if (toAdd.length === 0) return;
    setUrlQueue((prev) => [...prev, ...toAdd]);
    setDiscoveredProducts((prev) => prev.filter((u) => !selectedDiscoveredUrls.has(u)));
    setSelectedDiscoveredUrls(new Set());
  };

  const handleDismissDiscovered = () => {
    setDiscoveredProducts([]);
    setSelectedDiscoveredUrls(new Set());
    setSitemapDiscoveryMessage(null);
    setSitemapErrorType(null);
  };

  // Clear queue
  const handleClearQueue = () => {
    if (isRunning) return;
    setUrlQueue([]);
    setJobItems([]);
    setCurrentIndex(0);
  };

  // Scraper execution engine
  const startScraping = async () => {
    if (urlQueue.length === 0 || isRunning) return;

    setIsRunning(true);
    setIsPaused(false);
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;

    // Initialize job items if fresh run
    let currentJobs = [...jobItems];
    if (currentJobs.length === 0 || currentIndex >= urlQueue.length) {
      currentJobs = urlQueue.map((url) => ({
        url,
        status: 'pending',
      }));
      setJobItems(currentJobs);
      setCurrentIndex(0);
    }

    let idx = currentIndex;

    while (idx < urlQueue.length) {
      if (stopRequestedRef.current) {
        break;
      }

      if (pauseRequestedRef.current) {
        setIsPaused(true);
        break;
      }

      const url = urlQueue[idx];

      // Mark processing
      currentJobs[idx] = { ...currentJobs[idx], status: 'processing' };
      setJobItems([...currentJobs]);
      setCurrentIndex(idx + 1);

      try {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            provider: fetchProvider,
            jsRender: fetchProvider === 'zenrows' ? zenrowsJsRender : false,
          }),
        });

        const data = await res.json();

        if (data.blocked) {
          // Cloudflare protection detected: display exact required message
          currentJobs[idx] = {
            url,
            status: 'blocked',
            error: data.message || CLOUDFLARE_ERROR_MESSAGE,
          };
        } else if (data.ok && data.product) {
          // Save to database
          await onSaveProduct(data.product);
          currentJobs[idx] = {
            url,
            status: 'success',
            product: data.product,
          };
        } else {
          currentJobs[idx] = {
            url,
            status: 'failed',
            error: data.message || data.error || 'Product extraction failed.',
          };
        }
      } catch (err: any) {
        currentJobs[idx] = {
          url,
          status: 'failed',
          error: err.message || 'Error occurred during HTTP request',
        };
      }

      setJobItems([...currentJobs]);
      idx++;

      // Delay between requests
      if (idx < urlQueue.length && !stopRequestedRef.current && !pauseRequestedRef.current) {
        await new Promise((r) => setTimeout(r, Math.max(2, delaySeconds) * 1000));
      }
    }

    setIsRunning(false);
  };

  const handlePause = () => {
    pauseRequestedRef.current = true;
    setIsPaused(true);
  };

  const handleResume = () => {
    pauseRequestedRef.current = false;
    setIsPaused(false);
    startScraping();
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    setIsRunning(false);
    setIsPaused(false);
  };

  // Send blocked URL directly to HTML import with original URL preserved
  const handleSendToHtmlImport = (url: string) => {
    onSetHtmlImportTargetUrl(url);
    setCurrentPage('html-import');
  };

  // Retry failed requests
  const handleRetryFailed = () => {
    const failedIndices: number[] = [];
    jobItems.forEach((item, index) => {
      if (item.status === 'failed' || item.status === 'blocked') {
        failedIndices.push(index);
      }
    });

    if (failedIndices.length === 0) return;

    const updatedJobs = [...jobItems];
    failedIndices.forEach((i) => {
      updatedJobs[i].status = 'pending';
      updatedJobs[i].error = undefined;
    });

    setJobItems(updatedJobs);
    setCurrentIndex(failedIndices[0]);
    startScraping();
  };

  // Counts
  const successCount = jobItems.filter((j) => j.status === 'success').length;
  const blockedCount = jobItems.filter((j) => j.status === 'blocked').length;
  const failedCount = jobItems.filter((j) => j.status === 'failed').length;
  const progressPercent = urlQueue.length > 0 ? Math.round((currentIndex / urlQueue.length) * 100) : 0;

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <h1 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
          <Globe className="w-5 h-5 text-emerald-400" />
          <span>Scraper &amp; Discovery Manager</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          Extract products from single URLs, bulk batches, or sitemaps. Automatically detects Cloudflare protections without bypass attempts.
        </p>
      </div>

      {/* URL Ingestion & Sitemap Discovery Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* URL Input Box */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">
              Enter or Paste PlusPower Product URLs
            </label>
            <span className="text-[11px] text-slate-500">One URL per line</span>
          </div>

          <textarea
            rows={4}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://www.pluspowersupplements.com/100-hydro-isolate-2kg&#10;https://www.pluspowersupplements.com/bcaa-8-1-1-300-cpr"
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 outline-none font-mono"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleAddUrls(urlInput)}
                disabled={!urlInput.trim() || isRunning}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Queue</span>
              </button>

              <button
                onClick={handleSingleUrlImport}
                disabled={!urlInput.trim() || isSingleImporting}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 transition-all shadow-sm"
                title="Imports first URL immediately into catalogue as Draft"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSingleImporting ? 'animate-spin' : ''}`} />
                <span>{isSingleImporting ? 'Importing Draft...' : 'Import URL Direct as Draft'}</span>
              </button>
            </div>

            {urlQueue.length > 0 && !isRunning && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleStartBackgroundJob}
                  disabled={isStartingJob}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1 shadow-sm"
                  title="Executes in server background without waiting for browser"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Start Background Job ({urlQueue.length})</span>
                </button>

                <button
                  onClick={handleClearQueue}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-medium inline-flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Queue ({urlQueue.length})</span>
                </button>
              </div>
            )}
          </div>

          {/* Single Import Message Feedback */}
          {singleImportMessage && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center space-x-2 animate-in fade-in ${
                singleImportMessage.ok
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : singleImportMessage.isDuplicate
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {singleImportMessage.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : singleImportMessage.isDuplicate ? (
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              )}
              <span>{singleImportMessage.message}</span>
            </div>
          )}

          {/* Active Background Job Tracker */}
          {activeBackgroundJob && (
            <div className="p-3 bg-purple-950/30 border border-purple-800/50 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-300 flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <span>Background Import Job: {activeBackgroundJob.id}</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-purple-800/60 text-purple-200 font-semibold text-[10px] uppercase">
                  {activeBackgroundJob.status}
                </span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-purple-500 h-2 transition-all duration-300"
                  style={{
                    width: `${
                      activeBackgroundJob.total > 0
                        ? Math.round((activeBackgroundJob.completed / activeBackgroundJob.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Progress: {activeBackgroundJob.completed} / {activeBackgroundJob.total}</span>
                <div className="flex items-center space-x-3">
                  <span className="text-emerald-400 font-semibold">✓ {activeBackgroundJob.successful} success</span>
                  <span className="text-amber-400 font-semibold">⚠ {activeBackgroundJob.duplicates} duplicate</span>
                  <span className="text-rose-400 font-semibold">✗ {activeBackgroundJob.failed} failed</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Discovery & Sitemap Panel */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center">
                <ListFilter className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                Public Sitemap &amp; Categories
              </h3>
              <span className="text-[10px] text-slate-500">Auto, ZenRows or Direct</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Scan the public XML sitemap to discover product links automatically.
            </p>

            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={sitemapUrl}
                onChange={(e) => setSitemapUrl(e.target.value)}
                placeholder="https://www.pluspowersupplements.com/sitemap.xml"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none font-mono"
              />

              {/* Provider selector for sitemap scan */}
              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="text-slate-400">Scan Engine:</span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => setSitemapProvider('auto')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      sitemapProvider === 'auto'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Auto ({zenrowsConfigured ? 'ZenRows' : 'Direct'})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSitemapProvider('zenrows')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors inline-flex items-center space-x-1 ${
                      sitemapProvider === 'zenrows'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>ZenRows</span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        zenrowsConfigured ? 'bg-emerald-300' : 'bg-amber-400'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSitemapProvider('direct')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      sitemapProvider === 'direct'
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Direct
                  </button>
                </div>
              </div>

              <button
                onClick={handleDiscoverSitemap}
                disabled={isDiscoveringSitemap || isRunning}
                className="w-full py-2 bg-blue-600/90 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center space-x-1.5 transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringSitemap ? 'animate-spin' : ''}`} />
                <span>{isDiscoveringSitemap ? 'Scanning sitemap...' : 'Scan Sitemap'}</span>
              </button>
            </div>

            {/* Error or status feedback */}
            {sitemapDiscoveryMessage && (
              <div
                className={`mt-2.5 p-2.5 rounded-xl border text-[11px] leading-relaxed ${
                  sitemapErrorType === 'CLOUDFLARE_CHALLENGE'
                    ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                    : sitemapErrorType === 'ZENROWS_KEY_MISSING'
                    ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                    : sitemapErrorType
                    ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                    : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                }`}
              >
                <div className="flex items-start space-x-2">
                  {sitemapErrorType === 'CLOUDFLARE_CHALLENGE' ? (
                    <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  ) : sitemapErrorType ? (
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 flex-1">
                    <p>{sitemapDiscoveryMessage}</p>
                    {sitemapErrorType === 'CLOUDFLARE_CHALLENGE' && (
                      <div className="flex items-center space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSendToHtmlImport(sitemapUrl)}
                          className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-semibold"
                        >
                          Use HTML Import &rarr;
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrentPage('settings')}
                          className="text-[10px] text-amber-300 underline"
                        >
                          View ZenRows Settings
                        </button>
                      </div>
                    )}
                    {sitemapErrorType === 'ZENROWS_KEY_MISSING' && (
                      <p className="text-[10px] opacity-80">
                        Add <code>ZENROWS_API_KEY</code> to server environment variables or select Direct Fetch.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Known Categories */}
          <div className="pt-2 border-t border-slate-800">
            <span className="text-[10px] text-slate-400 block mb-1 font-medium">Primary Supplier Categories:</span>
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <a
                  key={c.name}
                  href={c.path}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center space-x-1"
                >
                  <span>{c.name}</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Discovered Products Selection & Preview Panel */}
      {discoveredProducts.length > 0 && (
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-3 shadow-lg animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Discovered Sitemap Products ({discoveredProducts.length})</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Select the products you want to import. Discovered via{' '}
                <span className="text-emerald-400 font-medium">
                  {sitemapMeta?.providerUsed === 'zenrows' ? 'ZenRows REST API' : 'Direct Fetch'}
                </span>
                {sitemapMeta?.isIndex ? ` (${sitemapMeta.childSitemapsProcessed} child sitemaps scanned)` : ''}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllDiscovered}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAllDiscovered}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
              >
                Deselect All
              </button>
              <button
                type="button"
                onClick={handleAddSelectedToQueue}
                disabled={selectedDiscoveredUrls.size === 0}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Selected ({selectedDiscoveredUrls.size}) to Queue</span>
              </button>
              <button
                type="button"
                onClick={handleDismissDiscovered}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs"
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Discovered URLs preview scrollable list */}
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 border border-slate-800/80 rounded-xl p-2 bg-slate-950/60 divide-y divide-slate-800/50">
            {discoveredProducts.map((url) => {
              const isSelected = selectedDiscoveredUrls.has(url);
              const inQueue = urlQueue.includes(url);
              const inDb = existingProductUrls.has(url);
              const slug = url.split('/').filter(Boolean).pop() || url;

              return (
                <div
                  key={url}
                  onClick={() => handleToggleProductSelection(url)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                    isSelected ? 'bg-emerald-950/30 text-white' : 'hover:bg-slate-900 text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1 pr-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}} // handled by parent container onClick
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                    />
                    <div className="truncate">
                      <span className="font-medium text-slate-200 block truncate">{slug}</span>
                      <span className="text-[10px] text-slate-500 truncate block font-mono">{url}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    {inQueue && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-900/50 text-blue-300 border border-blue-700/50">
                        In Queue
                      </span>
                    )}
                    {inDb && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">
                        Imported
                      </span>
                    )}
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded"
                      title="Open URL in new tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scraper Configuration & Controls */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-semibold text-slate-300 flex items-center">
              <Sliders className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              Execution Parameters
            </span>
            <span className="text-[11px] text-slate-500">
              {urlQueue.length} {urlQueue.length === 1 ? 'URL in queue' : 'URLs in queue'}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-2">
            {!isRunning ? (
              <button
                onClick={startScraping}
                disabled={urlQueue.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start Scraper</span>
              </button>
            ) : isPaused ? (
              <button
                onClick={handleResume}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
            )}

            {isRunning && (
              <button
                onClick={handleStop}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            )}

            {(failedCount > 0 || blockedCount > 0) && !isRunning && (
              <button
                onClick={handleRetryFailed}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium inline-flex items-center space-x-1 border border-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Failed</span>
              </button>
            )}
          </div>
        </div>

        {/* Sliders: Batch size & Delay */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800 text-xs">
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Batch Size: {batchSize} requests</span>
              <span className="text-[10px] text-slate-500">Max 10 (recommended: 5)</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={batchSize}
              disabled={isRunning}
              onChange={(e) => setBatchSize(parseInt(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Delay between requests: {delaySeconds} seconds</span>
              <span className="text-[10px] text-slate-500">Min 2s for responsible scraping</span>
            </div>
            <input
              type="range"
              min={2}
              max={10}
              value={delaySeconds}
              disabled={isRunning}
              onChange={(e) => setDelaySeconds(parseInt(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>
        </div>

        {/* Fetching Provider Selector */}
        <div className="pt-3 border-t border-slate-800 text-xs space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-slate-300">Fetching Provider:</span>
              <span className="text-[11px] text-slate-500 ml-2">Choose between native server fetch or ZenRows REST API</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setFetchProvider('direct')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  fetchProvider === 'direct'
                    ? 'bg-slate-700 text-white border border-slate-600'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Direct Fetch (Standard)
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setFetchProvider('zenrows')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all inline-flex items-center space-x-1.5 ${
                  fetchProvider === 'zenrows'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <span>ZenRows REST API</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    zenrowsConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  title={zenrowsConfigured ? 'ZENROWS_API_KEY Configured' : 'ZENROWS_API_KEY missing in backend env'}
                />
              </button>
            </div>
          </div>

          {fetchProvider === 'zenrows' && (
            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
              <div className="text-slate-400">
                <span className="text-emerald-400 font-medium">ZenRows API:</span>{' '}
                {zenrowsConfigured
                  ? 'Server key detected.'
                  : 'Key not set in server env (configure ZENROWS_API_KEY in server environment).'}
                <span className="text-slate-500 block sm:inline sm:ml-1">
                  Credit conservation: js_render is disabled by default.
                </span>
              </div>
              <label className="inline-flex items-center space-x-2 cursor-pointer text-slate-300 hover:text-white select-none">
                <input
                  type="checkbox"
                  checked={zenrowsJsRender}
                  onChange={(e) => setZenrowsJsRender(e.target.checked)}
                  disabled={isRunning}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0"
                />
                <span>Enable JavaScript Rendering (js_render)</span>
              </label>
            </div>
          )}
        </div>

        {/* Progress Bar & Status Counters */}
        {urlQueue.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">
                Progress: {currentIndex} of {urlQueue.length} completed ({progressPercent}%)
              </span>
              <div className="flex items-center space-x-2 text-[11px]">
                <span className="text-emerald-400 font-semibold">{successCount} OK</span>
                <span className="text-amber-400 font-semibold">{blockedCount} Blocked</span>
                <span className="text-rose-400 font-semibold">{failedCount} Failed</span>
              </div>
            </div>

            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
              <div
                className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Execution Results List */}
      {jobItems.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Real-Time Request Status
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {jobItems.map((job, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    {job.status === 'pending' && (
                      <span className="w-2 h-2 rounded-full bg-slate-500 flex-shrink-0" />
                    )}
                    {job.status === 'processing' && (
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
                    )}
                    {job.status === 'success' && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    )}
                    {job.status === 'blocked' && (
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                    {job.status === 'failed' && (
                      <XCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    )}

                    <span className="font-mono text-slate-200 truncate">{job.url}</span>
                  </div>

                  {job.product && (
                    <div className="text-[11px] text-emerald-400 mt-0.5 ml-5">
                      ✓ Extracted: <strong>{job.product.title}</strong> (€ {job.product.price}) &mdash;{' '}
                      {job.product.variants.length} variant(s)
                    </div>
                  )}

                  {job.error && (
                    <div className="text-[11px] text-amber-300/90 mt-0.5 ml-5">{job.error}</div>
                  )}
                </div>

                {/* Direct Action for Blocked URL */}
                {job.status === 'blocked' && (
                  <div className="flex-shrink-0 pt-1 sm:pt-0">
                    <button
                      onClick={() => handleSendToHtmlImport(job.url)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-medium inline-flex items-center space-x-1 transition-colors"
                    >
                      <FileCode className="w-3 h-3" />
                      <span>Use HTML Import</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
