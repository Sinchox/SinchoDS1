import React, { useState, useEffect } from 'react';
import { Product, ProductVariant } from '../types.js';
import { PageId } from './Navbar.js';
import {
  FileCode,
  Upload,
  Clipboard,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Save,
  Trash2,
  ExternalLink,
  HelpCircle,
  Sparkles,
  Info,
  Barcode,
  ArrowRight,
  Eye,
} from 'lucide-react';
import { isCloudflareChallenge, parseProductWithSupplierFallback, CLOUDFLARE_ERROR_MESSAGE } from '../utils/parser.js';

interface HtmlImportProps {
  onSaveProduct: (product: Product) => Promise<{ ok: boolean; product: Product }>;
  setCurrentPage: (page: PageId) => void;
  presetTargetUrl?: string;
  onClearPresetTargetUrl?: () => void;
}

export const HtmlImport: React.FC<HtmlImportProps> = ({
  onSaveProduct,
  setCurrentPage,
  presetTargetUrl,
  onClearPresetTargetUrl,
}) => {
  const [productUrl, setProductUrl] = useState(presetTargetUrl || '');
  const [htmlSource, setHtmlSource] = useState('');
  const [parsedProduct, setParsedProduct] = useState<Product | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCloudflareError, setIsCloudflareError] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showIphoneHelp, setShowIphoneHelp] = useState(false);

  useEffect(() => {
    if (presetTargetUrl) {
      setProductUrl(presetTargetUrl);
      if (onClearPresetTargetUrl) onClearPresetTargetUrl();
    }
  }, [presetTargetUrl]);

  // Handle paste from clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setHtmlSource(text);
        setErrorMessage(null);
        setIsCloudflareError(false);
      }
    } catch {
      alert('Clipboard permission not granted or unsupported in this browser. Please tap and hold inside the text area to paste manually.');
    }
  };

  // Handle file upload (.html, .htm, .txt)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setHtmlSource(content);
        setErrorMessage(null);
        setIsCloudflareError(false);
      }
    };
    reader.readAsText(file);
  };

  // Parse HTML
  const handleParse = () => {
    setErrorMessage(null);
    setIsCloudflareError(false);
    setSaveSuccess(false);

    if (!htmlSource.trim()) {
      setErrorMessage('Please paste HTML source code or upload a file before parsing.');
      return;
    }

    setIsParsing(true);

    try {
      // 1. Detect Cloudflare Challenge first
      if (isCloudflareChallenge(htmlSource)) {
        setIsCloudflareError(true);
        setErrorMessage(
          'Cloudflare protection detected. Automatic extraction is unavailable for this page. Please use HTML Import to import the product information manually.'
        );
        setIsParsing(false);
        return;
      }

      const url = productUrl.trim() || 'https://www.pluspowersupplements.com/product';
      const extracted = parseProductWithSupplierFallback(htmlSource, url, undefined, undefined, 'html_import');
      extracted.status = 'draft';
      extracted.ebay_status = 'not_listed';

      setParsedProduct(extracted);
    } catch (err: any) {
      if (err.message && (err.message.includes('CLOUDFLARE') || err.message.includes('Cloudflare'))) {
        setIsCloudflareError(true);
        setErrorMessage(
          'Cloudflare protection detected. The provided HTML code is a Cloudflare verification page. Follow the guide to copy the source of the resolved product page.'
        );
      } else {
        setErrorMessage(`Error parsing HTML: ${err.message || 'Unrecognized HTML structure'}`);
      }
    } finally {
      setIsParsing(false);
    }
  };

  // Save product to database
  const handleSave = async () => {
    if (!parsedProduct) return;
    setIsSaving(true);
    try {
      const res = await onSaveProduct(parsedProduct);
      if (res.ok) {
        setSaveSuccess(true);
      } else {
        alert('Error saving product to database.');
      }
    } catch (err: any) {
      alert(`Error: ${err.message || 'Failed to save product'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Missing fields warnings
  const warnings: string[] = [];
  if (parsedProduct) {
    if (!parsedProduct.sku) warnings.push('SKU not detected in source code (stored as null)');
    if (!parsedProduct.ean) warnings.push('EAN / Barcode not detected in source code (stored as null)');
    if (!parsedProduct.brand) warnings.push('Brand not automatically detected (stored as null)');
    if (parsedProduct.price === null) warnings.push('Price not detected');
    if (!parsedProduct.variants || parsedProduct.variants.length === 0) {
      warnings.push('No variant structures (varianti / descvar1) detected');
    }
  }

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
              <FileCode className="w-5 h-5 text-emerald-400" />
              <span>HTML Source Import (View Source)</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              100% reliable extraction: copy the page source HTML from Safari (iPhone) or desktop browser and paste it here. Extracts flavors, lot expiry dates, variants, and images without being blocked.
            </p>
          </div>
          <button
            onClick={() => setShowIphoneHelp(!showIphoneHelp)}
            className="self-start sm:self-center px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium inline-flex items-center space-x-1 border border-slate-700"
          >
            <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>iPhone Safari Guide</span>
          </button>
        </div>

        {/* iPhone Help Instructions Box */}
        {showIphoneHelp && (
          <div className="mt-4 p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2 animate-in fade-in">
            <h3 className="font-semibold text-emerald-400">How to copy HTML page source on iPhone in 30 seconds:</h3>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px] leading-relaxed">
              <li>Open the product page in <strong>Safari</strong> (e.g. on PlusPower Supplements).</li>
              <li>Wait for the product page to load completely (pass any Cloudflare verification in your browser).</li>
              <li>Tap the share icon and select <strong>Save to Files</strong> (saving as <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-400">.html</code>) or use a "View Source" Safari extension.</li>
              <li>Tap <strong>Upload File</strong> or paste the HTML contents into the text box below and tap <strong>Parse &amp; Preview Data</strong>.</li>
            </ol>
          </div>
        )}
      </div>

      {/* Input Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Product URL Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Original Product URL (Preserved for traceability)
          </label>
          <input
            type="text"
            placeholder="https://www.pluspowersupplements.com/100-hydro-isolate-2kg"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-600 outline-none font-mono"
          />
        </div>

        {/* HTML Paste & File Upload Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">
              HTML Source Code (View Source)
            </label>
            <div className="flex items-center space-x-2">
              <button
                onClick={handlePasteFromClipboard}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium inline-flex items-center space-x-1"
              >
                <Clipboard className="w-3 h-3 text-emerald-400" />
                <span>Paste</span>
              </button>
              <label className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium inline-flex items-center space-x-1 cursor-pointer">
                <Upload className="w-3 h-3 text-blue-400" />
                <span>Upload File</span>
                <input
                  type="file"
                  accept=".html,.htm,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <textarea
            rows={7}
            value={htmlSource}
            onChange={(e) => {
              setHtmlSource(e.target.value);
              setErrorMessage(null);
              setIsCloudflareError(false);
            }}
            placeholder="Paste the complete HTML source code of the product page (<html ...>)..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 outline-none font-mono leading-relaxed"
          />
        </div>

        {/* Action Button */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleParse}
            disabled={!htmlSource.trim() || isParsing}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center space-x-2 shadow-md shadow-emerald-950/40 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isParsing ? 'Parsing...' : 'Parse & Preview Data'}</span>
          </button>

          {htmlSource && (
            <button
              onClick={() => {
                setHtmlSource('');
                setParsedProduct(null);
                setErrorMessage(null);
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-medium"
            >
              Clear
            </button>
          )}
        </div>

        {/* Cloudflare Challenge Rejection Alert */}
        {isCloudflareError && (
          <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 space-y-2 animate-in fade-in">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <h4 className="font-bold text-xs sm:text-sm">Cloudflare Challenge Page Detected</h4>
            </div>
            <p className="text-xs text-amber-300/90 leading-relaxed">
              Cloudflare protection detected. Automatic extraction is unavailable for this page. Please use HTML Import to import the product information manually from the fully loaded product page.
            </p>
            <div className="text-[11px] text-amber-400 pt-1">
              <strong>Instructions:</strong> Open the product page in your browser, wait for the challenge to complete and the full product page to render, then copy the resolved page source.
            </div>
          </div>
        )}

        {/* General Error Message */}
        {errorMessage && !isCloudflareError && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Extraction Preview & Confirmation Section */}
      {parsedProduct && (
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl animate-in slide-in-from-bottom-3">
          {/* Header Preview & Save Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-semibold border border-emerald-500/20 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Extracted Product Preview Ready for Review</span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">{parsedProduct.title}</h2>
              <span className="text-xs text-slate-400 font-mono">{parsedProduct.url}</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center space-x-1.5 shadow-md shadow-emerald-950/40 transition-all"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving...' : 'Confirm & Save to Database'}</span>
              </button>
            </div>
          </div>

          {/* Save Success Banner */}
          {saveSuccess && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Product and variants successfully saved to database!</span>
              </div>
              <button
                onClick={() => setCurrentPage('products')}
                className="text-xs font-semibold text-emerald-400 hover:underline inline-flex items-center"
              >
                Go to Products <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </button>
            </div>
          )}

          {/* Warnings List */}
          {warnings.length > 0 && (
            <div className="p-3 bg-slate-950 border border-amber-900/40 rounded-xl text-xs space-y-1">
              <div className="flex items-center space-x-1.5 text-amber-400 font-semibold">
                <Info className="w-3.5 h-3.5" />
                <span>Fields missing in source HTML (kept null as per specification):</span>
              </div>
              <ul className="list-disc list-inside text-slate-400 text-[11px] space-y-0.5 pl-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Editable Fields in Preview */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Primary Product Data (Editable before saving)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Product Title</label>
                <input
                  type="text"
                  value={parsedProduct.title}
                  onChange={(e) => setParsedProduct({ ...parsedProduct, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Brand</label>
                <input
                  type="text"
                  value={parsedProduct.brand || ''}
                  onChange={(e) => setParsedProduct({ ...parsedProduct, brand: e.target.value || null })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Price (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedProduct.price ?? ''}
                  onChange={(e) =>
                    setParsedProduct({
                      ...parsedProduct,
                      price: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">SKU</label>
                <input
                  type="text"
                  value={parsedProduct.sku || ''}
                  onChange={(e) => setParsedProduct({ ...parsedProduct, sku: e.target.value || null })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">EAN / Barcode</label>
                <input
                  type="text"
                  value={parsedProduct.ean || ''}
                  onChange={(e) => setParsedProduct({ ...parsedProduct, ean: e.target.value || null })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Availability</label>
                <select
                  value={parsedProduct.availability || 'InStock'}
                  onChange={(e) => setParsedProduct({ ...parsedProduct, availability: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="InStock">In Stock</option>
                  <option value="OutOfStock">Out of Stock</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Total Stock</label>
                <input
                  type="number"
                  value={parsedProduct.stock_quantity ?? ''}
                  onChange={(e) =>
                    setParsedProduct({
                      ...parsedProduct,
                      stock_quantity: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
            </div>
          </div>

          {/* Images Carousel */}
          {parsedProduct.images && parsedProduct.images.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 mb-2">
                Extracted Images ({parsedProduct.images.length})
              </h3>
              <div className="flex space-x-2 overflow-x-auto pb-2">
                {parsedProduct.images.map((img, i) => (
                  <div
                    key={i}
                    className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 p-1 flex-shrink-0 flex items-center justify-center"
                  >
                    <img src={img} alt="" className="max-w-full max-h-full object-contain" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Variants Breakdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-white flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                Extracted Variants &amp; Flavors ({parsedProduct.variants?.length || 0})
              </h3>
              <span className="text-[10px] text-slate-400">Parsed from varianti &amp; descvar1</span>
            </div>

            {!parsedProduct.variants || parsedProduct.variants.length === 0 ? (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                No variants extracted.
              </div>
            ) : (
              <div className="space-y-2">
                {parsedProduct.variants.map((v, idx) => (
                  <div
                    key={v.id || idx}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-200 flex items-center space-x-2">
                        <span>{v.name}</span>
                        {v.availability && (
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded-full ${
                              v.availability === 'InStock'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            }`}
                          >
                            {v.availability === 'InStock' ? 'In Stock' : 'Out of Stock'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 mt-1 font-mono">
                        {v.sku && <span>SKU: {v.sku}</span>}
                        {v.ean && <span>EAN: {v.ean}</span>}
                        {v.expiry_date && (
                          <span className="text-amber-400/90 font-sans">
                            Exp: {v.expiry_date}
                          </span>
                        )}
                        {v.stock_quantity !== null && (
                          <span className="text-slate-300 font-sans">Stock: {v.stock_quantity}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-xs font-bold text-white">
                        {v.price !== null ? `€ ${Number(v.price).toFixed(2)}` : 'N/A'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
