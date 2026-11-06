import * as cheerio from 'cheerio';
import { Product, ProductVariant, Supplier } from '../types.js';

export const ALLOWED_HOSTS = ['www.pluspowersupplements.com', 'pluspowersupplements.com'];

export const CLOUDFLARE_ERROR_MESSAGE =
  'Cloudflare protection detected. Automatic extraction is unavailable for this page. Please use HTML Import to import the product information manually.';

/**
 * Detects whether an HTML string or response is a Cloudflare Challenge / Bot page.
 */
export function isCloudflareChallenge(html: string, statusCode?: number, headers?: Record<string, string>): boolean {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
    if (headers) {
      const server = (headers['server'] || headers['Server'] || '').toLowerCase();
      const cfMitigated = (headers['cf-mitigated'] || headers['CF-Mitigated'] || '').toLowerCase();
      const cfRay = headers['cf-ray'] || headers['CF-RAY'] || '';
      if (server.includes('cloudflare') || cfMitigated.includes('challenge') || (cfRay && statusCode === 403)) {
        return true;
      }
    } else {
      // Default assume 403 on protected host is challenge
      return true;
    }
  }

  if (!html) return false;
  const sample = html.slice(0, 80000).toLowerCase();

  const markers = [
    'cf-mitigated: challenge',
    'cf-mitigated',
    'just a moment...',
    'just a moment',
    'challenges.cloudflare.com',
    'challenge-platform',
    'cf-browser-verification',
    'turnstile',
    'cf-turnstile',
    '_cf_chl_opt',
    'window._cf_chl_opt',
    'cf-chl-',
    '__cf_chl_tk',
    'cf_chl_prog',
    'cloudflare ray id',
    'enable javascript and cookies to continue',
    'checking your browser',
    'checking your browser before accessing',
    'attention required! | cloudflare',
    'ray id:',
    'cf-please-wait',
    'challenge-running',
    'challenge-stage',
  ];

  for (const marker of markers) {
    if (sample.includes(marker)) {
      return true;
    }
  }

  // Also check page title
  const titleMatch = sample.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const title = titleMatch[1].trim();
    if (
      title.includes('just a moment') ||
      title.includes('attention required') ||
      title.includes('cloudflare') ||
      title.includes('security check')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a given URL is a valid PlusPower product URL.
 */
export function isValidProductUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
      return false;
    }
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return false;

    // Filter out standard non-product paths
    const excludedPrefixes = [
      'blog',
      'nutrizione-sportiva',
      'salute-e-benessere',
      'controllo-del-peso',
      'alimenti-fit',
      'abbigliamento',
      'marche',
      'promo',
      'last-minute',
      'chi-siamo',
      'contatti',
      'privacy',
      'cookie',
      'registrati',
      'condizioni-di-vendita',
      'resi-e-rimborsi',
      'rivenditore',
      'cart',
      'checkout',
      'login',
      'account',
      'sitemap',
    ];

    for (const prefix of excludedPrefixes) {
      if (path.toLowerCase().startsWith(prefix)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes URL (trims, strips query params & hash).
 */
export function normalizeProductUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.trim());
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return urlStr.trim();
  }
}

/**
 * Safely parse JavaScript object or array assignment from HTML without eval().
 */
export function extractJsAssignment(html: string, varName: string): any {
  if (!html) return null;
  const regex = new RegExp(`\\b${varName}\\s*=\\s*`, 'm');
  const match = regex.exec(html);
  if (!match) return null;

  let start = match.index + match[0].length;
  while (start < html.length && /\s/.test(html[start])) {
    start++;
  }

  if (start >= html.length || (html[start] !== '{' && html[start] !== '[')) {
    return null;
  }

  const opening = html[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      quote = char;
      continue;
    }

    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;
      if (depth === 0) {
        const raw = html.slice(start, i + 1);
        try {
          // Attempt standard JSON parse
          return JSON.parse(raw);
        } catch {
          // If single quotes or unquoted keys, use safe structured normalization
          try {
            const normalized = raw
              .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // quote unquoted keys
              .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"') // replace single quotes with double quotes
              .replace(/,\s*([}\]])/g, '$1'); // remove trailing commas
            return JSON.parse(normalized);
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Helper to normalize European price strings (e.g. "€ 34,90", "34,90 €", "34.90") to a clean number or null.
 */
export function parsePrice(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;

  const str = String(val).trim();
  // Strip currency symbols and letters
  const cleaned = str.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  // If contains both comma and dot, e.g. 1.250,50 or 1,250.50
  if (cleaned.includes('.') && cleaned.includes(',')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // European 1.250,50 -> 1250.50
      const num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
      return isNaN(num) ? null : num;
    } else {
      // US 1,250.50 -> 1250.50
      const num = parseFloat(cleaned.replace(/,/g, ''));
      return isNaN(num) ? null : num;
    }
  }

  // If only comma, e.g. 34,90 -> 34.90
  if (cleaned.includes(',')) {
    const num = parseFloat(cleaned.replace(',', '.'));
    return isNaN(num) ? null : num;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extracts product variants from PlusPower's `varianti` and `descvar1` JS variables.
 */
export function extractPlusPowerVariants(html: string): ProductVariant[] {
  const varianti = extractJsAssignment(html, 'varianti');
  const descvar1 = extractJsAssignment(html, 'descvar1');

  if (!varianti || typeof varianti !== 'object') {
    return [];
  }

  const flavorNames: Record<string, string> = {};
  if (Array.isArray(descvar1)) {
    for (const item of descvar1) {
      if (item && item.id !== undefined) {
        const name = (item.descrizione || item.description || item.nome || item.name || '').trim();
        flavorNames[String(item.id)] = name;
      }
    }
  }

  const variantRecords: ProductVariant[] = [];

  for (const [optionId, entries] of Object.entries(varianti)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;

      const lots = Array.isArray(entry.lotti) ? entry.lotti : [];
      let earliestExpiry: string | null = null;
      let availableOnline: boolean | null = null;

      if (lots.length > 0 && typeof lots[0] === 'object') {
        earliestExpiry = lots[0].scadenza ? String(lots[0].scadenza).trim() : null;
        if (lots[0].disponibile_web !== undefined) {
          availableOnline = Boolean(lots[0].disponibile_web);
        }
      }

      const rawPrice = entry.prezzo_sconto_ivato ?? entry.prezzo_ivato ?? entry.price;
      const rawOriginalPrice = entry.prezzo_ivato ?? entry.original_price;

      const price = parsePrice(rawPrice);
      const originalPrice = parsePrice(rawOriginalPrice);

      const stock = entry.quant !== undefined && entry.quant !== null ? Number(entry.quant) : null;
      const variantName = flavorNames[String(optionId)] || entry.nome || entry.name || `Opzione ${optionId}`;

      const sku = entry.codice ? String(entry.codice).trim() : (entry.sku ? String(entry.sku).trim() : null);
      const ean = entry.ean ? String(entry.ean).trim() : null;

      let availability: 'InStock' | 'OutOfStock' | null = null;
      if (stock !== null) {
        availability = stock > 0 ? 'InStock' : 'OutOfStock';
      } else if (availableOnline !== null) {
        availability = availableOnline ? 'InStock' : 'OutOfStock';
      }

      variantRecords.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        variant_id: entry.id !== undefined ? entry.id : null,
        option_id: optionId,
        name: variantName,
        sku: sku || null,
        ean: ean || null,
        price,
        original_price: originalPrice,
        stock_quantity: stock,
        availability,
        expiry_date: earliestExpiry,
        available_online: availableOnline,
        raw_data: {
          ...entry,
          lots,
        },
      });
    }
  }

  return variantRecords;
}

/**
 * Extracts JSON-LD Product blocks recursively.
 */
export function extractJsonLd(html: string): any | null {
  const $ = cheerio.load(html);
  const products: any[] = [];

  $('script[type*="ld+json"]').each((_, elem) => {
    try {
      const text = $(elem).text().trim();
      if (!text) return;
      const parsed = JSON.parse(text);

      const findProducts = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(findProducts);
          return;
        }

        const type = obj['@type'];
        const isProduct =
          (typeof type === 'string' && (type.toLowerCase() === 'product' || type.toLowerCase() === 'productgroup')) ||
          (Array.isArray(type) && type.some((t: string) => String(t).toLowerCase() === 'product'));

        if (isProduct) {
          products.push(obj);
        }

        for (const key of Object.keys(obj)) {
          findProducts(obj[key]);
        }
      };

      findProducts(parsed);
    } catch {
      // Ignore invalid JSON-LD scripts
    }
  });

  if (products.length === 0) return null;

  // Rank product by richness (hasVariant / ProductGroup takes precedence for multi-variant products)
  products.sort((a, b) => {
    const hasVarA = Array.isArray(a.hasVariant) && a.hasVariant.length > 0;
    const hasVarB = Array.isArray(b.hasVariant) && b.hasVariant.length > 0;
    const isGroupA = typeof a['@type'] === 'string' && a['@type'].toLowerCase() === 'productgroup';
    const isGroupB = typeof b['@type'] === 'string' && b['@type'].toLowerCase() === 'productgroup';

    const scoreA = (hasVarA ? 6 : 0) + (isGroupA ? 3 : 0) + (a.name ? 2 : 0) + (a.offers ? 2 : 0) + (a.brand ? 1 : 0) + (a.image ? 1 : 0);
    const scoreB = (hasVarB ? 6 : 0) + (isGroupB ? 3 : 0) + (b.name ? 2 : 0) + (b.offers ? 2 : 0) + (b.brand ? 1 : 0) + (b.image ? 1 : 0);
    return scoreB - scoreA;
  });

  return products[0];
}

/**
 * Comprehensive Product Extraction pipeline.
 */
export function extractProductFromHtml(
  html: string,
  sourceUrl: string,
  importSource: 'live_scraper' | 'sitemap' | 'html_import' | 'manual' | 'zenrows_scraper' = 'html_import'
): Product {
  if (isCloudflareChallenge(html)) {
    throw new Error(CLOUDFLARE_ERROR_MESSAGE);
  }

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd(html);

  // 1. Title Extraction
  let title = '';
  const h1Text = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (h1Text) {
    title = h1Text;
  } else if (jsonLd?.name) {
    title = String(jsonLd.name).trim();
  } else {
    title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text().trim() ||
      '';
    // Clean up title if it contains site suffix
    title = title.replace(/\s*[-|]\s*PlusPower.*$/i, '').trim();
  }

  // 2. Brand Extraction
  let brand: string | null = null;
  const brandMetaContent = $('[itemprop="brand"] meta[itemprop="name"]').attr('content');
  if (brandMetaContent) {
    brand = brandMetaContent.trim();
  } else if ($('[itemtype*="schema.org/Brand"] [itemprop="name"]').length) {
    brand = $('[itemtype*="schema.org/Brand"] [itemprop="name"]').first().text().trim();
  } else if (jsonLd?.brand) {
    if (typeof jsonLd.brand === 'object' && jsonLd.brand.name) {
      brand = String(jsonLd.brand.name).trim();
    } else if (typeof jsonLd.brand === 'string') {
      brand = jsonLd.brand.trim();
    }
  } else {
    const metaBrand = $('meta[name="brand"], meta[property="product:brand"]').attr('content');
    if (metaBrand) {
      brand = metaBrand.trim();
    }
  }

  // 3. Category
  let category: string | null = null;
  const breadcrumbs: string[] = [];
  $('.breadcrumb li, .breadcrumbs li, nav[aria-label="breadcrumb"] li').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !t.toLowerCase().includes('home') && t !== '>') {
      breadcrumbs.push(t);
    }
  });
  if (breadcrumbs.length > 1) {
    // Return the deepest parent category before the product name
    category = breadcrumbs.slice(0, -1).join(' > ');
  } else if (jsonLd?.category) {
    category = String(jsonLd.category).trim();
  }

  // 4. Variant Extraction (varianti + descvar1)
  const variants = extractPlusPowerVariants(html);

  // 5. SKU & EAN
  let sku: string | null = null;
  let ean: string | null = null;

  // Check itemprop / meta tags first
  const skuMeta = $('[itemprop="sku"]').attr('content') || $('[itemprop="sku"]').text().trim();
  if (skuMeta) sku = skuMeta;
  const eanMeta =
    $('[itemprop="gtin13"]').attr('content') ||
    $('[itemprop="gtin"]').attr('content') ||
    $('[itemprop="ean"]').attr('content') ||
    $('[itemprop="gtin13"]').text().trim();
  if (eanMeta) ean = eanMeta;

  // JSON-LD fallback for SKU/EAN
  if (!sku && jsonLd?.sku) sku = String(jsonLd.sku).trim();
  if (!ean && (jsonLd?.gtin13 || jsonLd?.gtin || jsonLd?.gtin8 || jsonLd?.ean)) {
    ean = String(jsonLd.gtin13 || jsonLd.gtin || jsonLd.gtin8 || jsonLd.ean).trim();
  }

  // If parent product doesn't have SKU/EAN, borrow from first variant if available
  if (!sku && variants.length > 0 && variants[0].sku) {
    sku = variants[0].sku;
  }
  if (!ean && variants.length > 0 && variants[0].ean) {
    ean = variants[0].ean;
  }

  // 6. Prices & Currency
  let price: number | null = null;
  let originalPrice: number | null = null;
  let currency = 'EUR';

  // Check offers in JSON-LD
  if (jsonLd?.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offers) {
      if (offers.price) price = parsePrice(offers.price);
      if (offers.priceCurrency) currency = String(offers.priceCurrency).trim();
    }
  }

  // Check variants for lowest/current price
  if (price === null && variants.length > 0) {
    const variantPrices = variants.map((v) => (typeof v.price === 'number' ? v.price : parsePrice(v.price))).filter((p): p is number => p !== null);
    if (variantPrices.length > 0) {
      price = Math.min(...variantPrices);
    }
  }

  // Check DOM price elements
  if (price === null) {
    const priceText = $('.price, .product-price, [itemprop="price"], .prezzo, #prezzo').first().text();
    price = parsePrice(priceText);
  }

  // Check original price (strike-through / old price)
  const oldPriceText = $('.old-price, .regular-price, .prezzo-vecchio, del, s').first().text();
  originalPrice = parsePrice(oldPriceText);

  if (variants.length > 0 && originalPrice === null) {
    const origPrices = variants
      .map((v) => (typeof v.original_price === 'number' ? v.original_price : parsePrice(v.original_price)))
      .filter((p): p is number => p !== null);
    if (origPrices.length > 0) {
      originalPrice = Math.max(...origPrices);
    }
  }

  let discountPercentage: number | null = null;
  if (price !== null && originalPrice !== null && originalPrice > price) {
    discountPercentage = Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  // 7. Stock & Availability
  let stockQuantity: number | null = null;
  let availability: 'InStock' | 'OutOfStock' | string | null = null;

  if (variants.length > 0) {
    const totalStock = variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
    stockQuantity = totalStock;
    availability = totalStock > 0 ? 'InStock' : 'OutOfStock';
  } else if (jsonLd?.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offers.availability) {
      availability = String(offers.availability).includes('InStock') ? 'InStock' : 'OutOfStock';
    }
  }

  // 8. Images
  const images: string[] = [];
  const addImage = (src?: string) => {
    if (!src) return;
    let clean = src.trim();
    if (!clean || clean.startsWith('data:')) return;
    try {
      clean = new URL(clean, 'https://www.pluspowersupplements.com/').href;
      if (!images.includes(clean)) {
        images.push(clean);
      }
    } catch {
      // Ignore invalid URL
    }
  };

  $('link[itemprop="image"]').each((_, el) => addImage($(el).attr('href')));
  $('#gallery a, .gallery a, #gallery img, .gallery img, #product-images img').each((_, el) => {
    addImage($(el).attr('href') || $(el).attr('src') || $(el).attr('data-src'));
  });
  if (jsonLd?.image) {
    if (Array.isArray(jsonLd.image)) {
      jsonLd.image.forEach((img: any) => addImage(typeof img === 'string' ? img : img?.url));
    } else if (typeof jsonLd.image === 'string') {
      addImage(jsonLd.image);
    } else if (typeof jsonLd.image === 'object' && jsonLd.image.url) {
      addImage(jsonLd.image.url);
    }
  }
  addImage($('meta[property="og:image"]').attr('content'));

  // 9. Description, Ingredients, Nutrition
  let description: string | null = null;
  const descEl = $('#description, .description, [itemprop="description"], #tab-description, .product-description').first();
  if (descEl.length) {
    description = descEl.text().replace(/\s+/g, ' ').trim();
  } else if (jsonLd?.description) {
    description = String(jsonLd.description).trim();
  }

  let ingredients: string | null = null;
  const ingEl = $('#ingredients, .ingredients, #ingredienti, .ingredienti, [class*="ingredient"]').first();
  if (ingEl.length) {
    ingredients = ingEl.text().replace(/\s+/g, ' ').trim();
  }

  let nutrition: string | null = null;
  const nutriEl = $('#nutrition, .nutrition, #nutrizione, .tabella-nutrizionale, [class*="nutri"]').first();
  if (nutriEl.length) {
    nutrition = nutriEl.text().replace(/\s+/g, ' ').trim();
  }

  // Status calculation
  const missingCoreFields: string[] = [];
  if (!title) missingCoreFields.push('title');
  if (price === null) missingCoreFields.push('price');
  if (!sku) missingCoreFields.push('sku');
  if (!ean) missingCoreFields.push('ean');

  const status: 'ready' | 'needs_review' = missingCoreFields.length > 0 ? 'needs_review' : 'ready';
  const errorMsg =
    missingCoreFields.length > 0
      ? `Fields requiring review: ${missingCoreFields.join(', ')}`
      : undefined;

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
    supplier_id: 'pluspower',
    supplier_name: 'PlusPower Supplements',
    url: normalizeProductUrl(sourceUrl),
    title,
    brand: brand || null,
    category: category || null,
    price,
    original_price: originalPrice,
    discount_percentage: discountPercentage,
    currency,
    sku: sku || null,
    ean: ean || null,
    availability,
    stock_quantity: stockQuantity,
    description: description || null,
    ingredients: ingredients || null,
    nutrition: nutrition || null,
    images,
    variants,
    raw_jsonld: jsonLd,
    import_source: importSource,
    status,
    error: errorMsg || null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Universal fallback product extractor.
 * Supports standard JSON-LD Schema.org (Product, ProductGroup),
 * OpenGraph, Twitter meta tags, Microdata, and standard HTML markup.
 * Also applies custom CSS selectors if provided via supplier.parserConfig.
 */
export function extractUniversalProductFromHtml(
  html: string,
  sourceUrl: string,
  supplier?: Partial<Supplier> | null,
  importSource: 'live_scraper' | 'sitemap' | 'html_import' | 'manual' | 'zenrows_scraper' = 'html_import'
): Product {
  if (isCloudflareChallenge(html)) {
    throw new Error(CLOUDFLARE_ERROR_MESSAGE);
  }

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd(html);
  const parserConfig = supplier?.parserConfig || supplier?.parser_config;

  // 1. Title Extraction
  let title = '';
  if (parserConfig?.titleSelector) {
    const customTitle = $(parserConfig.titleSelector).first().text().replace(/\s+/g, ' ').trim();
    if (customTitle) title = customTitle;
  }
  if (!title && jsonLd?.name) {
    title = String(jsonLd.name).trim();
  }
  if (!title) {
    const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
    if (h1) title = h1;
  }
  if (!title) {
    title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text().trim() ||
      '';
  }

  // 2. Brand Extraction
  let brand: string | null = null;
  if (jsonLd?.brand) {
    if (typeof jsonLd.brand === 'object' && jsonLd.brand.name) {
      brand = String(jsonLd.brand.name).trim();
    } else if (typeof jsonLd.brand === 'string') {
      brand = jsonLd.brand.trim();
    }
  }
  if (!brand) {
    brand =
      $('[itemprop="brand"] meta[itemprop="name"]').attr('content') ||
      $('[itemprop="brand"]').first().text().trim() ||
      $('meta[name="brand"]').attr('content') ||
      $('meta[property="product:brand"]').attr('content') ||
      null;
  }

  // 3. Category
  let category: string | null = null;
  const breadcrumbs: string[] = [];
  $('.breadcrumb li, .breadcrumbs li, nav[aria-label="breadcrumb"] li, ol.breadcrumb li').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !t.toLowerCase().includes('home') && t !== '>') {
      breadcrumbs.push(t);
    }
  });
  if (breadcrumbs.length > 1) {
    category = breadcrumbs.slice(0, -1).join(' > ');
  } else if (jsonLd?.category) {
    category = String(jsonLd.category).trim();
  }

  // 4. SKU & EAN
  let sku: string | null = null;
  let ean: string | null = null;

  if (parserConfig?.skuSelector) {
    const customSku = $(parserConfig.skuSelector).first().text().trim();
    if (customSku) sku = customSku;
  }
  if (parserConfig?.eanSelector) {
    const customEan = $(parserConfig.eanSelector).first().text().trim();
    if (customEan) ean = customEan;
  }

  if (!sku) {
    sku =
      $('[itemprop="sku"]').attr('content') ||
      $('[itemprop="sku"]').text().trim() ||
      (jsonLd?.sku ? String(jsonLd.sku).trim() : null);
  }

  if (!ean) {
    ean =
      $('[itemprop="gtin13"]').attr('content') ||
      $('[itemprop="gtin"]').attr('content') ||
      $('[itemprop="ean"]').attr('content') ||
      (jsonLd?.gtin13 || jsonLd?.gtin || jsonLd?.gtin8 || jsonLd?.ean
        ? String(jsonLd.gtin13 || jsonLd.gtin || jsonLd.gtin8 || jsonLd.ean).trim()
        : null);
  }

  // 5. Variants Extraction
  const variants: ProductVariant[] = [];
  if (Array.isArray(jsonLd?.hasVariant) && jsonLd.hasVariant.length > 0) {
    for (const v of jsonLd.hasVariant) {
      const vName = v.name || v.description || 'Variante';
      const vSku = v.sku || null;
      const vEan = v.gtin13 || v.gtin || v.ean || null;
      const vOffers = Array.isArray(v.offers) ? v.offers[0] : v.offers;
      const vPrice = parsePrice(vOffers?.price ?? v.price);
      const vStock = vOffers?.availability ? (String(vOffers.availability).includes('InStock') ? 10 : 0) : null;

      variants.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        variant_id: v.sku || v.name,
        name: String(vName).trim(),
        sku: vSku,
        ean: vEan,
        price: vPrice,
        original_price: null,
        stock_quantity: vStock,
        availability: vStock === null ? null : vStock > 0 ? 'InStock' : 'OutOfStock',
        expiry_date: null,
      });
    }
  } else if (Array.isArray(jsonLd?.offers) && jsonLd.offers.length > 1) {
    for (let idx = 0; idx < jsonLd.offers.length; idx++) {
      const o = jsonLd.offers[idx];
      const oPrice = parsePrice(o.price);
      const oSku = o.sku || null;
      const oName = o.name || o.description || `Opzione ${idx + 1}`;
      const oStock = o.availability ? (String(o.availability).includes('InStock') ? 10 : 0) : null;

      variants.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        variant_id: oSku || String(idx + 1),
        name: String(oName).trim(),
        sku: oSku,
        ean: null,
        price: oPrice,
        original_price: null,
        stock_quantity: oStock,
        availability: oStock === null ? null : oStock > 0 ? 'InStock' : 'OutOfStock',
        expiry_date: null,
      });
    }
  } else {
    // Check DOM select elements for variant attributes
    const selectEl = $('select[name*="attribute"], select[name*="variant"], select[id*="attribute"], select[id*="variant"], .variant-select').first();
    if (selectEl.length > 0) {
      selectEl.find('option').each((_, opt) => {
        const text = $(opt).text().trim();
        const val = $(opt).attr('value');
        if (text && val && !text.toLowerCase().includes('seleziona') && !text.toLowerCase().includes('scegli') && !text.toLowerCase().includes('select')) {
          variants.push({
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
            variant_id: val,
            name: text,
            sku: null,
            ean: null,
            price: null,
            original_price: null,
            stock_quantity: null,
            availability: 'InStock',
            expiry_date: null,
          });
        }
      });
    }
  }

  // If no parent SKU/EAN, borrow from first variant if available
  if (!sku && variants.length > 0 && variants[0].sku) sku = variants[0].sku;
  if (!ean && variants.length > 0 && variants[0].ean) ean = variants[0].ean;

  // 6. Pricing & Currency
  let price: number | null = null;
  let originalPrice: number | null = null;
  let currency = 'EUR';

  if (parserConfig?.priceSelector) {
    const customPriceText = $(parserConfig.priceSelector).first().text();
    price = parsePrice(customPriceText);
  }

  if (price === null && jsonLd?.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offers) {
      if (offers.price) price = parsePrice(offers.price);
      if (offers.priceCurrency) currency = String(offers.priceCurrency).trim();
    }
  }

  if (price === null && variants.length > 0) {
    const variantPrices = variants
      .map((v) => (typeof v.price === 'number' ? v.price : parsePrice(v.price)))
      .filter((p): p is number => p !== null);
    if (variantPrices.length > 0) {
      price = Math.min(...variantPrices);
    }
  }

  if (price === null) {
    const metaPrice = $('meta[property="product:price:amount"], meta[name="twitter:data1"], meta[property="og:price:amount"]').attr('content');
    if (metaPrice) price = parsePrice(metaPrice);
  }

  if (price === null) {
    const domPrice = $('.price, .product-price, [itemprop="price"], .current-price, .offer-price, .special-price, .prezzo').first().text();
    price = parsePrice(domPrice);
  }

  const oldPriceText = $('.old-price, .regular-price, .prezzo-vecchio, del, s, .strikethrough').first().text();
  originalPrice = parsePrice(oldPriceText);

  let discountPercentage: number | null = null;
  if (price !== null && originalPrice !== null && originalPrice > price) {
    discountPercentage = Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  // 7. Stock & Availability
  let stockQuantity: number | null = null;
  let availability: 'InStock' | 'OutOfStock' | string | null = null;

  if (variants.length > 0) {
    const totalStock = variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
    if (totalStock > 0) {
      stockQuantity = totalStock;
      availability = 'InStock';
    }
  }
  if (!availability && jsonLd?.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offers?.availability) {
      availability = String(offers.availability).includes('InStock') ? 'InStock' : 'OutOfStock';
    }
  }
  if (!availability) {
    const stockText = $('.stock, .availability, [itemprop="availability"], .in-stock, .out-of-stock').text().toLowerCase();
    if (stockText.includes('non disponibile') || stockText.includes('esaurito') || stockText.includes('out of stock')) {
      availability = 'OutOfStock';
      stockQuantity = 0;
    } else if (stockText.includes('disponibile') || stockText.includes('in stock')) {
      availability = 'InStock';
      if (stockQuantity === null) stockQuantity = 10;
    }
  }

  // 8. Images
  const images: string[] = [];
  const addImage = (src?: string) => {
    if (!src) return;
    let clean = src.trim();
    if (!clean || clean.startsWith('data:')) return;
    try {
      clean = new URL(clean, sourceUrl).href;
      if (!images.includes(clean)) {
        images.push(clean);
      }
    } catch {
      // Ignore invalid URL
    }
  };

  if (parserConfig?.imageSelector) {
    $(parserConfig.imageSelector).each((_, el) => {
      addImage($(el).attr('src') || $(el).attr('data-src') || $(el).attr('href'));
    });
  }

  if (jsonLd?.image) {
    if (Array.isArray(jsonLd.image)) {
      jsonLd.image.forEach((img: any) => addImage(typeof img === 'string' ? img : img?.url));
    } else if (typeof jsonLd.image === 'string') {
      addImage(jsonLd.image);
    } else if (typeof jsonLd.image === 'object' && jsonLd.image.url) {
      addImage(jsonLd.image.url);
    }
  }

  addImage($('meta[property="og:image"]').attr('content'));
  addImage($('meta[name="twitter:image"]').attr('content'));
  $('link[itemprop="image"]').each((_, el) => addImage($(el).attr('href')));
  $('.product-gallery img, .product-images img, #gallery img, .main-image img').each((_, el) => {
    addImage($(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-zoom-image'));
  });

  // 9. Description
  let description: string | null = null;
  if (parserConfig?.descriptionSelector) {
    const customDesc = $(parserConfig.descriptionSelector).first().text().replace(/\s+/g, ' ').trim();
    if (customDesc) description = customDesc;
  }
  if (!description && jsonLd?.description) {
    description = String(jsonLd.description).trim();
  }
  if (!description) {
    const descEl = $('#description, .description, [itemprop="description"], #tab-description, .product-description, .product-details').first();
    if (descEl.length) {
      description = descEl.text().replace(/\s+/g, ' ').trim();
    }
  }
  if (!description) {
    description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null;
  }

  // Derive supplier name from URL or supplier object
  let resolvedSupplierId = supplier?.id || 'custom';
  let resolvedSupplierName = supplier?.name;
  if (!resolvedSupplierName) {
    try {
      const u = new URL(sourceUrl);
      resolvedSupplierName = u.hostname.replace(/^www\./, '');
    } catch {
      resolvedSupplierName = 'Fornitore Esterno';
    }
  }

  const missingCoreFields: string[] = [];
  if (!title) missingCoreFields.push('title');
  if (price === null) missingCoreFields.push('price');
  if (!sku) missingCoreFields.push('sku');
  if (!ean) missingCoreFields.push('ean');

  const errorMsg = missingCoreFields.length > 0 ? `Fields requiring review: ${missingCoreFields.join(', ')}` : undefined;
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
    supplier_id: resolvedSupplierId,
    supplier_name: resolvedSupplierName,
    url: normalizeProductUrl(sourceUrl),
    title,
    brand: brand || null,
    category: category || null,
    price,
    original_price: originalPrice,
    discount_percentage: discountPercentage,
    currency,
    sku: sku || null,
    ean: ean || null,
    availability: availability || 'InStock',
    stock_quantity: stockQuantity,
    description: description || null,
    ingredients: null,
    nutrition: null,
    images,
    variants,
    raw_jsonld: jsonLd,
    import_source: importSource,
    status: 'draft', // Required: Save imported products as Drafts
    ebay_status: 'not_listed',
    error: errorMsg || null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Automatically detects the supplier matching a given URL.
 */
export function detectSupplierFromUrl(url: string, suppliers?: Supplier[]): Supplier | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    // Check PlusPower hosts
    if (ALLOWED_HOSTS.some((h) => h.replace(/^www\./, '').toLowerCase() === host)) {
      return {
        id: 'pluspower',
        name: 'PlusPower Supplements',
        baseUrl: 'https://www.pluspowersupplements.com',
        logoText: '⚡ PlusPower',
        status: 'active',
        lastSyncAt: new Date().toISOString(),
        productCount: 1,
        failedCount: 0,
        description: 'Fornitore primario integratori alimentari.',
        isGlobal: true,
        supportedFeatures: {
          sitemap: true,
          variants: true,
          lotExpiry: true,
          liveScraping: true,
          htmlImport: true,
        },
      };
    }

    if (Array.isArray(suppliers)) {
      for (const s of suppliers) {
        if (!s.baseUrl) continue;
        try {
          const sHost = new URL(s.baseUrl).hostname.toLowerCase().replace(/^www\./, '');
          if (host === sHost || host.endsWith('.' + sHost)) {
            return s;
          }
        } catch {
          // ignore invalid baseUrl
        }
      }
    }
  } catch {
    // invalid url
  }
  return null;
}

/**
 * Universal extraction pipeline:
 * 1. Checks if URL matches PlusPower or if PlusPower connector is selected.
 * 2. Uses specialized PlusPower parser if matching.
 * 3. Otherwise uses universal Schema.org/OpenGraph fallback parser with custom selector support.
 * 4. Preserves status as 'draft' and ebay_status as 'not_listed'.
 */
export function parseProductWithSupplierFallback(
  html: string,
  url: string,
  supplier?: Supplier | null,
  allSuppliers?: Supplier[],
  importSource: 'live_scraper' | 'sitemap' | 'html_import' | 'manual' | 'zenrows_scraper' = 'html_import'
): Product {
  const matchedSupplier = supplier || detectSupplierFromUrl(url, allSuppliers);
  const isPlusPower =
    matchedSupplier?.id === 'pluspower' ||
    ALLOWED_HOSTS.some((h) => {
      try {
        return new URL(url).hostname.toLowerCase() === h.toLowerCase();
      } catch {
        return false;
      }
    });

  if (isPlusPower) {
    const product = extractProductFromHtml(html, url, importSource);
    // User requirement: "Save imported products as Drafts"
    product.status = 'draft';
    product.ebay_status = 'not_listed';
    return product;
  }

  return extractUniversalProductFromHtml(html, url, matchedSupplier, importSource);
}

