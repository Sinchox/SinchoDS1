import { Product, ProductVariant, Supplier } from '../types.js';
import {
  extractProductFromHtml as pluspowerExtractProduct,
  extractPlusPowerVariants,
  isValidProductUrl as pluspowerIsValidUrl,
  isCloudflareChallenge as pluspowerIsCloudflare,
  ALLOWED_HOSTS as PLUSPOWER_HOSTS,
  parseProductWithSupplierFallback,
} from './parser.js';

export interface SupplierConnector {
  id: string;
  name: string;
  baseUrl: string;
  allowedHosts: string[];
  validateUrl(url: string): boolean;
  extractFromHtml(html: string, url: string, importSource?: string): Product;
  extractVariants(html: string): ProductVariant[];
  checkCloudflare(html: string, statusCode?: number, headers?: Record<string, string>): boolean;
  getSitemapUrl?(): string;
  testConnectivity?(): Promise<{ ok: boolean; message: string }>;
}

/**
 * PlusPower Supplements Connector Implementation
 */
export const PlusPowerConnector: SupplierConnector = {
  id: 'pluspower',
  name: 'PlusPower Supplements',
  baseUrl: 'https://www.pluspowersupplements.com',
  allowedHosts: PLUSPOWER_HOSTS,

  validateUrl(url: string): boolean {
    return pluspowerIsValidUrl(url);
  },

  extractFromHtml(html: string, url: string, importSource = 'html_import'): Product {
    const product = pluspowerExtractProduct(html, url, importSource as any);
    product.supplier_id = 'pluspower';
    product.supplier_name = 'PlusPower Supplements';
    return product;
  },

  extractVariants(html: string): ProductVariant[] {
    return extractPlusPowerVariants(html);
  },

  checkCloudflare(html: string, statusCode?: number, headers?: Record<string, string>): boolean {
    return pluspowerIsCloudflare(html, statusCode, headers);
  },

  getSitemapUrl(): string {
    return 'https://www.pluspowersupplements.com/sitemap.xml';
  },

  async testConnectivity(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        return { ok: true, message: 'Server proxy e connettore PlusPower operativi.' };
      }
      return { ok: false, message: 'Errore risposta server interno.' };
    } catch (e: any) {
      return { ok: false, message: e.message || 'Errore di rete.' };
    }
  },
};

/**
 * Registry of Supplier Connectors
 */
const CONNECTOR_REGISTRY: Record<string, SupplierConnector> = {
  pluspower: PlusPowerConnector,
};

export function createGenericConnector(supplier: Supplier): SupplierConnector {
  const effectiveBaseUrl = supplier.baseUrl || supplier.base_url || '';
  let allowedHosts: string[] = [];
  try {
    const host = new URL(effectiveBaseUrl).hostname.toLowerCase();
    allowedHosts = [host];
  } catch {
    allowedHosts = [];
  }
  return {
    id: supplier.id,
    name: supplier.name,
    baseUrl: effectiveBaseUrl,
    allowedHosts,
    validateUrl(url: string): boolean {
      try {
        const u = new URL(url);
        return allowedHosts.some((h) => u.hostname.toLowerCase().includes(h));
      } catch {
        return false;
      }
    },
    extractFromHtml(html: string, url: string, importSource = 'html_import'): Product {
      return parseProductWithSupplierFallback(html, url, supplier, undefined, importSource as any);
    },
    extractVariants(html: string): ProductVariant[] {
      const prod = parseProductWithSupplierFallback(html, '', supplier);
      return prod.variants || [];
    },
    checkCloudflare(html: string, statusCode?: number, headers?: Record<string, string>): boolean {
      return pluspowerIsCloudflare(html, statusCode, headers);
    },
    testConnectivity: async () => {
      return { ok: true, message: `Connettore ${supplier.name} pronto.` };
    },
  };
}

export function getSupplierConnector(supplierId: string, customSuppliers?: Supplier[]): SupplierConnector | null {
  if (CONNECTOR_REGISTRY[supplierId]) {
    return CONNECTOR_REGISTRY[supplierId];
  }
  if (customSuppliers) {
    const s = customSuppliers.find((cs) => cs.id === supplierId);
    if (s) return createGenericConnector(s);
  }
  return null;
}

export function detectSupplierFromUrl(url: string, suppliers?: Supplier[]): SupplierConnector | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    for (const connector of Object.values(CONNECTOR_REGISTRY)) {
      if (connector.allowedHosts.some((h) => host.includes(h.toLowerCase()))) {
        return connector;
      }
    }
    if (suppliers) {
      for (const s of suppliers) {
        if (!s.baseUrl) continue;
        try {
          const sHost = new URL(s.baseUrl).hostname.toLowerCase();
          if (host.includes(sHost)) {
            return createGenericConnector(s);
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // invalid url
  }
  return null;
}

export const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'pluspower',
    name: 'PlusPower Supplements',
    baseUrl: 'https://www.pluspowersupplements.com',
    logoText: '⚡ PlusPower',
    status: 'active',
    lastSyncAt: new Date().toISOString(),
    productCount: 1,
    failedCount: 0,
    description: 'Fornitore primario integratori alimentari, proteine, aminoacidi, vitamine con lotti di scadenza e gusti multipli.',
    supportedFeatures: {
      sitemap: true,
      variants: true,
      lotExpiry: true,
      liveScraping: true,
      htmlImport: true,
    },
  },
  {
    id: 'future_supplier',
    name: 'Fornitore Esterno (Integrazione Aperta)',
    baseUrl: 'https://api.example.com',
    logoText: '📦 Nuovo Fornitore',
    status: 'disabled',
    lastSyncAt: null,
    productCount: 0,
    failedCount: 0,
    description: 'Modulo connettore pronto per l\'aggiunta di un secondo fornitore (farmaceutica, nutrizione o abbigliamento).',
    supportedFeatures: {
      sitemap: false,
      variants: true,
      lotExpiry: false,
      liveScraping: false,
      htmlImport: true,
    },
  },
];
