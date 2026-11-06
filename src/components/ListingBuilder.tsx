import React, { useState, useEffect, useMemo } from 'react';
import {
  Product,
  ProductVariant,
  EbayListing,
  PricingRule,
  PricingCalculation,
  ListingValidationCheck,
} from '../types.js';
import {
  Store,
  Sparkles,
  Calculator,
  Save,
  Send,
  Eye,
  CheckCircle2,
  AlertTriangle,
  X,
  Layers,
  ArrowRight,
  ShieldCheck,
  Tag,
  DollarSign,
  HelpCircle,
  ExternalLink,
  FileText,
  AlertCircle,
} from 'lucide-react';
import {
  calculateEbayPricing,
  generateEbayTitle,
  generateEbayDescriptionHtml,
  countWords,
  validateEbayListing,
  DEFAULT_PRICING_RULE,
} from '../utils/pricing.js';

interface ListingBuilderProps {
  product: Product;
  onSaveListing: (listing: EbayListing) => Promise<{ ok: boolean; listing: EbayListing }>;
  onClose: () => void;
  pricingRule?: PricingRule;
  isEbayConnected?: boolean;
}

export const ListingBuilder: React.FC<ListingBuilderProps> = ({
  product,
  onSaveListing,
  onClose,
  pricingRule = DEFAULT_PRICING_RULE,
  isEbayConnected = false,
}) => {
  // Step navigation (1: Title & Variant, 2: Pricing & Profit, 3: Specs & Description, 4: Quality Review & Publish)
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);

  // Selected Variant (or null for master product)
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    product.variants && product.variants.length > 0 ? product.variants[0].id : ''
  );

  const selectedVariant = product.variants?.find((v) => v.id === selectedVariantId) || null;

  // Base fields
  const supplierCost = selectedVariant?.price !== null && selectedVariant?.price !== undefined
    ? Number(selectedVariant.price)
    : (product.price !== null ? Number(product.price) : 25);

  const [title, setTitle] = useState(
    generateEbayTitle({
      brand: product.brand,
      title: product.title,
      variantName: selectedVariant?.name,
    })
  );

  const [categoryId, setCategoryId] = useState('180959'); // Dietary & Sports Supplements (eBay IT)
  const [categoryName, setCategoryName] = useState('Bellezza e salute > Integratori alimentari > Proteine e sport');
  const [quantity, setQuantity] = useState<number>(selectedVariant?.stock_quantity ?? product.stock_quantity ?? 5);

  // Pricing Rule & Calculation state
  const [rule, setRule] = useState<PricingRule>({ ...pricingRule });
  const [sellingPrice, setSellingPrice] = useState<number>(() => {
    const calc = calculateEbayPricing(supplierCost, pricingRule);
    return calc.recommendedPrice;
  });

  // Calculate metrics on the fly
  const pricingCalc: PricingCalculation = calculateEbayPricing(supplierCost, {
    ...rule,
  });

  // Keep selling price in sync if recommended changes and user hasn't typed custom
  const [isPriceCustomized, setIsPriceCustomized] = useState(false);
  useEffect(() => {
    if (!isPriceCustomized) {
      setSellingPrice(pricingCalc.recommendedPrice);
    }
  }, [supplierCost, rule, isPriceCustomized]);

  // Recalculate profit for the actual selling price
  const actualEbayFee = Math.round((sellingPrice * (rule.ebayFeePercent / 100) + rule.ebayFixedFee) * 100) / 100;
  const actualNetProfit = Math.round((sellingPrice - actualEbayFee - supplierCost - rule.supplierShippingCost) * 100) / 100;
  const actualMarginPercent = sellingPrice > 0 ? Math.round((actualNetProfit / sellingPrice) * 1000) / 10 : 0;

  // Item Specifics (eBay.it requires standard Italian taxonomy keys)
  const [itemSpecifics, setItemSpecifics] = useState<Record<string, string>>({
    Marca: product.brand || 'Yamamoto Nutrition',
    Gusto: selectedVariant?.name || 'Neutro',
    Formulazione: 'Polvere / Capsule',
    'Data di scadenza': selectedVariant?.expiry_date || 'Lotto recente',
    'Paese di fabbricazione': 'Italia',
    MPN: selectedVariant?.sku || product.sku || 'YAM-PP',
  });

  // Description HTML
  const [descriptionHtml, setDescriptionHtml] = useState(() =>
    generateEbayDescriptionHtml(product, selectedVariant)
  );
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);

  // Live word counter
  const wordCount = useMemo(() => countWords(descriptionHtml), [descriptionHtml]);

  // Submission / Publish state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Re-generate title helper
  const handleRegenerateTitle = () => {
    const fresh = generateEbayTitle({
      brand: product.brand,
      title: product.title,
      variantName: selectedVariant?.name,
    });
    setTitle(fresh);
  };

  // Re-generate full description helper
  const handleRegenerateDescription = () => {
    const freshHtml = generateEbayDescriptionHtml(product, selectedVariant);
    setDescriptionHtml(freshHtml);
  };

  // Build listing object
  const buildListingObject = (status: 'draft' | 'active'): EbayListing => {
    const currentValidation = validateEbayListing(
      {
        id: 'temp',
        product_id: product.id,
        supplier_id: product.supplier_id || 'pluspower',
        supplier_url: product.url,
        marketplace_id: 'EBAY_IT',
        title: title.trim(),
        category_id: categoryId,
        category_name: categoryName,
        condition_id: 'NEW',
        price: sellingPrice,
        original_supplier_cost: supplierCost,
        expected_profit: actualNetProfit,
        quantity,
        sku: selectedVariant?.sku || product.sku || `SINCHO-${product.id.substring(0, 6)}`,
        ean: selectedVariant?.ean || product.ean || null,
        brand: product.brand || null,
        description_html: descriptionHtml,
        images: product.images && product.images.length > 0 ? product.images : [],
        item_specifics: itemSpecifics,
        status,
        variants: product.variants?.map((v) => ({
          sku: v.sku || `V-${v.id}`,
          name: v.name,
          ean: v.ean || null,
          price: Number(v.price) || supplierCost,
          quantity: v.stock_quantity || 1,
          expiryDate: v.expiry_date,
        })) || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      supplierCost
    );

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12),
      product_id: product.id,
      supplier_id: product.supplier_id || 'pluspower',
      supplier_url: product.url,
      marketplace_id: 'EBAY_IT',
      title: title.trim(),
      category_id: categoryId,
      category_name: categoryName,
      condition_id: 'NEW',
      price: sellingPrice,
      original_supplier_cost: supplierCost,
      expected_profit: actualNetProfit,
      quantity,
      sku: selectedVariant?.sku || product.sku || `SINCHO-${product.id.substring(0, 6)}`,
      ean: selectedVariant?.ean || product.ean || null,
      brand: product.brand || null,
      description_html: descriptionHtml,
      images: product.images && product.images.length > 0 ? product.images : [],
      item_specifics: itemSpecifics,
      status,
      variants: product.variants?.map((v) => ({
        sku: v.sku || `V-${v.id}`,
        name: v.name,
        ean: v.ean || null,
        price: Number(v.price) || supplierCost,
        quantity: v.stock_quantity || 1,
        expiryDate: v.expiry_date,
      })) || [],
      validation_status: currentValidation.isReady ? 'ready' : 'needs_review',
      validation_errors: currentValidation.checks
        .filter((c: ListingValidationCheck) => !c.passed)
        .map((c: ListingValidationCheck) => c.message),
      word_count: wordCount,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // Live validation result
  const validation = useMemo(() => {
    return validateEbayListing(buildListingObject('draft'), supplierCost);
  }, [title, sellingPrice, supplierCost, descriptionHtml, itemSpecifics, selectedVariant, product, quantity]);

  // Save as Draft
  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    setPublishMessage(null);
    try {
      const listing = buildListingObject('draft');
      const res = await onSaveListing(listing);
      if (res.ok) {
        setPublishMessage({
          ok: true,
          text: listing.validation_status === 'ready'
            ? 'Listing successfully saved as Ready Draft! Quality criteria (≥ 300 words, title ≤ 80 chars) verified.'
            : 'Listing saved as Draft (Needs Review). Complete missing quality items before publishing.',
        });
      }
    } catch (err: any) {
      setPublishMessage({ ok: false, text: err.message || 'Error saving draft' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Publish to eBay.it (with validation & explicit seller confirmation)
  const handlePublishToEbay = async () => {
    if (title.length > 80) {
      alert('The listing title exceeds the maximum 80 characters allowed by eBay.');
      return;
    }
    if (wordCount < 300) {
      alert(`Description requires at least 300 words for eBay.it SEO (current: ${wordCount} words). Please expand the content or regenerate.`);
      return;
    }
    if (sellingPrice <= 0) {
      alert('Please enter a valid selling price greater than 0.');
      return;
    }

    setIsSubmitting(true);
    setPublishMessage(null);

    const listing = buildListingObject('draft');

    try {
      // Call server publication endpoint
      const res = await fetch('/api/ebay/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      });

      const data = await res.json();

      if (data.ok && data.ebayItemId) {
        listing.status = 'active';
        listing.ebay_item_id = data.ebayItemId;
        listing.published_at = new Date().toISOString();
        await onSaveListing(listing);
        setPublishMessage({
          ok: true,
          text: `Listing officially published to eBay.it! Item ID: ${data.ebayItemId}`,
        });
      } else {
        // Saved as verified draft when live account token is awaiting connection
        await onSaveListing(listing);
        setPublishMessage({
          ok: false,
          text: data.message || 'Listing saved as verified draft. Connect your eBay Developer credentials in Settings to publish directly to eBay.it.',
        });
      }
    } catch (err: any) {
      setPublishMessage({ ok: false, text: err.message || 'Network error communicating with eBay' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-5">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold">
              <Store className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                eBay.it Listing Builder &bull; SinchoDS
              </h2>
              <span className="text-[11px] text-slate-400">
                Supplier: <strong>{product.supplier_name || 'PlusPower'}</strong> &bull; Cost: € {supplierCost.toFixed(2)} &bull; Marketplace: <strong>eBay Italy (ebay.it)</strong>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wizard Steps Navigation Bar */}
        <div className="grid grid-cols-4 border-b border-slate-800 text-center text-xs font-semibold bg-slate-950">
          <button
            onClick={() => setActiveStep(1)}
            className={`py-2.5 transition-colors border-b-2 ${
              activeStep === 1
                ? 'border-emerald-400 text-emerald-400 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            1. Title & Variant
          </button>
          <button
            onClick={() => setActiveStep(2)}
            className={`py-2.5 transition-colors border-b-2 ${
              activeStep === 2
                ? 'border-emerald-400 text-emerald-400 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            2. Pricing & Profit
          </button>
          <button
            onClick={() => setActiveStep(3)}
            className={`py-2.5 transition-colors border-b-2 ${
              activeStep === 3
                ? 'border-emerald-400 text-emerald-400 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            3. Specs & Description
          </button>
          <button
            onClick={() => setActiveStep(4)}
            className={`py-2.5 transition-colors border-b-2 ${
              activeStep === 4
                ? 'border-emerald-400 text-emerald-400 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            4. Quality Review
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {/* STEP 1: Title & Variant */}
          {activeStep === 1 && (
            <div className="space-y-4">
              {/* Variant Selector */}
              {product.variants && product.variants.length > 0 && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Select Primary Flavor / Listing Variant:
                  </label>
                  <select
                    value={selectedVariantId}
                    onChange={(e) => {
                      setSelectedVariantId(e.target.value);
                      const v = product.variants.find((item) => item.id === e.target.value);
                      if (v) {
                        setTitle(
                          generateEbayTitle({
                            brand: product.brand,
                            title: product.title,
                            variantName: v.name,
                          })
                        );
                        setDescriptionHtml(generateEbayDescriptionHtml(product, v));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500"
                  >
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (SKU: {v.sku || 'N/A'} &bull; Cost: € {Number(v.price || supplierCost).toFixed(2)} &bull; Stock: {v.stock_quantity ?? 'N/A'} &bull; Exp: {v.expiry_date || 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Title & SEO Helper */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-semibold">
                    eBay.it Listing Title (Max 80 characters, Italian SEO)
                  </label>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[11px] font-mono font-bold ${
                        title.length > 80 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {title.length} / 80 characters
                    </span>
                    <button
                      type="button"
                      onClick={handleRegenerateTitle}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] inline-flex items-center space-x-1"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      <span>Optimize Title</span>
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  maxLength={85}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-white font-medium text-xs sm:text-sm outline-none"
                />

                {title.length > 80 && (
                  <p className="text-[11px] text-rose-400 flex items-center space-x-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span>Warning: eBay rejects listing titles exceeding 80 characters. Please shorten by {title.length - 80} character(s).</span>
                  </p>
                )}
              </div>

              {/* Category Selection */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  eBay.it Primary Category
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    const names: Record<string, string> = {
                      '180959': 'Bellezza e salute > Integratori alimentari > Proteine e sport',
                      '180960': 'Bellezza e salute > Integratori alimentari > Aminoacidi e BCAA',
                      '180961': 'Bellezza e salute > Integratori alimentari > Vitamine e minerali',
                      '180962': 'Bellezza e salute > Integratori alimentari > Controllo peso',
                    };
                    setCategoryName(names[e.target.value] || 'Integratori alimentari');
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white outline-none focus:border-emerald-500"
                >
                  <option value="180959">180959 - Sports Nutrition & Protein (Proteine e sport)</option>
                  <option value="180960">180960 - Amino Acids & BCAAs (Aminoacidi e BCAA)</option>
                  <option value="180961">180961 - Vitamins & Minerals (Vitamine e minerali)</option>
                  <option value="180962">180962 - Weight Management (Controllo peso)</option>
                </select>
              </div>

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Quantity for Sale</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Item Condition</label>
                  <input
                    type="text"
                    disabled
                    value="New with tags / Factory sealed (1000)"
                    className="w-full bg-slate-950 border border-slate-800/60 rounded-xl p-2.5 text-slate-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Pricing & Profit Calculator */}
          {activeStep === 2 && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white flex items-center space-x-1.5">
                    <Calculator className="w-4 h-4 text-emerald-400" />
                    <span>Margin & eBay.it Fee Calculator</span>
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono">Currency: EUR (€)</span>
                </div>

                {/* Pricing Parameters Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Supplier Cost</span>
                    <span className="text-sm font-bold text-white">€ {supplierCost.toFixed(2)}</span>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Supplier Shipping (€)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rule.supplierShippingCost}
                      onChange={(e) =>
                        setRule({ ...rule, supplierShippingCost: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Target Margin (%)</label>
                    <input
                      type="number"
                      value={rule.targetMarginPercent}
                      onChange={(e) =>
                        setRule({ ...rule, targetMarginPercent: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">eBay Fee (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rule.ebayFeePercent}
                      onChange={(e) =>
                        setRule({ ...rule, ebayFeePercent: parseFloat(e.target.value) || 11.5 })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white"
                    />
                  </div>
                </div>

                {/* Live Metrics Card */}
                <div className="p-3 bg-slate-900 border border-emerald-900/40 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Break-even Price</span>
                    <span className="text-xs font-mono font-semibold text-amber-400">
                      € {pricingCalc.breakEvenPrice.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Estimated eBay Fees</span>
                    <span className="text-xs font-mono font-semibold text-slate-300">
                      € {actualEbayFee.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Estimated Net Profit</span>
                    <span className={`text-sm font-bold font-mono ${actualNetProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      € {actualNetProfit.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Effective Margin</span>
                    <span className={`text-sm font-bold ${actualMarginPercent >= 20 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {actualMarginPercent}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Final Selling Price Input */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <label className="block text-slate-300 font-bold">
                  Final Selling Price on eBay.it (€):
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    step="0.01"
                    value={sellingPrice}
                    onChange={(e) => {
                      setSellingPrice(parseFloat(e.target.value) || 0);
                      setIsPriceCustomized(true);
                    }}
                    className="w-48 bg-slate-900 border border-emerald-500 rounded-xl p-2.5 text-white text-base font-bold font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSellingPrice(pricingCalc.recommendedPrice);
                      setIsPriceCustomized(false);
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
                  >
                    Reset to Recommended (€ {pricingCalc.recommendedPrice.toFixed(2)})
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  This is the active selling price that will be submitted to eBay Italy.
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: Specs & Description */}
          {activeStep === 3 && (
            <div className="space-y-4">
              {/* Item Specifics */}
              <div>
                <h3 className="text-slate-300 font-bold mb-2">Item Specifics (eBay.it Taxonomy)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(itemSpecifics).map(([key, val]) => (
                    <div key={key} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">{key}</span>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) =>
                          setItemSpecifics({ ...itemSpecifics, [key]: e.target.value })
                        }
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1 text-white text-xs mt-1"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Description HTML */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <label className="text-slate-300 font-bold">
                      eBay.it Description (Professional Italian HTML)
                    </label>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-mono font-bold ${
                        wordCount >= 300
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {wordCount} / 300 words min
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleRegenerateDescription}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium inline-flex items-center space-x-1"
                      title="Regenerate structured 7-section Italian description"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Regenerate (7-Section)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHtmlPreview(!showHtmlPreview)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium inline-flex items-center space-x-1"
                    >
                      <Eye className="w-3.5 h-3.5 text-blue-400" />
                      <span>{showHtmlPreview ? 'Show Code' : 'Visual Preview'}</span>
                    </button>
                  </div>
                </div>

                {/* Word Count Indicator Banner */}
                <div
                  className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                    wordCount >= 350
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : wordCount >= 300
                      ? 'bg-blue-950/40 border-blue-800/60 text-blue-300'
                      : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {wordCount >= 300 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    )}
                    <span>
                      {wordCount >= 300
                        ? `Meets SEO requirement with ${wordCount} actual words (excludes HTML tags & repeated headers).`
                        : `Current word count is ${wordCount}. Minimum 300 words required to mark as Ready Draft.`}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
                    Target: 350–500 words
                  </span>
                </div>

                {showHtmlPreview ? (
                  <div
                    className="p-4 bg-white rounded-xl text-slate-900 max-h-72 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                  />
                ) : (
                  <textarea
                    rows={8}
                    value={descriptionHtml}
                    onChange={(e) => setDescriptionHtml(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono text-[11px] outline-none"
                  />
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Review & Quality Validation */}
          {activeStep === 4 && (
            <div className="space-y-4">
              {/* Quality Validation Checklist */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Listing Quality Control & Verification</span>
                  </h3>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                      validation.isReady
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {validation.isReady ? '✓ READY TO PUBLISH' : 'NEEDS REVIEW'}
                  </span>
                </div>

                <div className="space-y-2 pt-1">
                  {validation.checks.map((check: ListingValidationCheck, idx: number) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg text-xs flex items-center justify-between ${
                        check.passed
                          ? 'bg-slate-900/80 text-slate-300'
                          : 'bg-rose-950/30 text-rose-300 border border-rose-900/40'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        {check.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                        )}
                        <span>{check.message}</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-slate-400">
                        {check.passed ? 'PASSED' : 'REQUIRED'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Final Summary Card */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <h3 className="font-bold text-white text-sm">Listing Summary</h3>

                <div className="divide-y divide-slate-800 text-xs">
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Title:</span>
                    <span className="font-semibold text-white max-w-md text-right">{title}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Marketplace:</span>
                    <span className="font-semibold text-blue-400">eBay Italy (ebay.it)</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Selling Price:</span>
                    <span className="font-bold text-emerald-400 text-sm">€ {sellingPrice.toFixed(2)}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Supplier Cost:</span>
                    <span className="text-slate-200">€ {supplierCost.toFixed(2)}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Estimated Net Profit:</span>
                    <span className="font-bold text-emerald-400 font-mono">€ {actualNetProfit.toFixed(2)} ({actualMarginPercent}%)</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Word Count:</span>
                    <span className={`font-semibold ${wordCount >= 300 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {wordCount} words {wordCount >= 300 ? '(Meets ≥300 minimum)' : '(Under 300 minimum)'}
                    </span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-slate-400">Quantity:</span>
                    <span className="text-slate-200">{quantity} units</span>
                  </div>
                </div>
              </div>

              {/* Status & Outcome Banner */}
              {publishMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center space-x-2 animate-in fade-in ${
                    publishMessage.ok
                      ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                      : 'bg-amber-950/50 border-amber-800 text-amber-300'
                  }`}
                >
                  {publishMessage.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  )}
                  <span>{publishMessage.text}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-between rounded-b-2xl">
          <div>
            {activeStep > 1 && (
              <button
                type="button"
                onClick={() => setActiveStep((prev) => (prev - 1) as any)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
              >
                &larr; Back
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 border border-slate-700"
            >
              <Save className="w-3.5 h-3.5 text-blue-400" />
              <span>{validation.isReady ? 'Save Ready Draft' : 'Save Draft'}</span>
            </button>

            {activeStep < 4 ? (
              <button
                type="button"
                onClick={() => setActiveStep((prev) => (prev + 1) as any)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePublishToEbay}
                disabled={isSubmitting || !validation.isReady}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 shadow-md shadow-blue-950/40"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Publishing...' : 'Confirm & Publish to eBay.it'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
