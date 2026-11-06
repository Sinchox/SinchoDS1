import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Product,
  ProductVariant,
  ImportHistoryItem,
  ScraperSettings,
  EbayListing,
  Order,
  OrderSummaryStats,
  FinancialReport,
  DateRangePreset,
} from '../types.js';
import { DEFAULT_PRICING_RULE, calculateOrderFinancials } from './pricing.js';
import { computeFinancialReport } from './financials.js';
import { generateFinancialOrdersCsv } from './csv.js';

const SETTINGS_KEY = 'sinchods_scraper_settings';
const LOCAL_PRODUCTS_KEY = 'sinchods_local_products';
const LOCAL_HISTORY_KEY = 'sinchods_local_history';
const LOCAL_LISTINGS_KEY = 'sinchods_local_listings';
const LOCAL_PRICE_HISTORY_KEY = 'sinchods_price_history';
const LOCAL_ORDERS_KEY = 'sinchods_local_orders';

export const DEFAULT_SETTINGS: ScraperSettings = {
  supabaseUrl: (import.meta as any).env?.VITE_SUPABASE_URL || '',
  supabaseAnonKey: (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '',
  defaultDelaySeconds: 3,
  defaultBatchSize: 5,
  csvDelimiter: ',',
  autoFormatEuroPrices: true,
  userAgent: 'Mozilla/5.0 (compatible; SinchoDSProductImporter/2.0)',
  ebayConfig: {
    clientId: (import.meta as any).env?.VITE_EBAY_CLIENT_ID || '',
    clientSecret: '',
    ruName: (import.meta as any).env?.VITE_EBAY_RUNAME || '',
    environment: 'PRODUCTION',
    marketplaceId: 'EBAY_IT',
    connected: false,
    tokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    sellerUsername: null,
  },
  defaultPricingRule: DEFAULT_PRICING_RULE,
};

export function getStoredSettings(): ScraperSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ebayConfig: { ...DEFAULT_SETTINGS.ebayConfig, ...(parsed.ebayConfig || {}) },
        defaultPricingRule: { ...DEFAULT_SETTINGS.defaultPricingRule, ...(parsed.defaultPricingRule || {}) },
      };
    }
  } catch (e) {
    console.warn('Error reading settings from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveStoredSettings(settings: ScraperSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    cachedClient = null; // reset cached client
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
  }
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;

  const settings = getStoredSettings();
  if (settings.supabaseUrl && settings.supabaseAnonKey) {
    try {
      cachedClient = createClient(settings.supabaseUrl, settings.supabaseAnonKey);
      return cachedClient;
    } catch (err) {
      console.warn('Could not initialize Supabase client:', err);
    }
  }
  return null;
}

export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string; count?: number }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase URL o Anon Key non configurati.' };
  }
  try {
    const { count, error } = await client.from('products').select('*', { count: 'exact', head: true });
    if (error) {
      return { ok: false, message: `Errore Supabase: ${error.message}` };
    }
    return { ok: true, message: 'Connessione a Supabase riuscita!', count: count || 0 };
  } catch (err: any) {
    return { ok: false, message: `Eccezione di rete: ${err.message || String(err)}` };
  }
}

// Local Storage helpers
export function getLocalProducts(): Product[] {
  try {
    const raw = localStorage.getItem(LOCAL_PRODUCTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Error reading local products:', err);
  }
  return [];
}

export function saveLocalProducts(products: Product[]): void {
  try {
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(products));
  } catch (err) {
    console.error('Error saving local products:', err);
  }
}

export function getLocalHistory(): ImportHistoryItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

export function addLocalHistory(item: ImportHistoryItem): void {
  try {
    const list = getLocalHistory();
    list.unshift(item);
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    // ignore
  }
}

// Full product CRUD
export async function fetchAllProducts(): Promise<Product[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('products')
        .select(`
          *,
          product_variants (*)
        `)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const mapped: Product[] = data.map((row: any) => ({
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
          raw_jsonld: row.raw_jsonld,
          import_source: row.import_source || 'html_import',
          status: row.status || 'ready',
          error: row.error,
          created_at: row.created_at,
          updated_at: row.updated_at,
          ebay_listing_id: row.ebay_listing_id || null,
          ebay_status: row.ebay_status || 'not_listed',
          last_synced_at: row.last_synced_at || null,
          variants: Array.isArray(row.product_variants)
            ? row.product_variants.map((v: any) => ({
                id: v.id,
                product_id: v.product_id,
                variant_id: v.variant_id,
                option_id: v.option_id,
                name: v.name,
                sku: v.sku,
                ean: v.ean,
                price: v.price !== null ? Number(v.price) : null,
                original_price: v.original_price !== null ? Number(v.original_price) : null,
                stock_quantity: v.stock_quantity,
                availability: v.availability,
                expiry_date: v.expiry_date,
                available_online: v.available_online,
                raw_data: v.raw_data,
              }))
            : [],
        }));
        saveLocalProducts(mapped);
        return mapped;
      }
    } catch (err) {
      console.warn('Supabase fetch failed, falling back to local storage:', err);
    }
  }

  return getLocalProducts();
}

export async function saveProductToDb(product: Product): Promise<{ ok: boolean; product: Product; error?: string }> {
  // Ensure default supplier
  if (!product.supplier_id) {
    product.supplier_id = 'pluspower';
    product.supplier_name = 'PlusPower Supplements';
  }

  const localList = getLocalProducts();
  const existingIdx = localList.findIndex((p) => p.url === product.url || p.id === product.id);

  if (existingIdx >= 0) {
    const existing = localList[existingIdx];
    // Record price / stock change history
    if (existing.price !== product.price || existing.stock_quantity !== product.stock_quantity) {
      recordPriceChange(product.id, existing.price, product.price, existing.stock_quantity, product.stock_quantity);
    }

    product.id = existing.id;
    product.updated_at = new Date().toISOString();
    localList[existingIdx] = product;
  } else {
    product.created_at = new Date().toISOString();
    product.updated_at = product.created_at;
    localList.unshift(product);
  }
  saveLocalProducts(localList);

  const client = getSupabaseClient();
  if (client) {
    try {
      const productPayload = {
        id: product.id,
        supplier_id: product.supplier_id,
        supplier_name: product.supplier_name,
        supplier_product_id: product.supplier_product_id,
        url: product.url,
        title: product.title,
        brand: product.brand,
        category: product.category,
        price: product.price,
        original_price: product.original_price,
        discount_percentage: product.discount_percentage,
        currency: product.currency,
        sku: product.sku,
        ean: product.ean,
        availability: product.availability,
        stock_quantity: product.stock_quantity,
        description: product.description,
        ingredients: product.ingredients,
        nutrition: product.nutrition,
        images: product.images,
        raw_jsonld: product.raw_jsonld,
        import_source: product.import_source,
        status: product.status,
        error: product.error,
        ebay_listing_id: product.ebay_listing_id,
        ebay_status: product.ebay_status,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: savedProd, error: pError } = await client
        .from('products')
        .upsert(productPayload, { onConflict: 'url' })
        .select()
        .single();

      if (pError) {
        console.warn('Error saving product to Supabase:', pError);
        return { ok: false, product, error: pError.message };
      }

      const parentId = savedProd.id;
      product.id = parentId;

      await client.from('product_variants').delete().eq('product_id', parentId);

      if (product.variants && product.variants.length > 0) {
        const variantPayloads = product.variants.map((v) => ({
          product_id: parentId,
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

      return { ok: true, product };
    } catch (err: any) {
      console.warn('Failed to upsert to Supabase:', err);
      return { ok: false, product, error: err.message };
    }
  }

  return { ok: true, product };
}

export async function deleteProductFromDb(id: string): Promise<boolean> {
  const localList = getLocalProducts().filter((p) => p.id !== id);
  saveLocalProducts(localList);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('products').delete().eq('id', id);
    } catch (err) {
      console.warn('Error in Supabase delete call:', err);
      return false;
    }
  }
  return true;
}

export async function bulkDeleteProductsFromDb(ids: string[]): Promise<boolean> {
  const localList = getLocalProducts().filter((p) => !ids.includes(p.id));
  saveLocalProducts(localList);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('products').delete().in('id', ids);
    } catch (err) {
      console.warn('Error during bulk deletion from Supabase:', err);
    }
  }
  return true;
}

// ==============================================================================
// eBay Listings Persistence
// ==============================================================================

export function getLocalListings(): EbayListing[] {
  try {
    const raw = localStorage.getItem(LOCAL_LISTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Error reading local eBay listings:', err);
  }
  return [];
}

export function saveLocalListings(listings: EbayListing[]): void {
  try {
    localStorage.setItem(LOCAL_LISTINGS_KEY, JSON.stringify(listings));
  } catch (err) {
    console.error('Error saving local eBay listings:', err);
  }
}

export async function fetchAllEbayListings(): Promise<EbayListing[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('ebay_listings')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const mapped: EbayListing[] = data.map((row: any) => ({
          id: row.id,
          product_id: row.product_id,
          supplier_id: row.supplier_id || 'pluspower',
          supplier_url: row.supplier_url,
          marketplace_id: row.marketplace_id || 'EBAY_IT',
          title: row.title,
          subtitle: row.subtitle,
          category_id: row.category_id,
          category_name: row.category_name,
          condition_id: row.condition_id || 'NEW',
          price: Number(row.price),
          original_supplier_cost: Number(row.original_supplier_cost),
          expected_profit: Number(row.expected_profit),
          quantity: row.quantity,
          sku: row.sku,
          ean: row.ean,
          brand: row.brand,
          description_html: row.description_html,
          images: Array.isArray(row.images) ? row.images : [],
          item_specifics: row.item_specifics || {},
          shipping_policy_id: row.shipping_policy_id,
          return_policy_id: row.return_policy_id,
          payment_policy_id: row.payment_policy_id,
          status: row.status || 'draft',
          ebay_item_id: row.ebay_item_id,
          ebay_offer_id: row.ebay_offer_id,
          error_message: row.error_message,
          variants: Array.isArray(row.variants) ? row.variants : [],
          created_at: row.created_at,
          updated_at: row.updated_at,
          published_at: row.published_at,
        }));
        saveLocalListings(mapped);
        return mapped;
      }
    } catch (err) {
      console.warn('Supabase listings fetch failed, using local storage:', err);
    }
  }

  return getLocalListings();
}

export async function saveEbayListingToDb(listing: EbayListing): Promise<{ ok: boolean; listing: EbayListing; error?: string }> {
  const localList = getLocalListings();
  const existingIdx = localList.findIndex((l) => l.id === listing.id);

  if (existingIdx >= 0) {
    listing.updated_at = new Date().toISOString();
    localList[existingIdx] = listing;
  } else {
    listing.created_at = new Date().toISOString();
    listing.updated_at = listing.created_at;
    localList.unshift(listing);
  }
  saveLocalListings(localList);

  const client = getSupabaseClient();
  if (client) {
    try {
      const payload = {
        id: listing.id,
        product_id: listing.product_id,
        supplier_id: listing.supplier_id,
        supplier_url: listing.supplier_url,
        marketplace_id: listing.marketplace_id,
        title: listing.title,
        subtitle: listing.subtitle,
        category_id: listing.category_id,
        category_name: listing.category_name,
        condition_id: listing.condition_id,
        price: listing.price,
        original_supplier_cost: listing.original_supplier_cost,
        expected_profit: listing.expected_profit,
        quantity: listing.quantity,
        sku: listing.sku,
        ean: listing.ean,
        brand: listing.brand,
        description_html: listing.description_html,
        images: listing.images,
        item_specifics: listing.item_specifics,
        shipping_policy_id: listing.shipping_policy_id,
        return_policy_id: listing.return_policy_id,
        payment_policy_id: listing.payment_policy_id,
        status: listing.status,
        ebay_item_id: listing.ebay_item_id,
        ebay_offer_id: listing.ebay_offer_id,
        error_message: listing.error_message,
        variants: listing.variants,
        updated_at: new Date().toISOString(),
        published_at: listing.published_at,
      };

      const { data, error } = await client
        .from('ebay_listings')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        return { ok: false, listing, error: error.message };
      }
      return { ok: true, listing: { ...listing, ...data } };
    } catch (err: any) {
      return { ok: false, listing, error: err.message };
    }
  }

  return { ok: true, listing };
}

export async function deleteEbayListingFromDb(id: string): Promise<boolean> {
  const localList = getLocalListings().filter((l) => l.id !== id);
  saveLocalListings(localList);

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('ebay_listings').delete().eq('id', id);
    } catch {
      return false;
    }
  }
  return true;
}

// ==============================================================================
// Price & Stock Monitoring History
// ==============================================================================

export function recordPriceChange(
  productId: string,
  oldPrice: any,
  newPrice: any,
  oldStock: any,
  newStock: any
): void {
  try {
    const raw = localStorage.getItem(LOCAL_PRICE_HISTORY_KEY);
    const list: PriceHistoryItem[] = raw ? JSON.parse(raw) : [];

    const oldP = oldPrice !== null && oldPrice !== undefined ? Number(oldPrice) : null;
    const newP = newPrice !== null && newPrice !== undefined ? Number(newPrice) : null;
    let changeType: PriceHistoryItem['change_type'] = 'manual_update';
    if (oldP !== null && newP !== null) {
      if (newP > oldP) changeType = 'price_increase';
      else if (newP < oldP) changeType = 'price_decrease';
      else changeType = 'stock_change';
    } else if (oldStock !== null || newStock !== null) {
      changeType = 'stock_change';
    }

    const item: PriceHistoryItem = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12),
      product_id: productId,
      supplier_id: 'pluspower',
      old_price: oldP,
      new_price: newP,
      old_stock: oldStock !== null && oldStock !== undefined ? Number(oldStock) : null,
      new_stock: newStock !== null && newStock !== undefined ? Number(newStock) : null,
      change_type: changeType,
      status: 'applied',
      changed_at: new Date().toISOString(),
    };

    list.unshift(item);
    localStorage.setItem(LOCAL_PRICE_HISTORY_KEY, JSON.stringify(list.slice(0, 300)));
  } catch {
    // ignore
  }
}

export function fetchPriceHistory(productId?: string): PriceHistoryItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_PRICE_HISTORY_KEY);
    if (raw) {
      const list: PriceHistoryItem[] = JSON.parse(raw);
      if (productId) {
        return list.filter((i) => i.product_id === productId);
      }
      return list;
    }
  } catch {
    // ignore
  }
  return [];
}

// ==============================================================================
// Orders & Fulfillment Persistence (Phase 1.6A)
// ==============================================================================

export function getLocalOrders(): Order[] {
  try {
    const raw = localStorage.getItem(LOCAL_ORDERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Error reading local orders:', err);
  }
  return [];
}

export function saveLocalOrders(orders: Order[]): void {
  try {
    localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(orders));
  } catch (err) {
    console.error('Error saving local orders:', err);
  }
}

export async function fetchAllOrders(filters?: {
  status?: string;
  supplierId?: string;
  deliveryStatus?: string;
  search?: string;
}): Promise<Order[]> {
  // First try backend API endpoint
  try {
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters?.supplierId && filters.supplierId !== 'all') params.append('supplierId', filters.supplierId);
    if (filters?.deliveryStatus && filters.deliveryStatus !== 'all') params.append('deliveryStatus', filters.deliveryStatus);
    if (filters?.search) params.append('search', filters.search);

    const url = `/api/orders${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        saveLocalOrders(data.orders);
        return data.orders;
      }
    }
  } catch {
    // Fallback to direct client
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      let query = client.from('orders').select('*').order('created_at', { ascending: false });
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters?.supplierId && filters.supplierId !== 'all') {
        query = query.eq('supplier_id', filters.supplierId);
      }
      if (filters?.deliveryStatus && filters.deliveryStatus !== 'all') {
        query = query.eq('delivery_status', filters.deliveryStatus);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        saveLocalOrders(data);
        return data;
      }
    } catch {
      // Fallback to local
    }
  }

  let list = getLocalOrders();
  if (filters) {
    if (filters.status && filters.status !== 'all') {
      list = list.filter((o) => o.status === filters.status);
    }
    if (filters.supplierId && filters.supplierId !== 'all') {
      list = list.filter((o) => o.supplier_id === filters.supplierId || o.items?.some((i) => i.supplier_id === filters.supplierId));
    }
    if (filters.deliveryStatus && filters.deliveryStatus !== 'all') {
      list = list.filter((o) => o.delivery_status === filters.deliveryStatus);
    }
  }
  return list;
}

export async function fetchOrderSummaryStats(): Promise<OrderSummaryStats> {
  try {
    const res = await fetch('/api/orders/summary/stats');
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.stats) {
        return data.stats;
      }
    }
  } catch {
    // Fallback
  }

  const orders = getLocalOrders();
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

    switch (o.status) {
      case 'pending':
      case 'pending_fulfillment':
        pendingCount++;
        break;
      case 'awaiting_purchase':
        awaitingPurchaseCount++;
        break;
      case 'purchased':
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

  return {
    totalOrders: orders.length,
    pendingCount,
    awaitingPurchaseCount,
    awaitingDispatchCount,
    shippedCount,
    deliveredCount,
    returnedCount,
    cancelledCount,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalSupplierCost: Math.round(totalSupplierCost * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
  };
}

export async function saveOrderToDb(
  order: Partial<Order>
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const method = order.id ? 'PUT' : 'POST';
    const endpoint = order.id ? `/api/orders/${order.id}` : '/api/orders';

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to save order' };
    }

    // Update local cache
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
    } else {
      local.unshift(saved);
    }
    saveLocalOrders(local);

    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error saving order' };
  }
}

export async function deleteOrderFromDb(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const local = getLocalOrders().filter((o) => o.id !== id);
      saveLocalOrders(local);
      return true;
    }
  } catch {
    // Fallback
  }
  const local = getLocalOrders().filter((o) => o.id !== id);
  saveLocalOrders(local);
  return true;
}

export async function cancelOrderInDb(
  id: string,
  reason: string
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to cancel order' };
    }
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
      saveLocalOrders(local);
    }
    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error cancelling order' };
  }
}

export async function updateOrderFulfillmentInDb(
  id: string,
  fulfillment: any
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${id}/fulfillment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fulfillment }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to update fulfillment' };
    }
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
      saveLocalOrders(local);
    }
    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error updating fulfillment' };
  }
}

export async function updateOrderSupplierInDb(
  id: string,
  supplierData: any
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${id}/supplier-purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplierData }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to update supplier purchase' };
    }
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
      saveLocalOrders(local);
    }
    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error updating supplier purchase' };
  }
}

export async function recordOrderReturnInDb(
  id: string,
  returnData: any
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnData }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to record return' };
    }
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
      saveLocalOrders(local);
    }
    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error recording return' };
  }
}

export async function recordOrderRefundInDb(
  id: string,
  refundData: any
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${id}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refundData }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'Failed to record refund' };
    }
    const saved = data.order as Order;
    const local = getLocalOrders();
    const idx = local.findIndex((o) => o.id === saved.id);
    if (idx >= 0) {
      local[idx] = saved;
      saveLocalOrders(local);
    }
    return { ok: true, order: saved };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error recording refund' };
  }
}

export async function fetchFinancialReport(options?: {
  range?: DateRangePreset;
  startDate?: string;
  endDate?: string;
}): Promise<FinancialReport> {
  try {
    const params = new URLSearchParams();
    if (options?.range) params.append('range', options.range);
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);

    const res = await fetch(`/api/financials/report?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.report) {
        return data.report;
      }
    }
  } catch {
    // fallback
  }

  const orders = getLocalOrders();
  return computeFinancialReport(orders, options?.range || 'this_month', options?.startDate, options?.endDate);
}

export async function exportFinancialCsv(options?: {
  range?: DateRangePreset;
  startDate?: string;
  endDate?: string;
}): Promise<{ filename: string; csv: string }> {
  try {
    const params = new URLSearchParams();
    if (options?.range) params.append('range', options.range);
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);

    const res = await fetch(`/api/financials/export-csv?${params.toString()}`);
    if (res.ok) {
      const csv = await res.text();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `sinchods-financial-report-${options?.range || 'this_month'}-${new Date().toISOString().slice(0, 10)}.csv`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      return { filename, csv };
    }
  } catch {
    // fallback
  }

  const orders = getLocalOrders();
  const csv = generateFinancialOrdersCsv(orders);
  return {
    filename: `sinchods-financial-report-${options?.range || 'this_month'}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
  };
}

