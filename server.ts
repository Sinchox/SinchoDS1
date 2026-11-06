import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import {
  isCloudflareChallenge,
  isValidProductUrl,
  extractProductFromHtml,
  ALLOWED_HOSTS,
  CLOUDFLARE_ERROR_MESSAGE,
} from './src/utils/parser.js';
import {
  isZenRowsConfigured,
  fetchWithZenRows,
  testZenRowsConnection,
} from './src/utils/zenrows.js';
import {
  parseSitemapXml,
  filterDiscoveredUrls,
  prioritizeChildSitemaps,
  SitemapErrorType,
} from './src/utils/sitemap.js';
import {
  handleBootstrapWorkspace,
  handleClaimLegacyWorkspace,
  getWorkspaceConfig,
} from './src/server/workspace.js';
import { workspaceRouter } from './src/server/workspaceRoutes.js';
import { runMonitoringScheduledCycle } from './src/server/monitoringService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==============================================================================
// Multi-Workspace Secure Management Endpoints (Phase 1.1)
// ==============================================================================

// 1. User workspace bootstrap (idempotent, isolated per user)
app.post('/api/workspaces/bootstrap', handleBootstrapWorkspace);

// 2. Controlled legacy workspace claim (service-role only, strict server secret validation)
app.post('/api/workspaces/claim-legacy', handleClaimLegacyWorkspace);

// 3. Operational workspace configuration status (never leaks secrets)
app.get('/api/workspaces/status', (_req, res) => {
  const config = getWorkspaceConfig();
  res.json({
    ok: true,
    supabaseConfigured: Boolean(config.supabaseUrl),
    serviceRoleConfigured: Boolean(config.serviceRoleKey),
    legacyClaimConfigured: Boolean(config.legacyClaimSecret),
  });
});

// Mount secure workspace-scoped router (Products, Suppliers, eBay, Orders, History)
app.use('/api', workspaceRouter);

// Parse HTML directly
app.post('/api/parse-html', (req, res) => {
  try {
    const { html, url, supplierId } = req.body;
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ error: 'HTML source is required.' });
    }
    const targetUrl = url && typeof url === 'string' ? url.trim() : 'https://www.pluspowersupplements.com/';

    if (isCloudflareChallenge(html)) {
      return res.status(400).json({
        error: 'CLOUDFLARE_CHALLENGE',
        message: CLOUDFLARE_ERROR_MESSAGE,
      });
    }

    const product = extractProductFromHtml(html, targetUrl, 'html_import');
    product.supplier_id = supplierId || 'pluspower';
    product.supplier_name = supplierId === 'pluspower' ? 'PlusPower Supplements' : 'External Supplier';
    res.json({ ok: true, product });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error parsing HTML' });
  }
});

// ZenRows Provider Status
app.get('/api/zenrows/status', (_req, res) => {
  res.json({
    configured: isZenRowsConfigured(),
    provider: 'zenrows',
  });
});

// ZenRows Connection Test (tests with public test URL by default)
app.post('/api/zenrows/test', async (req, res) => {
  try {
    const testUrl = req.body?.url && typeof req.body.url === 'string'
      ? req.body.url.trim()
      : 'https://httpbin.org/html';
    const result = await testZenRowsConnection(testUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message || 'ZenRows connection test failed' });
  }
});

// Live Scrape single URL (supports direct fetch and ZenRows provider)
app.post('/api/scrape', async (req, res) => {
  try {
    const { url, provider = 'direct', jsRender = false, supplierId } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Product URL is required.' });
    }

    if (!isValidProductUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL. Only PlusPower product URLs are supported.' });
    }

    let text = '';
    let statusCode = 200;
    let headersRecord: Record<string, string> = {};

    if (provider === 'zenrows') {
      if (!isZenRowsConfigured()) {
        return res.status(400).json({
          ok: false,
          error: 'ZENROWS_NOT_CONFIGURED',
          message: 'ZenRows API key is not configured in backend environment variables (ZENROWS_API_KEY). Please configure ZENROWS_API_KEY or select Direct Fetch.',
        });
      }

      const zenResult = await fetchWithZenRows(url, { jsRender: Boolean(jsRender) });
      statusCode = zenResult.statusCode || zenResult.status;
      headersRecord = zenResult.headers || {};

      if (!zenResult.ok || !zenResult.html) {
        return res.json({
          ok: false,
          statusCode,
          message: zenResult.error || `ZenRows request failed with status ${statusCode}`,
        });
      }

      text = zenResult.html;
    } else {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      response.headers.forEach((v, k) => {
        headersRecord[k.toLowerCase()] = v;
      });
      statusCode = response.status;
      text = await response.text();
    }

    if (statusCode === 403 || statusCode === 429 || statusCode === 503 || isCloudflareChallenge(text, statusCode, headersRecord)) {
      return res.json({
        ok: false,
        blocked: true,
        statusCode,
        url,
        message: CLOUDFLARE_ERROR_MESSAGE,
      });
    }

    if (statusCode < 200 || statusCode >= 300) {
      return res.json({
        ok: false,
        statusCode,
        message: `HTTP error ${statusCode}`,
      });
    }

    const source = provider === 'zenrows' ? 'zenrows_scraper' : 'live_scraper';
    const product = extractProductFromHtml(text, url, source);
    product.supplier_id = supplierId || 'pluspower';
    product.supplier_name = (supplierId === 'pluspower' || !supplierId) ? 'PlusPower Supplements' : 'External Supplier';
    res.json({ ok: true, product, provider });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Scrape failed' });
  }
});

// Helper to fetch sitemap text with either ZenRows or Direct Fetch
async function fetchSitemapUrl(
  targetUrl: string,
  provider: 'zenrows' | 'direct'
): Promise<{
  ok: boolean;
  text?: string;
  statusCode: number;
  errorType?: SitemapErrorType;
  message?: string;
  blocked?: boolean;
}> {
  if (provider === 'zenrows') {
    if (!isZenRowsConfigured()) {
      return {
        ok: false,
        statusCode: 401,
        errorType: 'ZENROWS_KEY_MISSING',
        message:
          'ZenRows API key is not configured in backend environment variables (ZENROWS_API_KEY). Please configure ZENROWS_API_KEY or select Direct Fetch.',
      };
    }

    const zenResult = await fetchWithZenRows(targetUrl, { jsRender: false });
    const statusCode = zenResult.statusCode || zenResult.status || 500;
    const text = zenResult.html || '';
    const headers = zenResult.headers || {};

    if (statusCode === 401) {
      return {
        ok: false,
        statusCode: 401,
        errorType: 'ZENROWS_AUTH_FAILED',
        message: 'ZenRows authentication failed (HTTP 401). Please verify your ZENROWS_API_KEY in backend environment.',
      };
    }

    if (statusCode === 402 || statusCode === 429) {
      return {
        ok: false,
        statusCode,
        errorType: 'ZENROWS_INSUFFICIENT_CREDITS',
        message: `ZenRows reported insufficient credits or rate limit exceeded (HTTP ${statusCode}).`,
      };
    }

    if (statusCode === 404) {
      return {
        ok: false,
        statusCode: 404,
        errorType: 'SITEMAP_NOT_FOUND',
        message: `Sitemap URL was not found (HTTP 404): ${targetUrl}`,
      };
    }

    if (statusCode === 403 || isCloudflareChallenge(text, statusCode, headers)) {
      return {
        ok: false,
        statusCode,
        errorType: 'CLOUDFLARE_CHALLENGE',
        blocked: true,
        message: CLOUDFLARE_ERROR_MESSAGE,
      };
    }

    if (!zenResult.ok || !text) {
      return {
        ok: false,
        statusCode,
        errorType: 'FETCH_FAILED',
        message: zenResult.error || `Failed to fetch sitemap via ZenRows (HTTP ${statusCode})`,
      };
    }

    return {
      ok: true,
      text,
      statusCode: 200,
    };
  } else {
    // Direct Fetch
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/xml,text/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(15000),
    });

    const headersRecord: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headersRecord[k.toLowerCase()] = v;
    });

    const statusCode = response.status;
    const text = await response.text();

    if (
      statusCode === 403 ||
      statusCode === 429 ||
      statusCode === 503 ||
      isCloudflareChallenge(text, statusCode, headersRecord)
    ) {
      return {
        ok: false,
        statusCode,
        errorType: 'CLOUDFLARE_CHALLENGE',
        blocked: true,
        message:
          'Cloudflare protection detected on sitemap. Automated direct discovery is unavailable. Please configure ZENROWS_API_KEY in your server environment to enable ZenRows sitemap extraction, or add product URLs manually.',
      };
    }

    if (statusCode === 404) {
      return {
        ok: false,
        statusCode: 404,
        errorType: 'SITEMAP_NOT_FOUND',
        message: `Sitemap URL not found (HTTP 404): ${targetUrl}`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        statusCode,
        errorType: statusCode === 403 ? 'FORBIDDEN_DOMAIN' : 'FETCH_FAILED',
        message: `HTTP error ${statusCode} while retrieving sitemap from ${targetUrl}`,
      };
    }

    return {
      ok: true,
      text,
      statusCode: 200,
    };
  }
}

// Sitemap discovery (supports single sitemaps, sitemap indexes, child crawl, ZenRows & Direct fallback)
app.all('/api/sitemap', async (req, res) => {
  try {
    const rawUrl =
      (req.query.url as string) ||
      (req.body?.url as string) ||
      'https://www.pluspowersupplements.com/sitemap.xml';
    const sitemapUrl = rawUrl.trim();
    const requestedProvider = (
      (req.query.provider as string) ||
      (req.body?.provider as string) ||
      'auto'
    ).toLowerCase();
    const maxChildSitemaps = Math.min(
      10,
      Math.max(
        1,
        parseInt(
          (req.query.maxChildSitemaps as string) ||
            (req.body?.maxChildSitemaps as string) ||
            '5',
          10
        )
      )
    );

    let effectiveProvider: 'zenrows' | 'direct' = 'direct';
    if (requestedProvider === 'zenrows') {
      effectiveProvider = 'zenrows';
    } else if (requestedProvider === 'direct') {
      effectiveProvider = 'direct';
    } else {
      effectiveProvider = isZenRowsConfigured() ? 'zenrows' : 'direct';
    }

    const initialFetch = await fetchSitemapUrl(sitemapUrl, effectiveProvider);
    if (!initialFetch.ok || !initialFetch.text) {
      return res.json({
        ok: false,
        sitemapUrl,
        providerUsed: effectiveProvider,
        errorType: initialFetch.errorType || 'FETCH_FAILED',
        statusCode: initialFetch.statusCode,
        blocked: initialFetch.blocked,
        message: initialFetch.message || 'Failed to fetch sitemap content.',
      });
    }

    const parseResult = parseSitemapXml(initialFetch.text);
    if (!parseResult.isXml) {
      return res.json({
        ok: false,
        sitemapUrl,
        providerUsed: effectiveProvider,
        errorType: 'INVALID_XML',
        message:
          'The URL did not return a valid XML sitemap document. The response was not recognized as XML.',
      });
    }

    if (parseResult.isIndex) {
      // Sitemap Index: contains multiple child sitemaps
      const childSitemaps = prioritizeChildSitemaps(parseResult.childSitemaps);
      if (childSitemaps.length === 0) {
        return res.json({
          ok: false,
          sitemapUrl,
          isIndex: true,
          childSitemapsFound: 0,
          childSitemapsProcessed: 0,
          products: [],
          categories: [],
          totalDiscovered: 0,
          providerUsed: effectiveProvider,
          errorType: 'EMPTY_SITEMAP',
          message: 'Sitemap index was found, but contained no child sitemap locations.',
        });
      }

      const toProcess = childSitemaps.slice(0, maxChildSitemaps);
      const allRawUrls: string[] = [];
      let processedCount = 0;

      for (const childUrl of toProcess) {
        try {
          const childFetch = await fetchSitemapUrl(childUrl, effectiveProvider);
          if (childFetch.ok && childFetch.text) {
            const childParsed = parseSitemapXml(childFetch.text);
            allRawUrls.push(...childParsed.rawUrls);
            processedCount++;
          }
        } catch {
          // Continue processing other child sitemaps safely
        }
      }

      const filtered = filterDiscoveredUrls(allRawUrls);

      if (filtered.products.length === 0 && filtered.categories.length === 0) {
        return res.json({
          ok: false,
          sitemapUrl,
          isIndex: true,
          childSitemapsFound: childSitemaps.length,
          childSitemapsProcessed: processedCount,
          products: [],
          categories: [],
          totalDiscovered: 0,
          providerUsed: effectiveProvider,
          errorType: 'EMPTY_SITEMAP',
          message: `Processed ${processedCount} child sitemap(s), but found no product or category URLs matching criteria.`,
        });
      }

      return res.json({
        ok: true,
        sitemapUrl,
        isIndex: true,
        childSitemapsFound: childSitemaps.length,
        childSitemapsProcessed: processedCount,
        products: filtered.products,
        categories: filtered.categories,
        totalDiscovered: filtered.products.length,
        providerUsed: effectiveProvider,
      });
    }

    // Standard single sitemap
    const filtered = filterDiscoveredUrls(parseResult.rawUrls);
    if (filtered.products.length === 0 && filtered.categories.length === 0) {
      return res.json({
        ok: false,
        sitemapUrl,
        isIndex: false,
        childSitemapsFound: 0,
        childSitemapsProcessed: 0,
        products: [],
        categories: [],
        totalDiscovered: 0,
        providerUsed: effectiveProvider,
        errorType: 'EMPTY_SITEMAP',
        message: `XML sitemap was retrieved (${parseResult.rawUrls.length} total URLs), but contained no valid product URLs after filtering.`,
      });
    }

    return res.json({
      ok: true,
      sitemapUrl,
      isIndex: false,
      childSitemapsFound: 0,
      childSitemapsProcessed: 0,
      products: filtered.products,
      categories: filtered.categories,
      totalDiscovered: filtered.products.length,
      providerUsed: effectiveProvider,
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      errorType: 'FETCH_FAILED',
      message: err.message || 'Server error occurred while scanning sitemap.',
    });
  }
});

// Category and curated discovery lists
app.get('/api/categories', (_req, res) => {
  const categories = [
    { name: 'Proteine', url: 'https://www.pluspowersupplements.com/proteine' },
    { name: 'Aminoacidi', url: 'https://www.pluspowersupplements.com/aminoacidi' },
    { name: 'Creatina', url: 'https://www.pluspowersupplements.com/creatina' },
    { name: 'Vitamine e Minerali', url: 'https://www.pluspowersupplements.com/vitamine-e-minerali' },
    { name: 'Controllo Peso', url: 'https://www.pluspowersupplements.com/controllo-del-peso' },
    { name: 'Alimenti Fit', url: 'https://www.pluspowersupplements.com/alimenti-fit' },
    { name: 'Pre Workout & Energia', url: 'https://www.pluspowersupplements.com/pre-workout' },
    { name: 'Barrette Proteiche', url: 'https://www.pluspowersupplements.com/barrette-proteiche' },
  ];
  res.json({ ok: true, categories });
});

// ==============================================================================
// Official eBay Sell API & OAuth Endpoints
// ==============================================================================

// 1. Generate eBay Authorization URL
app.get('/api/ebay/auth-url', (req, res) => {
  const clientId = (req.query.clientId as string) || process.env.EBAY_CLIENT_ID || '';
  const ruName = (req.query.ruName as string) || process.env.EBAY_RUNAME || '';
  const env = ((req.query.env as string) || 'PRODUCTION').toUpperCase();

  if (!clientId || !ruName) {
    return res.status(400).json({
      error: 'EBAY_CREDENTIALS_MISSING',
      message: 'Client ID and RuName are required to generate the official eBay OAuth sign-in URL.',
    });
  }

  const baseAuthUrl = env === 'SANDBOX'
    ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
    : 'https://auth.ebay.com/oauth2/authorize';

  const scopes = [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  ].join(' ');

  const authUrl = `${baseAuthUrl}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(ruName)}&scope=${encodeURIComponent(scopes)}`;

  res.json({ ok: true, authUrl });
});

// Note: /api/ebay/status, /api/ebay/exchange-code, and /api/ebay/publish
// are mounted and handled with verified workspace isolation via workspaceRouter above.

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';
  const server = http.createServer(app);

  if (isDev) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SinchoDS platform server running on http://0.0.0.0:${PORT}`);

    // Start background price and stock monitoring cycle (runs every 60s independently of browser sessions)
    const MONITORING_TICK_MS = 60 * 1000;
    setInterval(async () => {
      try {
        await runMonitoringScheduledCycle();
      } catch (err: any) {
        console.error('Background monitoring cycle error:', err.message);
      }
    }, MONITORING_TICK_MS);
  });
}

startServer();
