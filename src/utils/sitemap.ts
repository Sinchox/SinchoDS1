import * as cheerio from 'cheerio';
import { isValidProductUrl, normalizeProductUrl, isCloudflareChallenge, CLOUDFLARE_ERROR_MESSAGE } from './parser.js';

export type SitemapErrorType =
  | 'ZENROWS_KEY_MISSING'
  | 'ZENROWS_AUTH_FAILED'
  | 'ZENROWS_INSUFFICIENT_CREDITS'
  | 'SITEMAP_NOT_FOUND'
  | 'INVALID_XML'
  | 'CLOUDFLARE_CHALLENGE'
  | 'FORBIDDEN_DOMAIN'
  | 'EMPTY_SITEMAP'
  | 'SITEMAP_INDEX_FAILED'
  | 'FETCH_FAILED';

export interface SitemapParseOutput {
  isXml: boolean;
  isIndex: boolean;
  childSitemaps: string[];
  rawUrls: string[];
}

export interface DiscoveredUrlsGroup {
  products: string[];
  categories: string[];
  other: string[];
}

export interface SitemapScanResult {
  ok: boolean;
  sitemapUrl: string;
  isIndex: boolean;
  childSitemapsFound: number;
  childSitemapsProcessed: number;
  products: string[];
  categories: string[];
  totalDiscovered: number;
  providerUsed: 'zenrows' | 'direct';
  errorType?: SitemapErrorType;
  message?: string;
  statusCode?: number;
  blocked?: boolean;
}

// Non-product asset and static page extensions/paths to strictly filter out
const ASSET_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp', '.ico',
  '.pdf', '.css', '.js', '.xml', '.json', '.woff', '.woff2', '.ttf', '.mp4'
];

const EXCLUDED_PATH_KEYWORDS = [
  // Blog / News / Articles
  '/blog', '/articoli', '/notizie', '/news', '/posts', '/post/', '/guida', '/guide',
  // Static informative pages
  '/chi-siamo', '/about-us', '/about', '/contatti', '/contact', '/privacy', '/cookie',
  '/terms', '/termini', '/condizioni', '/faq', '/help', '/spedizioni', '/resi', '/resi-e-rimborsi',
  '/store-locator', '/negozi',
  // Account & checkout pages
  '/cart', '/checkout', '/carrello', '/account', '/login', '/registrati', '/register',
  '/admin', '/my-account', '/password',
  // Internal sitemap paths
  '/sitemap.xml', '/sitemap_index.xml'
];

const KNOWN_CATEGORY_SLUGS = [
  'proteine',
  'aminoacidi',
  'creatina',
  'vitamine-e-minerali',
  'controllo-del-peso',
  'alimenti-fit',
  'pre-workout',
  'barrette-proteiche',
  'nutrizione-sportiva',
  'salute-e-benessere',
  'abbigliamento',
  'marche',
  'promo',
  'last-minute'
];

/**
 * Parses XML sitemap text with full namespace tolerance.
 * Supports standard sitemaps (<urlset>) and sitemap indexes (<sitemapindex>).
 */
export function parseSitemapXml(xmlContent: string): SitemapParseOutput {
  if (!xmlContent || typeof xmlContent !== 'string') {
    return { isXml: false, isIndex: false, childSitemaps: [], rawUrls: [] };
  }

  const trimmed = xmlContent.trim();

  // If text starts with HTML doctype or <html> and doesn't contain urlset/sitemapindex tags
  if (
    (/^\s*<!DOCTYPE\s+html/i.test(trimmed) || /^\s*<html[\s>]/i.test(trimmed)) &&
    !/<urlset[\s>]/i.test(trimmed) &&
    !/<sitemapindex[\s>]/i.test(trimmed)
  ) {
    return { isXml: false, isIndex: false, childSitemaps: [], rawUrls: [] };
  }

  const $ = cheerio.load(trimmed, { xmlMode: true });

  // 1. Check for Sitemap Index (<sitemapindex> containing <sitemap><loc>...</loc></sitemap>)
  const childSitemaps: string[] = [];
  $('sitemap loc, sitemapindex sitemap loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc && (loc.startsWith('http://') || loc.startsWith('https://'))) {
      childSitemaps.push(loc);
    }
  });

  if (childSitemaps.length > 0 || $('sitemapindex').length > 0) {
    return {
      isXml: true,
      isIndex: true,
      childSitemaps: Array.from(new Set(childSitemaps)),
      rawUrls: [],
    };
  }

  // 2. Check for Standard Sitemap (<urlset> containing <url><loc>...</loc></url>)
  const rawUrls: string[] = [];
  $('url loc, urlset url loc, loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc && (loc.startsWith('http://') || loc.startsWith('https://'))) {
      rawUrls.push(loc);
    }
  });

  const uniqueUrls = Array.from(new Set(rawUrls));
  const isXml = uniqueUrls.length > 0 || /<urlset[\s>]/i.test(trimmed) || /<\?xml/i.test(trimmed);

  return {
    isXml,
    isIndex: false,
    childSitemaps: [],
    rawUrls: uniqueUrls,
  };
}

/**
 * Filters discovered URLs, removing blog, articles, static pages, and assets.
 * Categorizes valid URLs into products and category landing pages.
 */
export function filterDiscoveredUrls(rawUrls: string[]): DiscoveredUrlsGroup {
  const products: string[] = [];
  const categories: string[] = [];
  const other: string[] = [];

  for (const raw of rawUrls) {
    const url = normalizeProductUrl(raw);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }

    const pathname = parsed.pathname.toLowerCase();
    const cleanPath = pathname.replace(/^\/+|\/+$/g, '');

    // Skip root domain
    if (!cleanPath) continue;

    // Filter asset extensions
    const hasAssetExt = ASSET_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    if (hasAssetExt) continue;

    // Filter excluded path keywords (blog, articles, privacy, cart, etc.)
    const isExcluded = EXCLUDED_PATH_KEYWORDS.some((kw) => pathname.includes(kw));
    if (isExcluded) continue;

    // Check if category page first (e.g. /proteine, /creatina, /category/...)
    if (
      KNOWN_CATEGORY_SLUGS.includes(cleanPath) ||
      pathname.includes('/category/') ||
      pathname.includes('/categoria/') ||
      pathname.includes('/collection/')
    ) {
      categories.push(url);
      continue;
    }

    // Check if PlusPower product URL
    if (parsed.hostname.includes('pluspowersupplements.com')) {
      if (isValidProductUrl(url)) {
        products.push(url);
      } else {
        other.push(url);
      }
    } else {
      // Generic supplier sitemap handling (non-PlusPower)
      products.push(url);
    }
  }

  return {
    products: Array.from(new Set(products)),
    categories: Array.from(new Set(categories)),
    other: Array.from(new Set(other)),
  };
}

/**
 * Assigns a numeric priority rank to a sitemap URL.
 * 1: Product sitemaps (highest priority)
 * 2: Category sitemaps
 * 3: General sitemaps
 * 4: Blog / news / static sitemaps (lowest priority)
 */
export function getSitemapRank(url: string): number {
  const lower = url.toLowerCase();
  // Avoid bare 'item' as it matches 'sitemap'
  const isProductSitemap =
    lower.includes('product') ||
    lower.includes('prodott') ||
    lower.includes('catalog') ||
    lower.includes('/item') ||
    lower.includes('-item') ||
    lower.includes('_item');
  if (isProductSitemap) return 1;

  const isCategorySitemap =
    lower.includes('category') ||
    lower.includes('categori') ||
    lower.includes('collezione') ||
    lower.includes('collection');
  if (isCategorySitemap) return 2;

  const isNonProductSitemap =
    lower.includes('blog') ||
    lower.includes('news') ||
    lower.includes('article') ||
    lower.includes('post') ||
    lower.includes('author') ||
    lower.includes('tag') ||
    lower.includes('static');
  if (isNonProductSitemap) return 4;

  return 3;
}

/**
 * Sorts child sitemap URLs to prioritize product sitemaps first.
 */
export function prioritizeChildSitemaps(childSitemaps: string[]): string[] {
  return [...childSitemaps].sort((a, b) => getSitemapRank(a) - getSitemapRank(b));
}
