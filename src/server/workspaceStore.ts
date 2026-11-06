import {
  Product,
  ProductVariant,
  Supplier,
  SupplierParserConfig,
  ImportJob,
  ImportJobItem,
  EbayListing,
  Order,
  PriceHistoryItem,
  ImportHistoryItem,
} from '../types.js';
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
    ...product,
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
  const existingIdx = list.findIndex((p) => p.id === scopedProduct.id || p.url === scopedProduct.url);
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
// 5. ORDERS
// ==============================================================================

export async function listWorkspaceOrders(workspaceId: string): Promise<Order[]> {
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        const { data, error } = await client
          .from('orders')
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

  return [...(workspaceOrdersStore.get(workspaceId) || [])];
}

export async function saveWorkspaceOrder(
  workspaceId: string,
  order: Order
): Promise<{ ok: boolean; order: Order; error?: string }> {
  const scopedOrder: Order = {
    ...order,
    created_at: order.created_at || new Date().toISOString(),
  };

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
        if (error) return { ok: false, order: scopedOrder, error: error.message };
        return { ok: true, order: scopedOrder };
      }
    } catch {
      // Fallback
    }
  }

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
