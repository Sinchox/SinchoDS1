import {
  Product,
  ProductVariant,
  Supplier,
  SupplierParserConfig,
  ImportJob,
  ImportJobItem,
  EbayListing,
  Order,
  OrderLineItem,
  OrderEvent,
  OrderRefundItem,
  OrderStatus,
  SupplierPurchasingStatus,
  DeliveryStatus,
  ReturnStatus,
  OrderSummaryStats,
  PriceHistoryItem,
  ImportHistoryItem,
  FinancialReport,
  DateRangePreset,
  InventoryMovement,
  InventoryMovementType,
  VariantStockStatus,
  WorkspaceInventorySummary,
} from '../types.js';
import { calculateOrderFinancials } from '../utils/pricing.js';
import { computeFinancialReport, getDateRangeBoundaries } from '../utils/financials.js';
import { generateFinancialOrdersCsv } from '../utils/csv.js';
import { INITIAL_SUPPLIERS } from '../utils/suppliers.js';
import {
  parseProductWithSupplierFallback,
  normalizeProductUrl,
  isCloudflareChallenge,
  CLOUDFLARE_ERROR_MESSAGE,
} from '../utils/parser.js';
import { fetchWithZenRows, isZenRowsConfigured } from '../utils/zenrows.js';
import { WorkspaceRole, hasMinimumRole } from './workspaceMiddleware.js';
import { getWorkspaceConfig, createServiceRoleClient } from './workspace.js';
import {
  createWorkspaceNotification,
  resolveWorkspaceNotification,
} from './monitoringService.js';

export interface EbayAccountData {
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  environment: 'PRODUCTION' | 'SANDBOX';
  sellerUsername: string;
}

export interface WorkspaceMetadata {
  id: string;
  name: string;
  slug: string;
  created_by: string;
}

// Global suppliers accessible to ALL workspaces (read-only for regular workspaces)
const globalSuppliers: Supplier[] = INITIAL_SUPPLIERS.map((s) => ({
  ...s,
  // Ensure pluspower is designated as global
  id: s.id,
  isGlobal: true,
  is_global: true,
  connected: true,
  fetchMethod: 'direct',
  jsRender: false,
  shippingCost: 0,
  stockThreshold: 5,
}));

// Scoped In-Memory Storage Partitions (Keyed strictly by workspaceId)
const workspaceProductsStore = new Map<string, Product[]>();
const workspaceSuppliersStore = new Map<string, Supplier[]>();
const workspaceEbayAccountsStore = new Map<string, EbayAccountData>();
const workspaceEbayListingsStore = new Map<string, EbayListing[]>();
const workspaceOrdersStore = new Map<string, Order[]>();
const workspacePriceHistoryStore = new Map<string, PriceHistoryItem[]>();
const workspaceImportHistoryStore = new Map<string, ImportHistoryItem[]>();
const workspaceImportJobsStore = new Map<string, ImportJob[]>();
const workspaceInfoStore = new Map<string, WorkspaceMetadata>();
const workspaceInventoryMovementsStore = new Map<string, InventoryMovement[]>();

export function clearWorkspaceStore(): void {
  workspaceProductsStore.clear();
  workspaceSuppliersStore.clear();
  workspaceEbayAccountsStore.clear();
  workspaceEbayListingsStore.clear();
  workspaceOrdersStore.clear();
  workspacePriceHistoryStore.clear();
  workspaceImportHistoryStore.clear();
  workspaceImportJobsStore.clear();
  workspaceInfoStore.clear();
  workspaceInventoryMovementsStore.clear();
}

export function registerWorkspaceMetadata(meta: WorkspaceMetadata): void {
  workspaceInfoStore.set(meta.id, meta);
}

export function getAllWorkspaceIds(): string[] {
  const ids = new Set<string>();
  for (const k of workspaceProductsStore.keys()) ids.add(k);
  for (const k of workspaceInfoStore.keys()) ids.add(k);
  return Array.from(ids);
}

// ==============================================================================
// 1. PRODUCTS & VARIANTS
// ==============================================================================

export async function listWorkspaceProducts(workspaceId: string): Promise<Product[]> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { data, error } = await client
          .from('products')
          .select('*, product_variants(*)')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          return data.map((row: any) => ({
            id: row.id,
            supplier_id: row.supplier_id || 'pluspower',
            supplier_name: row.supplier_name || 'PlusPower Supplements',
            supplier_product_id: row.supplier_product_id || null,
            url: row.url,
            title: row.title,
            brand: row.brand,
            category: row.category,
            price: row.price !== null ? Number(row.price) : null,
            original_price: row.original_price !== null ? Number(row.original_price) : null,
            discount_percentage: row.discount_percentage,
            currency: row.currency || 'EUR',
            sku: row.sku,
            ean: row.ean,
            availability: row.availability,
            stock_quantity: row.stock_quantity,
            description: row.description,
            ingredients: row.ingredients,
            nutrition: row.nutrition,
            images: Array.isArray(row.images) ? row.images : [],
            import_source: row.import_source || 'html_import',
            status: row.status || 'ready',
            error: row.error,
            created_at: row.created_at,
            updated_at: row.updated_at,
            ebay_listing_id: row.ebay_listing_id || null,
            ebay_status: row.ebay_status || 'not_listed',
            last_synced_at: row.last_synced_at || null,
            variants: Array.isArray(row.product_variants) ? row.product_variants : [],
          }));
        }
      }
    } catch {
      // Fallback to local scoped store
    }
  }

  const list = workspaceProductsStore.get(workspaceId) || [];
  return [...list];
}

export async function getWorkspaceProduct(workspaceId: string, productId: string): Promise<Product | null> {
  const products = await listWorkspaceProducts(workspaceId);
  return products.find((p) => p.id === productId) || null;
}

export async function saveWorkspaceProduct(
  workspaceId: string,
  product: Product
): Promise<{ ok: boolean; product: Product; error?: string }> {
  // CRITICAL SECURITY ENFORCEMENT:
  // Overwrite any workspace_id passed in the payload with the verified workspaceId
  const scopedProduct: Product = {
    ...JSON.parse(JSON.stringify(product)),
    supplier_id: product.supplier_id || 'pluspower',
    supplier_name: product.supplier_name || (product.supplier_id === 'pluspower' ? 'PlusPower Supplements' : 'Supplier'),
    created_at: product.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const payload = {
          id: scopedProduct.id,
          workspace_id: workspaceId, // Strictly scoped
          supplier_id: scopedProduct.supplier_id,
          supplier_name: scopedProduct.supplier_name,
          supplier_product_id: scopedProduct.supplier_product_id,
          url: scopedProduct.url,
          title: scopedProduct.title,
          brand: scopedProduct.brand,
          category: scopedProduct.category,
          price: scopedProduct.price,
          original_price: scopedProduct.original_price,
          discount_percentage: scopedProduct.discount_percentage,
          currency: scopedProduct.currency,
          sku: scopedProduct.sku,
          ean: scopedProduct.ean,
          availability: scopedProduct.availability,
          stock_quantity: scopedProduct.stock_quantity,
          description: scopedProduct.description,
          ingredients: scopedProduct.ingredients,
          nutrition: scopedProduct.nutrition,
          images: scopedProduct.images,
          raw_jsonld: scopedProduct.raw_jsonld,
          import_source: scopedProduct.import_source,
          status: scopedProduct.status,
          error: scopedProduct.error,
          ebay_listing_id: scopedProduct.ebay_listing_id,
          ebay_status: scopedProduct.ebay_status,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: savedProd, error: pError } = await client
          .from('products')
          .upsert(payload, { onConflict: 'workspace_id,url' })
          .select()
          .single();

        if (pError) {
          return { ok: false, product: scopedProduct, error: pError.message };
        }

        scopedProduct.id = savedProd.id;

        // Variants sync
        if (scopedProduct.variants && scopedProduct.variants.length > 0) {
          await client.from('product_variants').delete().eq('product_id', savedProd.id);
          const variantPayloads = scopedProduct.variants.map((v) => ({
            product_id: savedProd.id,
            variant_id: v.variant_id ? String(v.variant_id) : null,
            option_id: v.option_id ? String(v.option_id) : null,
            name: v.name,
            sku: v.sku,
            ean: v.ean,
            price: v.price,
            original_price: v.original_price,
            stock_quantity: v.stock_quantity,
            availability: v.availability,
            expiry_date: v.expiry_date,
            available_online: v.available_online,
            raw_data: v.raw_data || {},
          }));
          await client.from('product_variants').insert(variantPayloads);
        }

        return { ok: true, product: scopedProduct };
      }
    } catch {
      // Fallback to in-memory store
    }
  }

  // Scoped in-memory partition update
  const list = workspaceProductsStore.get(workspaceId) || [];
  const existingIdx = list.findIndex(
    (p) => p.id === scopedProduct.id || (p.url && scopedProduct.url && p.url === scopedProduct.url)
  );
  if (existingIdx >= 0) {
    list[existingIdx] = scopedProduct;
  } else {
    list.unshift(scopedProduct);
  }
  workspaceProductsStore.set(workspaceId, list);

  return { ok: true, product: scopedProduct };
}

export async function deleteWorkspaceProduct(workspaceId: string, productId: string): Promise<boolean> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        // Must filter strictly by BOTH id AND workspace_id
        const { error } = await client
          .from('products')
          .delete()
          .eq('id', productId)
          .eq('workspace_id', workspaceId);

        if (!error) return true;
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceProductsStore.get(workspaceId) || [];
  const filtered = list.filter((p) => p.id !== productId);
  const deleted = filtered.length < list.length;
  workspaceProductsStore.set(workspaceId, filtered);
  return deleted;
}

export async function bulkDeleteWorkspaceProducts(workspaceId: string, productIds: string[]): Promise<boolean> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        await client
          .from('products')
          .delete()
          .in('id', productIds)
          .eq('workspace_id', workspaceId);
        return true;
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceProductsStore.get(workspaceId) || [];
  const filtered = list.filter((p) => !productIds.includes(p.id));
  workspaceProductsStore.set(workspaceId, filtered);
  return true;
}

// ==============================================================================
// 1b. PRODUCT ARCHIVING & RESTORING
// ==============================================================================

export async function archiveWorkspaceProduct(workspaceId: string, productId: string): Promise<Product | null> {
  const prod = await getWorkspaceProduct(workspaceId, productId);
  if (!prod) return null;
  prod.is_archived = true;
  prod.status = 'archived';
  await saveWorkspaceProduct(workspaceId, prod);
  return prod;
}

export async function restoreWorkspaceProduct(workspaceId: string, productId: string): Promise<Product | null> {
  const prod = await getWorkspaceProduct(workspaceId, productId);
  if (!prod) return null;
  prod.is_archived = false;
  prod.status = 'draft';
  await saveWorkspaceProduct(workspaceId, prod);
  return prod;
}

export async function bulkArchiveWorkspaceProducts(workspaceId: string, productIds: string[]): Promise<number> {
  let count = 0;
  for (const id of productIds) {
    const res = await archiveWorkspaceProduct(workspaceId, id);
    if (res) count++;
  }
  return count;
}

export async function bulkRestoreWorkspaceProducts(workspaceId: string, productIds: string[]): Promise<number> {
  let count = 0;
  for (const id of productIds) {
    const res = await restoreWorkspaceProduct(workspaceId, id);
    if (res) count++;
  }
  return count;
}

// ==============================================================================
// 1c. VARIANT MANAGEMENT (Never Flattened)
// ==============================================================================

export async function addWorkspaceProductVariant(
  workspaceId: string,
  productId: string,
  variant: Partial<ProductVariant>
): Promise<{ ok: boolean; product?: Product; error?: string }> {
  const prod = await getWorkspaceProduct(workspaceId, productId);
  if (!prod) return { ok: false, error: 'Product not found in this workspace' };

  const newVariant: ProductVariant = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
    product_id: productId,
    name: variant.name || 'Nuova Variante',
    sku: variant.sku || null,
    ean: variant.ean || null,
    price: variant.price !== undefined ? variant.price : prod.price,
    original_price: variant.original_price !== undefined ? variant.original_price : prod.original_price,
    stock_quantity: variant.stock_quantity !== undefined ? variant.stock_quantity : 10,
    availability: (variant.stock_quantity ?? 10) > 0 ? 'InStock' : 'OutOfStock',
    expiry_date: variant.expiry_date || null,
    available_online: variant.available_online ?? true,
    raw_data: variant.raw_data || {},
  };

  prod.variants = prod.variants || [];
  prod.variants.push(newVariant);
  const saveRes = await saveWorkspaceProduct(workspaceId, prod);
  return saveRes;
}

export async function updateWorkspaceProductVariant(
  workspaceId: string,
  productId: string,
  variantId: string,
  updates: Partial<ProductVariant>
): Promise<{ ok: boolean; product?: Product; error?: string }> {
  const prod = await getWorkspaceProduct(workspaceId, productId);
  if (!prod) return { ok: false, error: 'Product not found in this workspace' };

  prod.variants = prod.variants || [];
  const idx = prod.variants.findIndex((v) => v.id === variantId || String(v.variant_id) === variantId);
  if (idx < 0) return { ok: false, error: 'Variant not found' };

  prod.variants[idx] = {
    ...prod.variants[idx],
    ...updates,
    availability: (updates.stock_quantity ?? prod.variants[idx].stock_quantity ?? 0) > 0 ? 'InStock' : 'OutOfStock',
    updated_at: new Date().toISOString(),
  };

  const saveRes = await saveWorkspaceProduct(workspaceId, prod);
  return saveRes;
}

export async function deleteWorkspaceProductVariant(
  workspaceId: string,
  productId: string,
  variantId: string
): Promise<{ ok: boolean; product?: Product; error?: string }> {
  const prod = await getWorkspaceProduct(workspaceId, productId);
  if (!prod) return { ok: false, error: 'Product not found in this workspace' };

  prod.variants = (prod.variants || []).filter((v) => v.id !== variantId && String(v.variant_id) !== variantId);
  const saveRes = await saveWorkspaceProduct(workspaceId, prod);
  return saveRes;
}

// ==============================================================================
// 2. SUPPLIERS (Global Reusable + Workspace-Specific)
// ==============================================================================

export async function listWorkspaceSuppliers(workspaceId: string): Promise<Supplier[]> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        // Query global suppliers OR suppliers belonging to this workspace
        const { data, error } = await client
          .from('suppliers')
          .select('*')
          .or(`is_global.eq.true,workspace_id.eq.${workspaceId}`);

        if (!error && Array.isArray(data)) {
          return data.map((row: any) => ({
            id: row.id,
            name: row.name,
            baseUrl: row.base_url,
            logoText: row.logo_text || row.name.slice(0, 2).toUpperCase(),
            status: row.is_active ? 'active' : 'disabled',
            lastSyncAt: row.last_sync_at,
            productCount: row.product_count || 0,
            failedCount: 0,
            description: row.description || '',
            isGlobal: Boolean(row.is_global),
            is_global: Boolean(row.is_global),
            workspaceId: row.workspace_id,
            workspace_id: row.workspace_id,
            fetchMethod: row.config?.fetchMethod || row.config?.fetch_method || 'direct',
            fetch_method: row.config?.fetchMethod || row.config?.fetch_method || 'direct',
            jsRender: Boolean(row.config?.jsRender ?? row.config?.js_render ?? false),
            js_render: Boolean(row.config?.jsRender ?? row.config?.js_render ?? false),
            connected: row.config?.connected !== false,
            shippingCost: row.config?.shippingCost ?? row.config?.shipping_cost ?? 0,
            shipping_cost: row.config?.shippingCost ?? row.config?.shipping_cost ?? 0,
            stockThreshold: row.config?.stockThreshold ?? row.config?.stock_threshold ?? 5,
            stock_threshold: row.config?.stockThreshold ?? row.config?.stock_threshold ?? 5,
            pricingRule: row.config?.pricingRule || row.config?.pricing_rule || undefined,
            pricing_rule: row.config?.pricingRule || row.config?.pricing_rule || undefined,
            parserConfig: row.config?.parserConfig || row.config?.parser_config || undefined,
            parser_config: row.config?.parserConfig || row.config?.parser_config || undefined,
            supportedFeatures: row.config?.features || {
              sitemap: true,
              variants: true,
              lotExpiry: true,
              liveScraping: true,
              htmlImport: true,
            },
          }));
        }
      }
    } catch {
      // Fallback
    }
  }

  // Combine global reusable suppliers with workspace-specific suppliers
  const custom = workspaceSuppliersStore.get(workspaceId) || [];
  return [...globalSuppliers, ...custom];
}

export async function saveWorkspaceSupplier(
  workspaceId: string,
  supplier: Supplier,
  userRole: WorkspaceRole = 'admin'
): Promise<{ ok: boolean; supplier?: Supplier; error?: string }> {
  if (!hasMinimumRole(userRole, 'manager')) {
    return { ok: false, error: 'Access Denied: Role manager or higher is required to manage suppliers.' };
  }

  // Prevent modifying global suppliers directly
  const isGlobal = globalSuppliers.some((s) => s.id === supplier.id);
  if (isGlobal) {
    return { ok: false, error: 'Access Denied: Global reusable suppliers are system-wide and cannot be modified.' };
  }

  const normalizedSupplier: Supplier = {
    ...supplier,
    id: supplier.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12)),
    workspaceId,
    workspace_id: workspaceId,
    isGlobal: false,
    is_global: false,
    fetchMethod: supplier.fetchMethod || supplier.fetch_method || 'direct',
    jsRender: supplier.jsRender ?? supplier.js_render ?? false,
    connected: supplier.connected !== false,
    shippingCost: supplier.shippingCost ?? supplier.shipping_cost ?? 0,
    packagingCost: supplier.packagingCost ?? supplier.packaging_cost ?? 0,
    packaging_cost: supplier.packagingCost ?? supplier.packaging_cost ?? 0,
    defaultEbayQuantity: supplier.defaultEbayQuantity ?? supplier.default_ebay_quantity ?? 3,
    default_ebay_quantity: supplier.defaultEbayQuantity ?? supplier.default_ebay_quantity ?? 3,
    monitoringIntervalMinutes: supplier.monitoringIntervalMinutes ?? supplier.monitoring_interval_minutes ?? 360,
    monitoring_interval_minutes: supplier.monitoringIntervalMinutes ?? supplier.monitoring_interval_minutes ?? 360,
    stockThreshold: supplier.stockThreshold ?? supplier.stock_threshold ?? 5,
    status: supplier.status || 'active',
    productCount: supplier.productCount ?? 0,
    failedCount: supplier.failedCount ?? 0,
    lastSyncAt: supplier.lastSyncAt || new Date().toISOString(),
    supportedFeatures: supplier.supportedFeatures || {
      sitemap: true,
      variants: true,
      lotExpiry: true,
      liveScraping: true,
      htmlImport: true,
    },
  };

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const payload = {
          id: normalizedSupplier.id,
          workspace_id: workspaceId,
          name: normalizedSupplier.name,
          base_url: normalizedSupplier.baseUrl,
          logo_text: normalizedSupplier.logoText,
          is_active: normalizedSupplier.status === 'active',
          is_global: false,
          description: normalizedSupplier.description,
          config: {
            features: normalizedSupplier.supportedFeatures,
            fetchMethod: normalizedSupplier.fetchMethod,
            jsRender: normalizedSupplier.jsRender,
            connected: normalizedSupplier.connected,
            shippingCost: normalizedSupplier.shippingCost,
            stockThreshold: normalizedSupplier.stockThreshold,
            pricingRule: normalizedSupplier.pricingRule || normalizedSupplier.pricing_rule,
            parserConfig: normalizedSupplier.parserConfig || normalizedSupplier.parser_config,
          },
        };
        await client.from('suppliers').upsert(payload, { onConflict: 'id' });
      }
    } catch {
      // Fallback
    }
  }

  const customList = workspaceSuppliersStore.get(workspaceId) || [];
  const existingIdx = customList.findIndex((s) => s.id === normalizedSupplier.id);
  if (existingIdx >= 0) {
    customList[existingIdx] = normalizedSupplier;
  } else {
    customList.push(normalizedSupplier);
  }
  workspaceSuppliersStore.set(workspaceId, customList);

  return { ok: true, supplier: normalizedSupplier };
}

export async function toggleWorkspaceSupplierConnection(
  workspaceId: string,
  supplierId: string,
  connected: boolean,
  userRole: WorkspaceRole
): Promise<{ ok: boolean; supplier?: Supplier; error?: string }> {
  if (!hasMinimumRole(userRole, 'manager')) {
    return { ok: false, error: 'Access Denied: Role manager or higher is required.' };
  }

  const customList = workspaceSuppliersStore.get(workspaceId) || [];
  let supplier = customList.find((s) => s.id === supplierId);

  if (!supplier) {
    const globalS = globalSuppliers.find((s) => s.id === supplierId);
    if (globalS) {
      supplier = {
        ...globalS,
        connected,
        status: connected ? 'active' : 'disabled',
        workspaceId,
        isGlobal: false,
      };
      customList.push(supplier);
    } else {
      return { ok: false, error: 'Supplier not found' };
    }
  } else {
    supplier.connected = connected;
    supplier.status = connected ? 'active' : 'disabled';
  }

  workspaceSuppliersStore.set(workspaceId, customList);
  return { ok: true, supplier };
}

export async function deleteWorkspaceSupplier(
  workspaceId: string,
  supplierId: string,
  userRole: WorkspaceRole
): Promise<{ ok: boolean; error?: string }> {
  if (!hasMinimumRole(userRole, 'admin')) {
    return { ok: false, error: 'Access Denied: Role admin or higher is required to delete suppliers.' };
  }

  // Prevent deleting global suppliers
  if (globalSuppliers.some((s) => s.id === supplierId)) {
    return { ok: false, error: 'Access Denied: Global reusable suppliers cannot be deleted.' };
  }

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        await client.from('suppliers').delete().eq('id', supplierId).eq('workspace_id', workspaceId);
      }
    } catch {
      // Fallback
    }
  }

  const customList = workspaceSuppliersStore.get(workspaceId) || [];
  const filtered = customList.filter((s) => s.id !== supplierId);
  if (filtered.length === customList.length) {
    return { ok: false, error: 'Supplier not found in this workspace.' };
  }
  workspaceSuppliersStore.set(workspaceId, filtered);
  return { ok: true };
}

// ==============================================================================
// 2b. FETCHING & PARSING TEST MODE
// ==============================================================================

export async function fetchHtmlForWorkspace(
  url: string,
  fetchMethod: 'direct' | 'zenrows' = 'direct',
  jsRender: boolean = false
): Promise<{ ok: boolean; html?: string; error?: string }> {
  if (fetchMethod === 'zenrows' && isZenRowsConfigured()) {
    const res = await fetchWithZenRows(url, { jsRender });
    if (res.ok && res.html) {
      return { ok: true, html: res.html };
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const html = await res.text();
    if (isCloudflareChallenge(html, res.status)) {
      if (fetchMethod !== 'zenrows' && isZenRowsConfigured()) {
        const zRes = await fetchWithZenRows(url, { jsRender });
        if (zRes.ok && zRes.html) {
          return { ok: true, html: zRes.html };
        }
      }
      return { ok: false, error: CLOUDFLARE_ERROR_MESSAGE };
    }

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    return { ok: true, html };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Network error fetching product page' };
  }
}

export async function testSupplierParser(
  workspaceId: string,
  url: string,
  supplierId?: string,
  customConfig?: SupplierParserConfig,
  fetchMethod: 'direct' | 'zenrows' = 'direct',
  jsRender: boolean = false
): Promise<{
  ok: boolean;
  product?: Product;
  detectedFields?: {
    title: string | null;
    price: number | null;
    brand: string | null;
    sku: string | null;
    ean: string | null;
    variantsCount: number;
    imagesCount: number;
  };
  error?: string;
}> {
  const suppliers = await listWorkspaceSuppliers(workspaceId);
  const matchedSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;

  const effectiveSupplier: Supplier = matchedSupplier
    ? {
        ...matchedSupplier,
        parserConfig: customConfig || matchedSupplier.parserConfig,
      }
    : {
        id: 'test_supplier',
        name: 'Test Supplier',
        baseUrl: url,
        logoText: 'TST',
        status: 'active',
        lastSyncAt: null,
        productCount: 0,
        failedCount: 0,
        description: 'Test Mode',
        parserConfig: customConfig,
        supportedFeatures: {
          sitemap: true,
          variants: true,
          lotExpiry: true,
          liveScraping: true,
          htmlImport: true,
        },
      };

  const method = fetchMethod || effectiveSupplier.fetchMethod || 'direct';
  const render = jsRender ?? effectiveSupplier.jsRender ?? false;

  const fetchRes = await fetchHtmlForWorkspace(url, method, render);
  if (!fetchRes.ok || !fetchRes.html) {
    return { ok: false, error: fetchRes.error || 'Failed to fetch product URL.' };
  }

  try {
    const product = parseProductWithSupplierFallback(fetchRes.html, url, effectiveSupplier, suppliers);
    return {
      ok: true,
      product,
      detectedFields: {
        title: product.title || null,
        price: typeof product.price === 'number' ? product.price : null,
        brand: product.brand || null,
        sku: product.sku || null,
        ean: product.ean || null,
        variantsCount: product.variants?.length || 0,
        imagesCount: product.images?.length || 0,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Parser execution error' };
  }
}

// ==============================================================================
// 2c. PRODUCT IMPORTING (Single URL & Background Jobs with Duplicate Check)
// ==============================================================================

export async function importSingleProductUrl(
  workspaceId: string,
  url: string,
  supplierId?: string,
  fetchMethod: 'direct' | 'zenrows' = 'direct',
  jsRender: boolean = false
): Promise<{ ok: boolean; product?: Product; isDuplicate?: boolean; error?: string }> {
  const normalizedUrl = normalizeProductUrl(url);

  // 1. Workspace Duplicate Check: Check if URL already exists in this workspace
  const existingProducts = await listWorkspaceProducts(workspaceId);
  const duplicate = existingProducts.find((p) => normalizeProductUrl(p.url) === normalizedUrl);
  if (duplicate) {
    return {
      ok: false,
      isDuplicate: true,
      error: `Duplicate product: This URL was already imported in this workspace (${duplicate.title}).`,
      product: duplicate,
    };
  }

  const suppliers = await listWorkspaceSuppliers(workspaceId);
  const matchedSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  const method = fetchMethod || matchedSupplier?.fetchMethod || 'direct';
  const render = jsRender ?? matchedSupplier?.jsRender ?? false;

  const fetchRes = await fetchHtmlForWorkspace(normalizedUrl, method, render);
  if (!fetchRes.ok || !fetchRes.html) {
    await addWorkspaceImportHistory(workspaceId, {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      url: normalizedUrl,
      title: normalizedUrl,
      source: 'live_scraper',
      status: 'failed',
      message: fetchRes.error || 'Fetch failure',
      timestamp: new Date().toISOString(),
      supplier_id: supplierId,
    });
    return { ok: false, error: fetchRes.error || 'Fetch failure' };
  }

  try {
    const product = parseProductWithSupplierFallback(fetchRes.html, normalizedUrl, matchedSupplier, suppliers, 'live_scraper');
    // Ensure Draft status and workspace scoping
    product.workspace_id = workspaceId;
    product.status = 'draft';
    product.ebay_status = 'not_listed';

    const saveRes = await saveWorkspaceProduct(workspaceId, product);
    if (!saveRes.ok) {
      return { ok: false, error: saveRes.error || 'Failed to save imported product.' };
    }

    await addWorkspaceImportHistory(workspaceId, {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      url: normalizedUrl,
      title: product.title || 'Nuovo Prodotto',
      source: 'live_scraper',
      status: 'success',
      message: `Imported successfully with ${product.variants?.length || 0} variants as Draft.`,
      timestamp: new Date().toISOString(),
      supplier_id: product.supplier_id,
    });

    return { ok: true, product: saveRes.product };
  } catch (err: any) {
    await addWorkspaceImportHistory(workspaceId, {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      url: normalizedUrl,
      title: normalizedUrl,
      source: 'live_scraper',
      status: 'failed',
      message: err.message || 'Parser error',
      timestamp: new Date().toISOString(),
      supplier_id: supplierId,
    });
    return { ok: false, error: err.message || 'Parser error' };
  }
}

export function getWorkspaceImportJobs(workspaceId: string): ImportJob[] {
  return [...(workspaceImportJobsStore.get(workspaceId) || [])];
}

export function getWorkspaceImportJob(workspaceId: string, jobId: string): ImportJob | null {
  const jobs = workspaceImportJobsStore.get(workspaceId) || [];
  return jobs.find((j) => j.id === jobId) || null;
}

export function createWorkspaceImportJob(
  workspaceId: string,
  urls: string[],
  supplierId?: string,
  fetchMethod: 'direct' | 'zenrows' = 'direct',
  jsRender: boolean = false
): ImportJob {
  const cleanUrls = urls.map((u) => u.trim()).filter((u) => Boolean(u));
  const job: ImportJob = {
    id: 'job_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12)),
    workspaceId,
    status: 'running',
    total: cleanUrls.length,
    completed: 0,
    successful: 0,
    failed: 0,
    duplicates: 0,
    items: cleanUrls.map((u) => ({
      url: u,
      status: 'pending',
      supplierId,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const list = workspaceImportJobsStore.get(workspaceId) || [];
  list.unshift(job);
  if (list.length > 25) list.pop();
  workspaceImportJobsStore.set(workspaceId, list);

  // Execute processing asynchronously in background so client disconnect does not abort job
  processWorkspaceImportJob(job, supplierId, fetchMethod, jsRender).catch((err) => {
    console.error(`Import job error (${job.id}):`, err);
  });

  return job;
}

async function processWorkspaceImportJob(
  job: ImportJob,
  supplierId?: string,
  fetchMethod: 'direct' | 'zenrows' = 'direct',
  jsRender: boolean = false
): Promise<void> {
  const suppliers = await listWorkspaceSuppliers(job.workspaceId);
  const matchedSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  const method = fetchMethod || matchedSupplier?.fetchMethod || 'direct';
  const render = jsRender ?? matchedSupplier?.jsRender ?? false;

  for (const item of job.items) {
    item.status = 'processing';
    job.updatedAt = new Date().toISOString();

    const normalizedUrl = normalizeProductUrl(item.url);

    // Duplicate check
    const existingProducts = await listWorkspaceProducts(job.workspaceId);
    const isDup = existingProducts.some((p) => normalizeProductUrl(p.url) === normalizedUrl);
    if (isDup) {
      item.status = 'duplicate';
      item.isDuplicate = true;
      item.error = 'Duplicate: already imported in this workspace.';
      job.duplicates++;
      job.completed++;
      job.updatedAt = new Date().toISOString();
      continue;
    }

    // Fetch
    const fetchRes = await fetchHtmlForWorkspace(normalizedUrl, method, render);
    if (!fetchRes.ok || !fetchRes.html) {
      item.status = 'failed';
      item.error = fetchRes.error || 'Fetch failure';
      job.failed++;
      job.completed++;
      job.updatedAt = new Date().toISOString();

      await addWorkspaceImportHistory(job.workspaceId, {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        url: normalizedUrl,
        title: normalizedUrl,
        source: 'live_scraper',
        status: 'failed',
        message: fetchRes.error || 'Fetch failure',
        timestamp: new Date().toISOString(),
        supplier_id: supplierId,
      });
      continue;
    }

    // Parse & Save
    try {
      const product = parseProductWithSupplierFallback(fetchRes.html, normalizedUrl, matchedSupplier, suppliers, 'live_scraper');
      product.workspace_id = job.workspaceId;
      product.status = 'draft';
      product.ebay_status = 'not_listed';

      const saveRes = await saveWorkspaceProduct(job.workspaceId, product);
      if (saveRes.ok) {
        item.status = 'success';
        item.product = saveRes.product;
        job.successful++;
        job.completed++;

        await addWorkspaceImportHistory(job.workspaceId, {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
          url: normalizedUrl,
          title: product.title || 'Nuovo Prodotto',
          source: 'live_scraper',
          status: 'success',
          message: `Imported successfully with ${product.variants?.length || 0} variants as Draft.`,
          timestamp: new Date().toISOString(),
          supplier_id: product.supplier_id,
        });
      } else {
        item.status = 'failed';
        item.error = saveRes.error || 'Database save error';
        job.failed++;
        job.completed++;
      }
    } catch (err: any) {
      item.status = 'failed';
      item.error = err.message || 'Parsing error';
      job.failed++;
      job.completed++;
    }

    job.updatedAt = new Date().toISOString();
  }

  job.status = job.failed > 0 && job.successful === 0 ? 'failed' : 'completed';
  job.updatedAt = new Date().toISOString();
}


// ==============================================================================
// 3. EBAY ACCOUNTS & CREDENTIALS ISOLATION
// ==============================================================================

export async function getWorkspaceEbayStatus(workspaceId: string): Promise<{
  connected: boolean;
  environment: 'PRODUCTION' | 'SANDBOX';
  sellerUsername: string | null;
  expiresAt: string | null;
}> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        // Query safe non-credential columns only
        const { data, error } = await client
          .from('ebay_accounts')
          .select('connected, environment, seller_username, token_expires_at')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (!error && data) {
          const isExpired = data.token_expires_at ? new Date(data.token_expires_at).getTime() < Date.now() : true;
          return {
            connected: Boolean(data.connected && !isExpired),
            environment: data.environment || 'PRODUCTION',
            sellerUsername: data.seller_username,
            expiresAt: data.token_expires_at,
          };
        }
      }
    } catch {
      // Fallback
    }
  }

  const account = workspaceEbayAccountsStore.get(workspaceId);
  if (!account || !account.accessToken || account.expiresAt <= Date.now()) {
    return {
      connected: false,
      environment: 'PRODUCTION',
      sellerUsername: null,
      expiresAt: null,
    };
  }

  return {
    connected: true,
    environment: account.environment,
    sellerUsername: account.sellerUsername,
    expiresAt: new Date(account.expiresAt).toISOString(),
  };
}

export async function saveWorkspaceEbayTokens(
  workspaceId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    environment: 'PRODUCTION' | 'SANDBOX';
    sellerUsername: string;
    clientId?: string;
  }
): Promise<void> {
  const expiresAt = Date.now() + (tokens.expiresIn || 7200) * 1000;
  const tokenRecord: EbayAccountData = {
    workspaceId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    environment: tokens.environment,
    sellerUsername: tokens.sellerUsername,
  };

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        await client.from('ebay_accounts').upsert(
          {
            workspace_id: workspaceId,
            client_id: tokens.clientId || 'EBAY_CLIENT',
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            environment: tokens.environment,
            seller_username: tokens.sellerUsername,
            connected: true,
            token_expires_at: new Date(expiresAt).toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id' }
        );
      }
    } catch {
      // Fallback
    }
  }

  workspaceEbayAccountsStore.set(workspaceId, tokenRecord);
}

export async function getWorkspaceEbayTokensForPublishing(workspaceId: string): Promise<{
  accessToken: string;
  environment: 'PRODUCTION' | 'SANDBOX';
} | null> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { data } = await client
          .from('ebay_accounts')
          .select('access_token, environment, token_expires_at')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (data && data.access_token) {
          const isExpired = data.token_expires_at ? new Date(data.token_expires_at).getTime() < Date.now() : false;
          if (!isExpired) {
            return {
              accessToken: data.access_token,
              environment: data.environment || 'PRODUCTION',
            };
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  const account = workspaceEbayAccountsStore.get(workspaceId);
  if (account && account.accessToken && account.expiresAt > Date.now()) {
    return {
      accessToken: account.accessToken,
      environment: account.environment,
    };
  }
  return null;
}

// ==============================================================================
// 4. EBAY LISTINGS
// ==============================================================================

export async function listWorkspaceEbayListings(workspaceId: string): Promise<EbayListing[]> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { data, error } = await client
          .from('ebay_listings')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          return data;
        }
      }
    } catch {
      // Fallback
    }
  }

  return [...(workspaceEbayListingsStore.get(workspaceId) || [])];
}

export async function saveWorkspaceEbayListing(
  workspaceId: string,
  listing: EbayListing
): Promise<{ ok: boolean; listing: EbayListing; error?: string }> {
  const scopedListing: EbayListing = {
    ...listing,
    created_at: listing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const payload = {
          ...scopedListing,
          workspace_id: workspaceId, // Strictly scoped
        };
        const { error } = await client.from('ebay_listings').upsert(payload, { onConflict: 'id' });
        if (error) {
          return { ok: false, listing: scopedListing, error: error.message };
        }
        return { ok: true, listing: scopedListing };
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceEbayListingsStore.get(workspaceId) || [];
  const existingIdx = list.findIndex((l) => l.id === scopedListing.id);
  if (existingIdx >= 0) {
    list[existingIdx] = scopedListing;
  } else {
    list.unshift(scopedListing);
  }
  workspaceEbayListingsStore.set(workspaceId, list);
  return { ok: true, listing: scopedListing };
}

export async function deleteWorkspaceEbayListing(workspaceId: string, listingId: string): Promise<boolean> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { error } = await client
          .from('ebay_listings')
          .delete()
          .eq('id', listingId)
          .eq('workspace_id', workspaceId);
        if (!error) return true;
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceEbayListingsStore.get(workspaceId) || [];
  const filtered = list.filter((l) => l.id !== listingId);
  const deleted = filtered.length < list.length;
  workspaceEbayListingsStore.set(workspaceId, filtered);
  return deleted;
}

// ==============================================================================
// 5. ORDERS & FULFILLMENT FOUNDATION (Phase 1.6A)
// ==============================================================================

export interface OrderFilters {
  status?: string;
  supplierId?: string;
  deliveryStatus?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function listWorkspaceOrders(
  workspaceId: string,
  filters?: OrderFilters
): Promise<Order[]> {
  let allOrders: Order[] = [];

  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        let query = client
          .from('orders')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (filters?.status && filters.status !== 'all') {
          query = query.eq('status', filters.status);
        }
        if (filters?.supplierId && filters.supplierId !== 'all') {
          query = query.eq('supplier_id', filters.supplierId);
        }
        if (filters?.deliveryStatus && filters.deliveryStatus !== 'all') {
          query = query.eq('delivery_status', filters.deliveryStatus);
        }
        if (filters?.startDate) {
          query = query.gte('created_at', filters.startDate);
        }
        if (filters?.endDate) {
          query = query.lte('created_at', filters.endDate);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          allOrders = data.map((row: any) => normalizeOrderRecord(row));
        }
      }
    } catch {
      // Fallback
    }
  }

  if (allOrders.length === 0) {
    allOrders = [...(workspaceOrdersStore.get(workspaceId) || [])];
  }

  // Apply filters to in-memory/results
  if (filters) {
    const { status, supplierId, deliveryStatus, startDate, endDate, search } = filters;
    allOrders = allOrders.filter((order) => {
      if (status && status !== 'all') {
        if (order.status !== status) return false;
      }
      if (supplierId && supplierId !== 'all') {
        const matchesOrder = order.supplier_id === supplierId;
        const matchesItem = order.items?.some((i) => i.supplier_id === supplierId);
        if (!matchesOrder && !matchesItem) return false;
      }
      if (deliveryStatus && deliveryStatus !== 'all') {
        if (order.delivery_status !== deliveryStatus) return false;
      }
      if (startDate) {
        if (new Date(order.created_at).getTime() < new Date(startDate).getTime()) return false;
      }
      if (endDate) {
        if (new Date(order.created_at).getTime() > new Date(endDate).getTime()) return false;
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesNumber = order.order_number?.toLowerCase().includes(q);
        const matchesExternal = order.external_order_id?.toLowerCase().includes(q);
        const matchesEbay = order.ebay_order_id?.toLowerCase().includes(q);
        const matchesBuyer = (
          (order.buyer_name || '') +
          ' ' +
          (order.buyer_username || '') +
          ' ' +
          (order.buyer_email || '')
        ).toLowerCase().includes(q);
        const matchesTracking = order.tracking_number?.toLowerCase().includes(q);
        const matchesSupplierRef = order.supplier_order_reference?.toLowerCase().includes(q);
        const matchesItems = order.items?.some(
          (i) =>
            i.title?.toLowerCase().includes(q) ||
            i.sku?.toLowerCase().includes(q) ||
            i.ean?.toLowerCase().includes(q) ||
            i.variant_name?.toLowerCase().includes(q)
        );

        if (!matchesNumber && !matchesExternal && !matchesEbay && !matchesBuyer && !matchesTracking && !matchesSupplierRef && !matchesItems) {
          return false;
        }
      }
      return true;
    });
  }

  return allOrders;
}

export async function getWorkspaceOrder(
  workspaceId: string,
  orderId: string
): Promise<Order | null> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { data, error } = await client
          .from('orders')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', orderId)
          .maybeSingle();

        if (!error && data) {
          return normalizeOrderRecord(data);
        }
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceOrdersStore.get(workspaceId) || [];
  return list.find((o) => o.id === orderId) || null;
}

export async function saveWorkspaceOrder(
  workspaceId: string,
  order: Partial<Order>,
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const orderId = order.id || (crypto.randomUUID ? crypto.randomUUID() : `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

  // Normalize items
  const rawItems = Array.isArray(order.items) ? order.items : [];
  const normalizedItems: OrderLineItem[] = rawItems.map((item, idx) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const cost = Math.max(0, Number(item.purchase_cost ?? item.supplier_cost) || 0);
    const price = Math.max(0, Number(item.selling_price ?? item.sale_price) || 0);
    return {
      ...item,
      id: item.id || `item-${orderId}-${idx + 1}`,
      order_id: orderId,
      quantity: qty,
      purchase_cost: cost,
      selling_price: price,
      supplier_cost: cost,
      sale_price: price,
      supplier_status: item.supplier_status || 'not_ordered',
    };
  });

  // Calculate order-level financials
  const financials = calculateOrderFinancials(normalizedItems, {
    shippingChargedToBuyer: order.shipping_charged_to_buyer,
    supplierShippingCost: order.supplier_shipping_cost,
    packagingCost: order.packaging_cost,
    refundAmount: order.refund_amount,
  });

  // Check duplicate external_order_id in same workspace
  const externalId = (order.external_order_id || '').trim();
  if (externalId) {
    // 1. In Supabase
    const config = getWorkspaceConfig();
    if (config.supabaseUrl && config.serviceRoleKey) {
      try {
        const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
        if (client) {
          const { data, error } = await client
            .from('orders')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('external_order_id', externalId)
            .neq('id', orderId)
            .maybeSingle();

          if (!error && data) {
            return {
              ok: false,
              error: `Duplicate external order ID "${externalId}" already exists in this workspace.`,
            };
          }
        }
      } catch {
        // Fallback
      }
    }

    // 2. In-memory
    const existingList = workspaceOrdersStore.get(workspaceId) || [];
    const duplicate = existingList.find(
      (o) => o.id !== orderId && o.external_order_id?.trim().toLowerCase() === externalId.toLowerCase()
    );
    if (duplicate) {
      return {
        ok: false,
        error: `Duplicate external order ID "${externalId}" already exists in this workspace.`,
      };
    }
  }

  // Check if updating existing order to preserve created_at and audit trail
  const existingOrder = await getWorkspaceOrder(workspaceId, orderId);
  const now = new Date().toISOString();
  const createdAt = existingOrder ? existingOrder.created_at : order.created_at || now;

  // Audit events
  const events: OrderEvent[] = Array.isArray(order.events)
    ? [...order.events]
    : existingOrder?.events
    ? [...existingOrder.events]
    : [];

  if (!existingOrder) {
    events.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-1`,
      order_id: orderId,
      timestamp: now,
      actor: actor || 'system',
      event_type: 'created',
      description: 'Ordine creato manualmente',
      data: {
        itemCount: normalizedItems.length,
        totalRevenue: financials.totalRevenue,
      },
    });
  }

  // Detect status change for audit log
  if (existingOrder && order.status && order.status !== existingOrder.status) {
    events.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      order_id: orderId,
      timestamp: now,
      actor: actor || 'system',
      event_type: 'status_changed',
      description: `Stato ordine modificato da ${existingOrder.status} a ${order.status}`,
      data: { oldStatus: existingOrder.status, newStatus: order.status },
    });
  }

  // Derive supplier_id if not explicitly set
  const supplierId =
    order.supplier_id ||
    normalizedItems[0]?.supplier_id ||
    'pluspower';
  const supplierName =
    order.supplier_name ||
    normalizedItems[0]?.supplier_name ||
    (supplierId === 'pluspower' ? 'PlusPower Supplements' : 'Fornitore');

  // Build full scoped order
  const scopedOrder: Order = {
    ...existingOrder,
    ...order,
    id: orderId,
    workspace_id: workspaceId,
    order_number:
      order.order_number ||
      existingOrder?.order_number ||
      `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    external_order_id: externalId || null,
    ebay_order_id: order.ebay_order_id ?? existingOrder?.ebay_order_id ?? null,
    order_source: order.order_source || existingOrder?.order_source || 'manual',
    buyer_username: order.buyer_username ?? existingOrder?.buyer_username ?? '',
    buyer_name: order.buyer_name ?? existingOrder?.buyer_name ?? '',
    buyer_email: order.buyer_email ?? existingOrder?.buyer_email ?? '',
    buyer_phone: order.buyer_phone ?? existingOrder?.buyer_phone ?? '',
    shipping_address: order.shipping_address ?? existingOrder?.shipping_address ?? {},
    status: (order.status || existingOrder?.status || 'pending') as OrderStatus,
    supplier_purchasing_status:
      order.supplier_purchasing_status ?? existingOrder?.supplier_purchasing_status ?? 'not_purchased',
    delivery_status:
      order.delivery_status ?? existingOrder?.delivery_status ?? 'unfulfilled',
    items: normalizedItems,
    currency: order.currency || existingOrder?.currency || 'EUR',
    total_paid: financials.totalRevenue,
    shipping_charged_to_buyer: financials.shippingChargedToBuyer,
    supplier_shipping_cost: financials.supplierShippingCost,
    packaging_cost: financials.packagingCost,
    estimated_ebay_fees: financials.estimatedEbayFees,
    total_cost: financials.totalCost,
    net_profit: financials.netProfit,
    profit_margin: financials.profitMargin,
    supplier_id: supplierId,
    supplier_name: supplierName,
    supplier_order_reference: order.supplier_order_reference ?? existingOrder?.supplier_order_reference ?? null,
    supplier_purchased_at: order.supplier_purchased_at ?? existingOrder?.supplier_purchased_at ?? null,
    supplier_notes: order.supplier_notes ?? existingOrder?.supplier_notes ?? null,
    carrier: order.carrier ?? existingOrder?.carrier ?? null,
    tracking_number: order.tracking_number ?? existingOrder?.tracking_number ?? null,
    tracking_url: order.tracking_url ?? existingOrder?.tracking_url ?? null,
    dispatched_at: order.dispatched_at ?? existingOrder?.dispatched_at ?? null,
    delivered_at: order.delivered_at ?? existingOrder?.delivered_at ?? null,
    cancellation_reason: order.cancellation_reason ?? existingOrder?.cancellation_reason ?? null,
    cancelled_at: order.cancelled_at ?? existingOrder?.cancelled_at ?? null,
    return_status: order.return_status ?? existingOrder?.return_status ?? 'none',
    return_reason: order.return_reason ?? existingOrder?.return_reason ?? null,
    returned_at: order.returned_at ?? existingOrder?.returned_at ?? null,
    refund_amount: financials.totalRefunds,
    refund_reason: order.refund_reason ?? existingOrder?.refund_reason ?? null,
    refunded_at: order.refunded_at ?? existingOrder?.refunded_at ?? null,
    refunds: order.refunds ?? existingOrder?.refunds ?? [],
    events,
    notes: order.notes ?? existingOrder?.notes ?? null,
    inventory_reserved: order.inventory_reserved ?? existingOrder?.inventory_reserved ?? false,
    inventory_deducted: order.inventory_deducted ?? existingOrder?.inventory_deducted ?? false,
    created_at: createdAt,
    updated_at: now,
  };

  // Phase 1.7: Inventory reservation & deduction lifecycle
  const isNewOrder = !existingOrder;
  if (isNewOrder) {
    if (scopedOrder.status === 'shipped' || scopedOrder.status === 'delivered') {
      await deductShippedOrderInventory(workspaceId, scopedOrder, actor);
      scopedOrder.inventory_deducted = true;
      scopedOrder.inventory_reserved = false;
    } else if (scopedOrder.status !== 'cancelled') {
      await applyOrderInventoryReservation(workspaceId, scopedOrder, actor);
      scopedOrder.inventory_reserved = true;
      scopedOrder.inventory_deducted = false;
    }
  } else {
    // Existing order transitions
    if (existingOrder.status !== 'cancelled' && scopedOrder.status === 'cancelled') {
      await releaseOrderInventoryReservation(workspaceId, existingOrder, actor);
      scopedOrder.inventory_reserved = false;
    } else if (
      existingOrder.status !== 'shipped' &&
      existingOrder.status !== 'delivered' &&
      (scopedOrder.status === 'shipped' || scopedOrder.status === 'delivered')
    ) {
      await deductShippedOrderInventory(workspaceId, existingOrder, actor);
      scopedOrder.inventory_deducted = true;
      scopedOrder.inventory_reserved = false;
    }
  }

  // 1. Supabase persistence
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const payload = {
          ...scopedOrder,
          workspace_id: workspaceId,
        };
        const { error } = await client.from('orders').upsert(payload, { onConflict: 'id' });
        if (error) {
          console.warn('Supabase order upsert warning:', error.message);
        }
      }
    } catch (err: any) {
      console.warn('Supabase order upsert exception:', err.message);
    }
  }

  // 2. In-memory store persistence
  const list = workspaceOrdersStore.get(workspaceId) || [];
  const existingIdx = list.findIndex((o) => o.id === scopedOrder.id);
  if (existingIdx >= 0) {
    list[existingIdx] = scopedOrder;
  } else {
    list.unshift(scopedOrder);
  }
  workspaceOrdersStore.set(workspaceId, list);

  return { ok: true, order: scopedOrder };
}

export async function createWorkspaceOrder(
  workspaceId: string,
  orderData: Partial<Order>,
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  return saveWorkspaceOrder(workspaceId, orderData, actor);
}

export async function cancelWorkspaceOrder(
  workspaceId: string,
  orderId: string,
  reason: string,
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  if (!reason || !reason.trim()) {
    return { ok: false, error: 'A cancellation reason is required.' };
  }

  const order = await getWorkspaceOrder(workspaceId, orderId);
  if (!order) {
    return { ok: false, error: 'Order not found in this workspace' };
  }

  const now = new Date().toISOString();
  const events = order.events ? [...order.events] : [];
  events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    order_id: orderId,
    timestamp: now,
    actor: actor || 'system',
    event_type: 'cancelled',
    description: `Ordine annullato: ${reason || 'Richiesta utente'}`,
    data: { reason },
  });

  // Release reservation if not already shipped/deducted
  await releaseOrderInventoryReservation(workspaceId, order, actor);

  const updated: Order = {
    ...order,
    status: 'cancelled',
    cancellation_reason: reason || 'Annullato manualmente',
    cancelled_at: now,
    inventory_reserved: false,
    events,
    updated_at: now,
  };

  return saveWorkspaceOrder(workspaceId, updated, actor);
}

export async function updateOrderFulfillment(
  workspaceId: string,
  orderId: string,
  fulfillment: {
    carrier?: string;
    tracking_number?: string;
    tracking_url?: string;
    dispatched_at?: string;
    delivered_at?: string;
    delivery_status?: DeliveryStatus;
  },
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const order = await getWorkspaceOrder(workspaceId, orderId);
  if (!order) {
    return { ok: false, error: 'Order not found in this workspace' };
  }

  const now = new Date().toISOString();
  const events = order.events ? [...order.events] : [];

  let newDeliveryStatus: DeliveryStatus =
    fulfillment.delivery_status ||
    (fulfillment.tracking_number ? 'in_transit' : order.delivery_status || 'unfulfilled');

  let newOrderStatus: OrderStatus = order.status;
  if (fulfillment.delivery_status === 'delivered') {
    newOrderStatus = 'delivered';
  } else if (fulfillment.tracking_number || newDeliveryStatus === 'in_transit') {
    if (order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'returned') {
      newOrderStatus = 'shipped';
    }
  }

  events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    order_id: orderId,
    timestamp: now,
    actor: actor || 'system',
    event_type: fulfillment.delivery_status === 'delivered' ? 'delivered' : 'fulfillment_updated',
    description: `Spedizione aggiornata: Corriere ${fulfillment.carrier || order.carrier || '-'}, Tracking: ${fulfillment.tracking_number || order.tracking_number || '-'}`,
    data: fulfillment,
  });

  const updated: Order = {
    ...order,
    carrier: fulfillment.carrier !== undefined ? fulfillment.carrier : order.carrier,
    tracking_number: fulfillment.tracking_number !== undefined ? fulfillment.tracking_number : order.tracking_number,
    tracking_url: fulfillment.tracking_url !== undefined ? fulfillment.tracking_url : order.tracking_url,
    dispatched_at: fulfillment.dispatched_at || order.dispatched_at || (fulfillment.tracking_number ? now : null),
    delivered_at: fulfillment.delivered_at || (fulfillment.delivery_status === 'delivered' ? now : order.delivered_at),
    delivery_status: newDeliveryStatus,
    status: newOrderStatus,
    inventory_deducted:
      newOrderStatus === 'shipped' || newOrderStatus === 'delivered' || newDeliveryStatus === 'in_transit'
        ? true
        : order.inventory_deducted,
    inventory_reserved:
      newOrderStatus === 'shipped' || newOrderStatus === 'delivered' || newDeliveryStatus === 'in_transit'
        ? false
        : order.inventory_reserved,
    events,
    updated_at: now,
  };

  return saveWorkspaceOrder(workspaceId, updated, actor);
}

export async function updateOrderSupplierPurchase(
  workspaceId: string,
  orderId: string,
  supplierData: {
    supplier_id?: string;
    supplier_name?: string;
    supplier_order_reference?: string;
    supplier_purchased_at?: string;
    supplier_notes?: string;
    supplier_purchasing_status?: SupplierPurchasingStatus;
    supplier_shipping_cost?: number;
    supplier_cost?: number;
  },
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const order = await getWorkspaceOrder(workspaceId, orderId);
  if (!order) {
    return { ok: false, error: 'Order not found in this workspace' };
  }

  const now = new Date().toISOString();
  const events = order.events ? [...order.events] : [];

  const purchasingStatus = supplierData.supplier_purchasing_status || 'ordered';
  let newOrderStatus: OrderStatus = order.status;
  if ((purchasingStatus === 'ordered' || purchasingStatus === 'confirmed') && (order.status === 'pending' || order.status === 'awaiting_purchase')) {
    newOrderStatus = 'purchased';
  }

  events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    order_id: orderId,
    timestamp: now,
    actor: actor || 'system',
    event_type: 'supplier_updated',
    description: `Acquisto fornitore aggiornato: ${supplierData.supplier_name || order.supplier_name || 'Fornitore'} (Rif: ${supplierData.supplier_order_reference || '-'}, Stato: ${purchasingStatus})`,
    data: supplierData,
  });

  const updated: Order = {
    ...order,
    supplier_id: supplierData.supplier_id || order.supplier_id,
    supplier_name: supplierData.supplier_name || order.supplier_name,
    supplier_order_reference: supplierData.supplier_order_reference !== undefined ? supplierData.supplier_order_reference : order.supplier_order_reference,
    supplier_purchased_at: supplierData.supplier_purchased_at || now,
    supplier_notes: supplierData.supplier_notes !== undefined ? supplierData.supplier_notes : order.supplier_notes,
    supplier_purchasing_status: purchasingStatus,
    supplier_shipping_cost: supplierData.supplier_shipping_cost !== undefined ? supplierData.supplier_shipping_cost : order.supplier_shipping_cost,
    status: newOrderStatus,
    events,
    updated_at: now,
  };

  return saveWorkspaceOrder(workspaceId, updated, actor);
}

export async function recordOrderReturn(
  workspaceId: string,
  orderId: string,
  returnData: {
    return_status?: ReturnStatus;
    return_reason?: string;
    returned_at?: string;
    restock_items?: boolean;
  },
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const order = await getWorkspaceOrder(workspaceId, orderId);
  if (!order) {
    return { ok: false, error: 'Order not found in this workspace' };
  }

  const now = new Date().toISOString();
  const events = order.events ? [...order.events] : [];

  const returnStatus: ReturnStatus = returnData.return_status || 'requested';
  let newOrderStatus: OrderStatus = order.status;
  if (returnStatus === 'completed' || returnStatus === 'item_received' || returnStatus === 'requested' || returnStatus === 'approved') {
    newOrderStatus = 'returned';
  }

  events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    order_id: orderId,
    timestamp: now,
    actor: actor || 'system',
    event_type: returnStatus === 'requested' ? 'return_requested' : 'return_status_changed',
    description: `Stato reso: ${returnStatus} (Motivo: ${returnData.return_reason || 'Non specificato'})`,
    data: returnData,
  });

  // Restock inventory if restockable
  if (returnData.restock_items || (returnData as any).restockable) {
    await restockReturnedOrderInventory(workspaceId, order, returnData, actor);
  }

  const updated: Order = {
    ...order,
    return_status: returnStatus,
    return_reason: returnData.return_reason || order.return_reason,
    returned_at: returnData.returned_at || (returnStatus === 'completed' ? now : order.returned_at),
    status: newOrderStatus,
    events,
    updated_at: now,
  };

  return saveWorkspaceOrder(workspaceId, updated, actor);
}

export async function recordOrderRefund(
  workspaceId: string,
  orderId: string,
  refundData: {
    amount: number;
    reason?: string;
    refunded_at?: string;
  },
  actor?: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const order = await getWorkspaceOrder(workspaceId, orderId);
  if (!order) {
    return { ok: false, error: 'Order not found in this workspace' };
  }

  const now = new Date().toISOString();
  const refundAmount = Math.max(0, Number(refundData.amount) || 0);
  const refundItem: OrderRefundItem = {
    id: crypto.randomUUID ? crypto.randomUUID() : `ref-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    amount: refundAmount,
    reason: refundData.reason || 'Rimborso cliente',
    timestamp: refundData.refunded_at || now,
    actor: actor || 'system',
  };

  const existingRefunds = Array.isArray(order.refunds) ? [...order.refunds] : [];
  existingRefunds.push(refundItem);
  const totalRefundAmount = existingRefunds.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

  const events = order.events ? [...order.events] : [];
  events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    order_id: orderId,
    timestamp: now,
    actor: actor || 'system',
    event_type: 'refund_issued',
    description: `Rimborso emesso: €${refundAmount.toFixed(2)} (Motivo: ${refundData.reason || 'Non specificato'})`,
    data: refundItem,
  });

  const updated: Order = {
    ...order,
    refund_amount: totalRefundAmount,
    refund_reason: refundData.reason || order.refund_reason,
    refunded_at: refundData.refunded_at || now,
    refunds: existingRefunds,
    events,
    updated_at: now,
  };

  return saveWorkspaceOrder(workspaceId, updated, actor);
}

export async function deleteWorkspaceOrder(
  workspaceId: string,
  orderId: string
): Promise<boolean> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { error } = await client
          .from('orders')
          .delete()
          .eq('id', orderId)
          .eq('workspace_id', workspaceId);
        if (!error) return true;
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceOrdersStore.get(workspaceId) || [];
  const filtered = list.filter((o) => o.id !== orderId);
  const deleted = filtered.length < list.length;
  workspaceOrdersStore.set(workspaceId, filtered);
  return deleted;
}

export async function getWorkspaceOrderSummaryStats(
  workspaceId: string
): Promise<OrderSummaryStats> {
  const orders = await listWorkspaceOrders(workspaceId);

  let pendingCount = 0;
  let awaitingPurchaseCount = 0;
  let awaitingDispatchCount = 0;
  let shippedCount = 0;
  let deliveredCount = 0;
  let returnedCount = 0;
  let cancelledCount = 0;

  let totalRevenue = 0;
  let totalSupplierCost = 0;
  let totalProfit = 0;

  for (const o of orders) {
    totalRevenue += Number(o.total_paid) || 0;
    totalSupplierCost += Number(o.total_cost) || 0;
    totalProfit += Number(o.net_profit) || 0;

    if (o.status === 'awaiting_purchase' || o.supplier_purchasing_status === 'not_purchased') {
      awaitingPurchaseCount++;
    }

    switch (o.status) {
      case 'pending':
      case 'pending_fulfillment':
        pendingCount++;
        break;
      case 'awaiting_purchase':
        // already counted in awaitingPurchaseCount
        break;
      case 'purchased':
      case 'awaiting_dispatch':
        awaitingDispatchCount++;
        break;
      case 'shipped':
        shippedCount++;
        break;
      case 'delivered':
      case 'fulfilled':
        deliveredCount++;
        break;
      case 'returned':
        returnedCount++;
        break;
      case 'cancelled':
        cancelledCount++;
        break;
      default:
        pendingCount++;
        break;
    }
  }

  const roundedRevenue = Math.round(totalRevenue * 100) / 100;
  const roundedSupplierCost = Math.round(totalSupplierCost * 100) / 100;
  const roundedProfit = Math.round(totalProfit * 100) / 100;

  return {
    totalOrders: orders.length,
    total_orders: orders.length,
    pendingCount,
    pending_orders: pendingCount,
    awaitingPurchaseCount,
    awaiting_supplier_purchase: awaitingPurchaseCount,
    awaitingDispatchCount,
    awaiting_dispatch: awaitingDispatchCount,
    shippedCount,
    shipped_orders: shippedCount,
    deliveredCount,
    delivered_orders: deliveredCount,
    returnedCount,
    returned_orders: returnedCount,
    cancelledCount,
    cancelled_orders: cancelledCount,
    totalRevenue: roundedRevenue,
    total_revenue: roundedRevenue,
    totalSupplierCost: roundedSupplierCost,
    total_supplier_cost: roundedSupplierCost,
    totalProfit: roundedProfit,
    total_net_profit: roundedProfit,
  };
}

function normalizeOrderRecord(row: any): Order {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    order_number: row.order_number || `ORD-${row.id.slice(0, 8).toUpperCase()}`,
    external_order_id: row.external_order_id || null,
    ebay_order_id: row.ebay_order_id || null,
    order_source: row.order_source || 'manual',
    buyer_username: row.buyer_username || '',
    buyer_name: row.buyer_name || '',
    buyer_email: row.buyer_email || '',
    buyer_phone: row.buyer_phone || '',
    shipping_address: row.shipping_address || {},
    status: row.status || 'pending',
    supplier_purchasing_status: row.supplier_purchasing_status || 'not_purchased',
    delivery_status: row.delivery_status || 'unfulfilled',
    items: Array.isArray(row.items) ? row.items : [],
    currency: row.currency || 'EUR',
    total_paid: Number(row.total_paid) || 0,
    shipping_charged_to_buyer: Number(row.shipping_charged_to_buyer) || 0,
    supplier_shipping_cost: Number(row.supplier_shipping_cost) || 0,
    packaging_cost: Number(row.packaging_cost) || 0,
    estimated_ebay_fees: Number(row.estimated_ebay_fees) || 0,
    total_cost: Number(row.total_cost) || 0,
    net_profit: Number(row.net_profit) || 0,
    profit_margin: Number(row.profit_margin) || 0,
    supplier_id: row.supplier_id || 'pluspower',
    supplier_name: row.supplier_name || 'PlusPower Supplements',
    supplier_order_reference: row.supplier_order_reference || null,
    supplier_purchased_at: row.supplier_purchased_at || null,
    supplier_notes: row.supplier_notes || null,
    carrier: row.carrier || null,
    tracking_number: row.tracking_number || null,
    tracking_url: row.tracking_url || null,
    dispatched_at: row.dispatched_at || null,
    delivered_at: row.delivered_at || null,
    cancellation_reason: row.cancellation_reason || null,
    cancelled_at: row.cancelled_at || null,
    return_status: row.return_status || 'none',
    return_reason: row.return_reason || null,
    returned_at: row.returned_at || null,
    refund_amount: Number(row.refund_amount) || 0,
    refund_reason: row.refund_reason || null,
    refunded_at: row.refunded_at || null,
    refunds: Array.isArray(row.refunds) ? row.refunds : [],
    events: Array.isArray(row.events) ? row.events : [],
    notes: row.notes || null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at,
  };
}

// ==============================================================================
// 6. PRICE & IMPORT HISTORY
// ==============================================================================

export async function listWorkspacePriceHistory(workspaceId: string, productId?: string): Promise<PriceHistoryItem[]> {
  const list = workspacePriceHistoryStore.get(workspaceId) || [];
  if (productId) {
    return list.filter((item) => item.product_id === productId);
  }
  return [...list];
}

export async function recordWorkspacePriceChange(workspaceId: string, item: PriceHistoryItem): Promise<void> {
  const list = workspacePriceHistoryStore.get(workspaceId) || [];
  list.unshift(item);
  workspacePriceHistoryStore.set(workspaceId, list.slice(0, 500));
}

export async function approveWorkspacePriceChange(
  workspaceId: string,
  historyId: string
): Promise<{ ok: boolean; historyItem?: PriceHistoryItem; product?: Product; error?: string }> {
  const list = workspacePriceHistoryStore.get(workspaceId) || [];
  const item = list.find((h) => h.id === historyId);
  if (!item) return { ok: false, error: 'Price history record not found.' };

  const prod = await getWorkspaceProduct(workspaceId, item.product_id);
  if (!prod) return { ok: false, error: 'Associated product not found.' };

  // Apply approved price change
  item.status = 'approved';
  if (item.new_price !== null) {
    prod.price = item.new_price;
  }
  if (item.new_selling_price !== null && item.new_selling_price !== undefined) {
    prod.calculated_selling_price = item.new_selling_price;
  }

  // If no remaining pending items for this product, clear pending_approval status
  const pendingCount = list.filter((h) => h.product_id === prod.id && h.id !== historyId && h.status === 'pending_approval').length;
  if (pendingCount === 0 && prod.monitoring_status === 'pending_approval') {
    prod.monitoring_status = 'idle';
  }

  await saveWorkspaceProduct(workspaceId, prod);
  workspacePriceHistoryStore.set(workspaceId, list);

  return { ok: true, historyItem: item, product: prod };
}

export async function rejectWorkspacePriceChange(
  workspaceId: string,
  historyId: string
): Promise<{ ok: boolean; historyItem?: PriceHistoryItem; error?: string }> {
  const list = workspacePriceHistoryStore.get(workspaceId) || [];
  const item = list.find((h) => h.id === historyId);
  if (!item) return { ok: false, error: 'Price history record not found.' };

  item.status = 'rejected';

  const prod = await getWorkspaceProduct(workspaceId, item.product_id);
  if (prod && prod.monitoring_status === 'pending_approval') {
    const pendingCount = list.filter((h) => h.product_id === prod.id && h.id !== historyId && h.status === 'pending_approval').length;
    if (pendingCount === 0) {
      prod.monitoring_status = 'idle';
      await saveWorkspaceProduct(workspaceId, prod);
    }
  }

  workspacePriceHistoryStore.set(workspaceId, list);
  return { ok: true, historyItem: item };
}

export async function listWorkspaceImportHistory(workspaceId: string): Promise<ImportHistoryItem[]> {
  return [...(workspaceImportHistoryStore.get(workspaceId) || [])];
}

export async function addWorkspaceImportHistory(workspaceId: string, item: ImportHistoryItem): Promise<void> {
  const list = workspaceImportHistoryStore.get(workspaceId) || [];
  list.unshift(item);
  workspaceImportHistoryStore.set(workspaceId, list.slice(0, 500));
}

export async function clearWorkspaceImportHistory(workspaceId: string): Promise<void> {
  workspaceImportHistoryStore.set(workspaceId, []);
}

// ==============================================================================
// 6. FINANCIAL ANALYTICS & PROFIT REPORTING (Phase 1.6B)
// ==============================================================================

export async function getWorkspaceFinancialReport(
  workspaceId: string,
  options?: {
    range?: DateRangePreset;
    startDate?: string;
    endDate?: string;
    referenceDate?: Date;
  }
): Promise<FinancialReport> {
  const orders = await listWorkspaceOrders(workspaceId);
  const report = computeFinancialReport(
    orders,
    options?.range || 'this_month',
    options?.startDate,
    options?.endDate,
    options?.referenceDate || new Date()
  );
  report.workspaceId = workspaceId;
  return report;
}

export async function exportWorkspaceFinancialOrdersCsv(
  workspaceId: string,
  options?: {
    range?: DateRangePreset;
    startDate?: string;
    endDate?: string;
    referenceDate?: Date;
  }
): Promise<{ filename: string; csv: string; count: number; dateRangeLabel: string }> {
  const orders = await listWorkspaceOrders(workspaceId);
  const { startDate, endDate, label } = getDateRangeBoundaries(
    options?.range || 'this_month',
    options?.startDate,
    options?.endDate,
    options?.referenceDate || new Date()
  );

  const startTime = startDate.getTime();
  const endTime = endDate.getTime();

  const filteredOrders = orders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= startTime && t <= endTime;
  });

  const csv = generateFinancialOrdersCsv(filteredOrders);
  const rangeSlug = (options?.range || 'this_month').toLowerCase().replace(/_/g, '-');
  const filename = `sinchods-financial-report-${workspaceId}-${rangeSlug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return {
    filename,
    csv,
    count: filteredOrders.length,
    dateRangeLabel: label,
  };
}

// ==============================================================================
// 7. INVENTORY SYNCHRONIZATION & STOCK MOVEMENTS (Phase 1.7)
// ==============================================================================

export async function findProductAndVariant(
  workspaceId: string,
  productId?: string,
  variantId?: string | null,
  sku?: string
): Promise<{ product: Product | null; variant: ProductVariant | null }> {
  const products = await listWorkspaceProducts(workspaceId);

  if (productId) {
    const prod = products.find((p) => p.id === productId);
    if (prod) {
      const v = variantId ? prod.variants.find((v) => v.id === variantId) : (prod.variants[0] || null);
      return { product: prod, variant: v || null };
    }
  }

  if (variantId) {
    for (const prod of products) {
      const v = prod.variants.find((v) => v.id === variantId);
      if (v) return { product: prod, variant: v };
    }
  }

  if (sku) {
    const cleanSku = sku.trim().toLowerCase();
    for (const prod of products) {
      const v = prod.variants.find((v) => (v.sku || '').trim().toLowerCase() === cleanSku);
      if (v) return { product: prod, variant: v };
      if ((prod.sku || '').trim().toLowerCase() === cleanSku) {
        return { product: prod, variant: prod.variants[0] || null };
      }
    }
  }

  return { product: null, variant: null };
}

export async function recordInventoryMovement(
  workspaceId: string,
  movement: InventoryMovement
): Promise<void> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        await client.from('inventory_movements').insert({
          ...movement,
          workspace_id: workspaceId,
        });
      }
    } catch {
      // Fallback
    }
  }

  const list = workspaceInventoryMovementsStore.get(workspaceId) || [];
  list.unshift(movement);
  workspaceInventoryMovementsStore.set(workspaceId, list.slice(0, 1000));
}

export async function listWorkspaceInventoryMovements(
  workspaceId: string,
  options?: { productId?: string; orderId?: string; limit?: number }
): Promise<InventoryMovement[]> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        let q = client
          .from('inventory_movements')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });
        if (options?.productId) q = q.eq('product_id', options.productId);
        if (options?.orderId) q = q.eq('order_id', options.orderId);
        if (options?.limit) q = q.limit(options.limit);
        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          return data;
        }
      }
    } catch {
      // Fallback
    }
  }

  let list = workspaceInventoryMovementsStore.get(workspaceId) || [];
  if (options?.productId) {
    list = list.filter((m) => m.product_id === options.productId);
  }
  if (options?.orderId) {
    list = list.filter((m) => m.order_id === options.orderId);
  }
  if (options?.limit) {
    list = list.slice(0, options.limit);
  }
  return [...list];
}

export async function checkAndNotifyStockThreshold(
  workspaceId: string,
  product: Product,
  variant: ProductVariant | null,
  availableStock: number,
  threshold: number
): Promise<void> {
  const itemLabel = variant ? `${product.title} (${variant.name})` : product.title;
  const dedupKey = variant ? `stock_${product.id}_${variant.id}` : `stock_${product.id}`;

  if (availableStock <= 0) {
    await createWorkspaceNotification(workspaceId, {
      product_id: product.id,
      supplier_id: product.supplier_id,
      type: 'stock_depleted',
      title: 'Scorte Esaurite (Giacenza 0)',
      message: `Il prodotto "${itemLabel}" ha esaurito la giacenza disponibile nel magazzino locale.`,
      severity: 'critical',
      dedup_key: dedupKey,
      metadata: {
        productId: product.id,
        variantId: variant?.id,
        availableStock,
        threshold,
      },
    });
  } else if (availableStock <= threshold) {
    await createWorkspaceNotification(workspaceId, {
      product_id: product.id,
      supplier_id: product.supplier_id,
      type: 'stock_depleted',
      title: 'Scorte in Esaurimento (Sotto Soglia)',
      message: `Il prodotto "${itemLabel}" ha solo ${availableStock} pz disponibili (Soglia minima: ${threshold} pz).`,
      severity: 'warning',
      dedup_key: dedupKey,
      metadata: {
        productId: product.id,
        variantId: variant?.id,
        availableStock,
        threshold,
      },
    });
  } else {
    // Stock is healthy; resolve any existing notification for this dedupKey
    await resolveWorkspaceNotification(workspaceId, dedupKey);
  }
}

export async function applyOrderInventoryReservation(
  workspaceId: string,
  order: Order,
  actor?: string
): Promise<{ ok: boolean; movements: InventoryMovement[]; errors?: string[] }> {
  const movements: InventoryMovement[] = [];
  const errors: string[] = [];

  if (order.status === 'cancelled') {
    return { ok: true, movements };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const { product, variant } = await findProductAndVariant(workspaceId, item.product_id, item.variant_id, item.sku);

    if (product) {
      let stockBefore = 0;
      let stockAfter = 0;
      let reservedBefore = 0;
      let reservedAfter = 0;

      if (variant) {
        stockBefore = Number(variant.stock_quantity) || 0;
        stockAfter = stockBefore;
        reservedBefore = Math.max(0, Number(variant.reserved_stock) || 0);
        reservedAfter = reservedBefore + qty;
        variant.reserved_stock = reservedAfter;
      } else {
        stockBefore = Number(product.stock_quantity) || 0;
        stockAfter = stockBefore;
        reservedBefore = Math.max(0, Number(product.reserved_stock) || 0);
        reservedAfter = reservedBefore + qty;
        product.reserved_stock = reservedAfter;
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        product.reserved_stock = product.variants.reduce((sum, v) => sum + (Number(v.reserved_stock) || 0), 0);
      }

      await saveWorkspaceProduct(workspaceId, product);

      const movement: InventoryMovement = {
        id: crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workspace_id: workspaceId,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        order_id: order.id,
        movement_type: 'reservation',
        quantity: qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        reserved_before: reservedBefore,
        reserved_after: reservedAfter,
        reason: `Riservato per ordine ${order.order_number || order.id}`,
        actor: actor || 'system',
        created_at: new Date().toISOString(),
      };
      await recordInventoryMovement(workspaceId, movement);
      movements.push(movement);

      const available = Math.max(0, stockAfter - reservedAfter);
      const threshold = Number(variant?.stock_threshold ?? product.stock_threshold ?? 5);
      await checkAndNotifyStockThreshold(workspaceId, product, variant, available, threshold);
    }
  }

  return { ok: true, movements, errors: errors.length > 0 ? errors : undefined };
}

export async function releaseOrderInventoryReservation(
  workspaceId: string,
  order: Order,
  actor?: string
): Promise<{ ok: boolean; movements: InventoryMovement[] }> {
  const movements: InventoryMovement[] = [];

  if (!order.inventory_reserved || order.inventory_deducted) {
    return { ok: true, movements };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const { product, variant } = await findProductAndVariant(workspaceId, item.product_id, item.variant_id, item.sku);

    if (product) {
      let stockBefore = 0;
      let stockAfter = 0;
      let reservedBefore = 0;
      let reservedAfter = 0;

      if (variant) {
        stockBefore = Number(variant.stock_quantity) || 0;
        stockAfter = stockBefore;
        reservedBefore = Math.max(0, Number(variant.reserved_stock) || 0);
        reservedAfter = Math.max(0, reservedBefore - qty);
        variant.reserved_stock = reservedAfter;
      } else {
        stockBefore = Number(product.stock_quantity) || 0;
        stockAfter = stockBefore;
        reservedBefore = Math.max(0, Number(product.reserved_stock) || 0);
        reservedAfter = Math.max(0, reservedBefore - qty);
        product.reserved_stock = reservedAfter;
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        product.reserved_stock = product.variants.reduce((sum, v) => sum + (Number(v.reserved_stock) || 0), 0);
      }

      await saveWorkspaceProduct(workspaceId, product);

      const movement: InventoryMovement = {
        id: crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workspace_id: workspaceId,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        order_id: order.id,
        movement_type: 'reservation_release',
        quantity: -qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        reserved_before: reservedBefore,
        reserved_after: reservedAfter,
        reason: `Rilascio riserva per annullamento ordine ${order.order_number || order.id}`,
        actor: actor || 'system',
        created_at: new Date().toISOString(),
      };
      await recordInventoryMovement(workspaceId, movement);
      movements.push(movement);
    }
  }

  return { ok: true, movements };
}

export async function deductShippedOrderInventory(
  workspaceId: string,
  order: Order,
  actor?: string
): Promise<{ ok: boolean; movements: InventoryMovement[] }> {
  const movements: InventoryMovement[] = [];

  // Idempotency: DO NOT deduct twice!
  if (order.inventory_deducted) {
    return { ok: true, movements };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const { product, variant } = await findProductAndVariant(workspaceId, item.product_id, item.variant_id, item.sku);

    if (product) {
      let stockBefore = 0;
      let stockAfter = 0;
      let reservedBefore = 0;
      let reservedAfter = 0;

      if (variant) {
        stockBefore = Number(variant.stock_quantity) || 0;
        stockAfter = Math.max(0, stockBefore - qty);
        reservedBefore = Math.max(0, Number(variant.reserved_stock) || 0);
        reservedAfter = order.inventory_reserved ? Math.max(0, reservedBefore - qty) : reservedBefore;
        variant.stock_quantity = stockAfter;
        variant.reserved_stock = reservedAfter;
        if (stockAfter === 0) {
          variant.availability = 'OutOfStock';
        }
      } else {
        stockBefore = Number(product.stock_quantity) || 0;
        stockAfter = Math.max(0, stockBefore - qty);
        reservedBefore = Math.max(0, Number(product.reserved_stock) || 0);
        reservedAfter = order.inventory_reserved ? Math.max(0, reservedBefore - qty) : reservedBefore;
        product.stock_quantity = stockAfter;
        product.reserved_stock = reservedAfter;
        if (stockAfter === 0) {
          product.availability = 'OutOfStock';
        }
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        product.stock_quantity = product.variants.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);
        product.reserved_stock = product.variants.reduce((sum, v) => sum + (Number(v.reserved_stock) || 0), 0);
        if (product.stock_quantity === 0) {
          product.availability = 'OutOfStock';
        }
      }

      await saveWorkspaceProduct(workspaceId, product);

      const movement: InventoryMovement = {
        id: crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workspace_id: workspaceId,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        order_id: order.id,
        movement_type: 'deduction',
        quantity: -qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        reserved_before: reservedBefore,
        reserved_after: reservedAfter,
        reason: `Deduzione stock per spedizione ordine ${order.order_number || order.id}`,
        actor: actor || 'system',
        created_at: new Date().toISOString(),
      };
      await recordInventoryMovement(workspaceId, movement);
      movements.push(movement);

      const available = Math.max(0, stockAfter - reservedAfter);
      const threshold = Number(variant?.stock_threshold ?? product.stock_threshold ?? 5);
      await checkAndNotifyStockThreshold(workspaceId, product, variant, available, threshold);
    }
  }

  return { ok: true, movements };
}

export async function restockReturnedOrderInventory(
  workspaceId: string,
  order: Order,
  returnData: { restockable?: boolean; restock_items?: boolean; return_reason?: string },
  actor?: string
): Promise<{ ok: boolean; movements: InventoryMovement[] }> {
  const movements: InventoryMovement[] = [];

  const isRestockable = Boolean(returnData.restockable || returnData.restock_items);
  if (!isRestockable) {
    return { ok: true, movements };
  }

  if ((order as any).inventory_restocked) {
    return { ok: true, movements };
  }

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const { product, variant } = await findProductAndVariant(workspaceId, item.product_id, item.variant_id, item.sku);

    if (product) {
      let stockBefore = 0;
      let stockAfter = 0;
      let reservedBefore = 0;
      let reservedAfter = 0;

      if (variant) {
        stockBefore = Number(variant.stock_quantity) || 0;
        stockAfter = stockBefore + qty;
        reservedBefore = Math.max(0, Number(variant.reserved_stock) || 0);
        reservedAfter = reservedBefore;
        variant.stock_quantity = stockAfter;
        if (stockAfter > 0 && variant.availability === 'OutOfStock') {
          variant.availability = 'InStock';
        }
      } else {
        stockBefore = Number(product.stock_quantity) || 0;
        stockAfter = stockBefore + qty;
        reservedBefore = Math.max(0, Number(product.reserved_stock) || 0);
        reservedAfter = reservedBefore;
        product.stock_quantity = stockAfter;
        if (stockAfter > 0 && product.availability === 'OutOfStock') {
          product.availability = 'InStock';
        }
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        product.stock_quantity = product.variants.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);
        if (product.stock_quantity > 0 && product.availability === 'OutOfStock') {
          product.availability = 'InStock';
        }
      }

      await saveWorkspaceProduct(workspaceId, product);

      const movement: InventoryMovement = {
        id: crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workspace_id: workspaceId,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        order_id: order.id,
        movement_type: 'return_restock',
        quantity: qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        reserved_before: reservedBefore,
        reserved_after: reservedAfter,
        reason: `Restock reso ordine ${order.order_number || order.id}: ${returnData.return_reason || 'Articolo integro'}`,
        actor: actor || 'system',
        created_at: new Date().toISOString(),
      };
      await recordInventoryMovement(workspaceId, movement);
      movements.push(movement);
    }
  }

  return { ok: true, movements };
}

export async function adjustWorkspaceStockManual(
  workspaceId: string,
  params: {
    productId: string;
    variantId?: string | null;
    newStock: number;
    reason?: string;
    actor?: string;
  }
): Promise<{ ok: boolean; product?: Product; movement?: InventoryMovement; error?: string }> {
  const { product, variant } = await findProductAndVariant(workspaceId, params.productId, params.variantId);
  if (!product) {
    return { ok: false, error: 'Product not found in this workspace' };
  }

  const newStock = Math.max(0, params.newStock);
  let stockBefore = 0;
  let reservedBefore = 0;

  if (variant) {
    stockBefore = Number(variant.stock_quantity) || 0;
    reservedBefore = Number(variant.reserved_stock) || 0;
    variant.stock_quantity = newStock;
    variant.availability = newStock > 0 ? 'InStock' : 'OutOfStock';
  } else {
    stockBefore = Number(product.stock_quantity) || 0;
    reservedBefore = Number(product.reserved_stock) || 0;
    product.stock_quantity = newStock;
    product.availability = newStock > 0 ? 'InStock' : 'OutOfStock';
  }

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    product.stock_quantity = product.variants.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0), 0);
    product.availability = product.stock_quantity > 0 ? 'InStock' : 'OutOfStock';
  }

  await saveWorkspaceProduct(workspaceId, product);

  const movement: InventoryMovement = {
    id: crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    workspace_id: workspaceId,
    product_id: product.id,
    variant_id: variant ? variant.id : null,
    movement_type: 'manual_adjustment',
    quantity: newStock - stockBefore,
    stock_before: stockBefore,
    stock_after: newStock,
    reserved_before: reservedBefore,
    reserved_after: reservedBefore,
    reason: params.reason || 'Rettifica manuale giacenza',
    actor: params.actor || 'system',
    created_at: new Date().toISOString(),
  };
  await recordInventoryMovement(workspaceId, movement);

  const available = Math.max(0, newStock - reservedBefore);
  const threshold = Number(variant?.stock_threshold ?? product.stock_threshold ?? 5);
  await checkAndNotifyStockThreshold(workspaceId, product, variant, available, threshold);

  return { ok: true, product, movement };
}

export async function getWorkspaceInventorySummary(
  workspaceId: string
): Promise<WorkspaceInventorySummary> {
  const products = await listWorkspaceProducts(workspaceId);
  let totalSkus = 0;
  let totalOnHandStock = 0;
  let totalReservedStock = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let supplierOutOfStockCount = 0;

  for (const p of products) {
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      for (const v of p.variants) {
        totalSkus++;
        const onHand = Number(v.stock_quantity) || 0;
        const reserved = Number(v.reserved_stock) || 0;
        const available = Math.max(0, onHand - reserved);
        const threshold = Number(v.stock_threshold ?? p.stock_threshold ?? 5);

        totalOnHandStock += onHand;
        totalReservedStock += reserved;
        if (available <= 0) {
          outOfStockCount++;
        } else if (available <= threshold) {
          lowStockCount++;
        }

        if (
          v.supplier_availability === 'OutOfStock' ||
          (v.supplier_stock !== null && v.supplier_stock !== undefined && v.supplier_stock <= 0)
        ) {
          supplierOutOfStockCount++;
        }
      }
    } else {
      totalSkus++;
      const onHand = Number(p.stock_quantity) || 0;
      const reserved = Number(p.reserved_stock) || 0;
      const available = Math.max(0, onHand - reserved);
      const threshold = Number(p.stock_threshold ?? 5);

      totalOnHandStock += onHand;
      totalReservedStock += reserved;
      if (available <= 0) {
        outOfStockCount++;
      } else if (available <= threshold) {
        lowStockCount++;
      }

      if (
        p.supplier_availability === 'OutOfStock' ||
        (p.supplier_stock !== null && p.supplier_stock !== undefined && p.supplier_stock <= 0)
      ) {
        supplierOutOfStockCount++;
      }
    }
  }

  const totalAvailableStock = Math.max(0, totalOnHandStock - totalReservedStock);

  return {
    totalSkus,
    totalOnHandStock,
    totalReservedStock,
    totalAvailableStock,
    lowStockCount,
    outOfStockCount,
    supplierOutOfStockCount,
  };
}


